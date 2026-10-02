// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const serverFns = vi.hoisted(() => ({
  listAnnualReturnCases: vi.fn(),
  listDocuments: vi.fn(),
  reviewAnnualReturnEvidenceAction: vi.fn(),
  record: vi.fn(),
  review: vi.fn(),
  download: vi.fn(),
}));

vi.mock("../features/annual-return/server-fns", () => ({
  listAnnualReturnCases: serverFns.listAnnualReturnCases,
  listAnnualReturnCasePage: async () => ({
    cases: await serverFns.listAnnualReturnCases(),
    nextCursor: null,
  }),
  recordAnnualReturnPaymentEvidence: serverFns.record,
  reviewAnnualReturnPaymentEvidence: serverFns.review,
}));

vi.mock("../features/documents/server-fns", () => ({
  listDocuments: serverFns.listDocuments,
  listDocumentPage: async (input: unknown) => ({
    documents: await serverFns.listDocuments(input),
    nextCursor: null,
  }),
  downloadDocument: serverFns.download,
}));

vi.mock("../features/annual-return/evidence-server-fns", () => ({
  reviewAnnualReturnEvidenceAction: serverFns.reviewAnnualReturnEvidenceAction,
}));

// Only createFileRoute is replaced: payments.tsx calls it at module scope, and the
// real one wants a registered route tree. Everything else comes from the library.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
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
    serverFns.record.mockReset();
    serverFns.review.mockReset();
    serverFns.download.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });
  it("shows actual saved partial amount, opens only current clean bytes and requires a concrete return reason", async () => {
    const caseId = "40000000-0000-0000-0000-000000000001",
      documentId = "50000000-0000-0000-0000-000000000001",
      proofVersionId = "60000000-0000-0000-0000-000000000001",
      paymentId = "70000000-0000-0000-0000-000000000001",
      expectedVersion = "a".repeat(32);
    const case_ = {
      id: caseId,
      companyName: "Scoped Company",
      currentStatus: "Payment pending",
      readiness: { sourceVersion: expectedVersion },
      payment: {
        id: paymentId,
        amount: 1800,
        receivedAmount: 600,
        balance: 1200,
        status: "Payment pending",
        paidAt: null,
        evidenceEntries: [
          {
            id: "entry",
            documentId,
            proofVersionId,
            amount: 600,
            receivedOn: "2026-09-30",
            status: "pending",
          },
        ],
      },
    };
    serverFns.listAnnualReturnCases.mockResolvedValue([case_]);
    serverFns.listDocuments.mockResolvedValue([
      {
        id: documentId,
        caseId,
        category: "payment",
        fileName: "proof.pdf",
        uploadStatus: "available",
        scanVerdictSource: "provider",
        reviewStatus: "pending",
        currentVersionId: proofVersionId,
      },
    ]);
    serverFns.download.mockResolvedValue(
      new Response("pdf", { headers: { "content-type": "application/pdf" } }),
    );
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:synthetic-preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    serverFns.review.mockResolvedValue(case_);
    renderPayments();
    await screen.findByText("Scoped Company");
    expect(screen.getByText(/餘額：HK\$1,200.00/)).toBeTruthy();
    expect((screen.getByText("退回補傳") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText("預覽當前付款憑證"));
    await waitFor(() =>
      expect(serverFns.download).toHaveBeenCalledWith({
        data: { documentId, expectedVersionId: proofVersionId },
      }),
    );
    expect(await screen.findByTitle("付款憑證預覽")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Concrete return reason"), {
      target: { value: "Cannot read transaction number" },
    });
    fireEvent.click(screen.getByText("退回補傳"));
    await waitFor(() =>
      expect(serverFns.review).toHaveBeenCalledWith({
        data: {
          caseId,
          paymentId,
          documentId,
          proofVersionId,
          expectedVersion,
          decision: "rejected",
          reasonCode: "unreadable",
          reasonText: "Cannot read transaction number",
        },
      }),
    );
  });
  it("never opens or approves unknown or unsafe proof", async () => {
    serverFns.listAnnualReturnCases.mockResolvedValue([
      {
        id: "case",
        companyName: "Unsafe case",
        currentStatus: "Payment pending",
        readiness: { sourceVersion: "a".repeat(32) },
        payment: { id: "payment", amount: 1800, evidenceEntries: [] },
      },
    ]);
    serverFns.listDocuments.mockResolvedValue([
      {
        id: "doc",
        caseId: "case",
        category: "payment",
        fileName: "proof.pdf",
        uploadStatus: "available",
        scanVerdictSource: "deterministic",
        reviewStatus: "pending",
        currentVersionId: "v1",
      },
    ]);
    renderPayments();
    await screen.findByText("Unsafe case");
    expect(screen.queryByText("預覽當前付款憑證")).toBeNull();
    expect((screen.getByText("儲存憑證資料") as HTMLButtonElement).disabled).toBe(true);
    expect(serverFns.download).not.toHaveBeenCalled();
  });
  it("can return unreadable proof without inventing amount/date or first recording a receipt", async () => {
    serverFns.listAnnualReturnCases.mockResolvedValue([
      {
        id: crypto.randomUUID(),
        companyName: "Unreadable company",
        currentStatus: "Payment pending",
        readiness: { sourceVersion: "a".repeat(32) },
        payment: { id: crypto.randomUUID(), amount: 1800, evidenceEntries: [] },
      },
    ]);
    const case_ = await serverFns.listAnnualReturnCases();
    const documentId = crypto.randomUUID(),
      proofVersionId = crypto.randomUUID();
    serverFns.listDocuments.mockResolvedValue([
      {
        id: documentId,
        caseId: case_[0].id,
        category: "payment",
        fileName: "unreadable.pdf",
        uploadStatus: "available",
        scanVerdictSource: "provider",
        reviewStatus: "pending",
        currentVersionId: proofVersionId,
      },
    ]);
    serverFns.review.mockResolvedValue(case_[0]);
    renderPayments();
    await screen.findByText("Unreadable company");
    expect((screen.getByLabelText("Receipt amount") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("Receipt date") as HTMLInputElement).value).toBe("");
    fireEvent.change(screen.getByLabelText("Concrete return reason"), {
      target: { value: "Amount and date are unreadable" },
    });
    fireEvent.click(screen.getByText("退回補傳"));
    await waitFor(() =>
      expect(serverFns.review).toHaveBeenCalledWith({
        data: {
          caseId: case_[0].id,
          paymentId: case_[0].payment.id,
          documentId,
          proofVersionId,
          expectedVersion: "a".repeat(32),
          decision: "rejected",
          reasonCode: "unreadable",
          reasonText: "Amount and date are unreadable",
        },
      }),
    );
    expect(serverFns.record).not.toHaveBeenCalled();
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
});
