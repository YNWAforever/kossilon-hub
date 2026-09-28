// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const serverFns = vi.hoisted(() => ({
  listAnnualReturnCases: vi.fn(),
  listDocuments: vi.fn(),
  reviewAnnualReturnEvidenceAction: vi.fn(),
  listPaymentObservations: vi.fn(),
  reconcilePaymentAction: vi.fn(),
}));

vi.mock("../features/annual-return/server-fns", () => ({
  listAnnualReturnCases: serverFns.listAnnualReturnCases,
}));

vi.mock("../features/documents/server-fns", () => ({
  listDocuments: serverFns.listDocuments,
}));

vi.mock("../features/annual-return/evidence-server-fns", () => ({
  reviewAnnualReturnEvidenceAction: serverFns.reviewAnnualReturnEvidenceAction,
}));

vi.mock("../features/payments/server-fns", () => ({
  listPaymentObservations: serverFns.listPaymentObservations,
  reconcilePaymentAction: serverFns.reconcilePaymentAction,
}));

// Only createFileRoute is replaced: payments.tsx calls it at module scope, and the
// real one wants a registered route tree. Everything else comes from the library.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => () => ({ useRouteContext: () => ({ dataMode: "production" }) }),
}));

import { ProductionPaymentsRoute } from "./payments";

function renderPayments() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ProductionPaymentsRoute />
    </QueryClientProvider>,
  );
}

describe("production payments route", () => {
  beforeEach(() => {
    serverFns.listAnnualReturnCases.mockReset();
    serverFns.listDocuments.mockReset();
    serverFns.listPaymentObservations.mockReset();
    serverFns.reconcilePaymentAction.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("does not claim there is nothing to review when the query failed", async () => {
    // On error `data` is undefined so the filtered list is empty, and isLoading is
    // false because the status is `error`. Without an isError guard the screen
    // renders "unavailable" and "nothing to review" at the same time.
    serverFns.listAnnualReturnCases.mockRejectedValue(new Error("boom"));
    serverFns.listDocuments.mockRejectedValue(new Error("boom"));
    renderPayments();

    await screen.findByRole("alert");

    expect(screen.queryByText("No production payment evidence is awaiting review.")).toBeNull();
  });

  it("still shows the empty state when the queries succeed with nothing to review", async () => {
    serverFns.listAnnualReturnCases.mockResolvedValue([]);
    serverFns.listDocuments.mockResolvedValue([]);
    renderPayments();

    expect(
      await screen.findByText("No production payment evidence is awaiting review."),
    ).toBeTruthy();
  });
  it("requires explicit invoice, amount, currency and reviewed proof before matching an observation", async () => {
    const caseId = "11111111-1111-4111-8111-111111111111";
    const observationId = "22222222-2222-4222-8222-222222222222";
    const versionId = "33333333-3333-4333-8333-333333333333";
    const checksum = "a".repeat(64);
    serverFns.listAnnualReturnCases.mockResolvedValue([
      {
        id: caseId,
        companyName: "Fixture Limited",
        returnYear: 2026,
        payment: {
          invoiceNumber: "INV-2026-001",
          amount: 1800,
          currency: "HKD",
          status: "Payment pending",
        },
      },
    ]);
    serverFns.listDocuments.mockResolvedValue([
      {
        id: "44444444-4444-4444-8444-444444444444",
        caseId,
        category: "payment",
        fileName: "proof.pdf",
        currentVersionId: versionId,
        versionNumber: 1,
        uploadStatus: "available",
        reviewStatus: "verified",
        scanVerdictSource: "provider",
        checksum,
        verifiedChecksum: checksum,
        sizeBytes: 100,
        verifiedByteSize: 100,
      },
    ]);
    serverFns.listPaymentObservations.mockResolvedValue([
      {
        id: observationId,
        companyId: "55555555-5555-4555-8555-555555555555",
        caseId,
        invoiceRef: null,
        amountMinor: null,
        currency: null,
        receivedOn: "2026-08-01",
        sourceRowId: "66666666-6666-4666-8666-666666666666",
        proofVersionId: null,
        revision: 1,
        status: "pending_review",
      },
    ]);
    serverFns.reconcilePaymentAction.mockResolvedValue({
      observationId,
      status: "matched",
      revision: 2,
      paymentStatus: "Payment received",
      auditEventId: "77777777-7777-4777-8777-777777777777",
      reasonCode: null,
    });
    renderPayments();
    await screen.findByRole("option", { name: "Fixture Limited · 2026" });
    fireEvent.change(screen.getByLabelText("Case for payment reconciliation"), {
      target: { value: caseId },
    });
    await screen.findByText("Workbook date 2026-08-01");
    fireEvent.click(screen.getByRole("button", { name: "Match payment" }));
    expect(screen.getByRole("alert").textContent).toContain("Choose a reviewed proof");
    expect(serverFns.reconcilePaymentAction).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Reviewed payment proof"), {
      target: { value: versionId },
    });
    fireEvent.change(screen.getByLabelText("Confirmed invoice reference"), {
      target: { value: "INV-2026-001" },
    });
    fireEvent.change(screen.getByLabelText("Confirmed amount"), {
      target: { value: "1800.00" },
    });
    fireEvent.change(screen.getByLabelText("Confirmed currency"), {
      target: { value: "HKD" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Match payment" }));
    await waitFor(() => expect(serverFns.reconcilePaymentAction).toHaveBeenCalledOnce());
    expect(serverFns.reconcilePaymentAction.mock.calls[0][0]).toEqual({
      data: {
        observationId,
        caseId,
        proofVersionId: versionId,
        expectedRevision: 1,
        decision: "match",
        reason: undefined,
        confirmation: { invoiceRef: "INV-2026-001", amountMinor: 180000, currency: "HKD" },
      },
    });
  });
});
