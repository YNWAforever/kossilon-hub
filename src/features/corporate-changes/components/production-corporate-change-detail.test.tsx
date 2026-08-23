// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CorporateChangeRequestDetail } from "../types";
import { ProductionCorporateChangeDetail } from "./production-corporate-change-detail";

const serverFns = vi.hoisted(() => ({
  getCorporateChangeRequest: vi.fn(),
  completeCorporateChangeRequest: vi.fn(),
  cancelCorporateChangeRequest: vi.fn(),
  updateCorporateChangeChecklistItemStatus: vi.fn(),
}));

vi.mock("../server-fns", () => serverFns);

const requestId = "request-1";

const baseRequest: CorporateChangeRequestDetail = {
  id: requestId,
  companyId: "company-1",
  changeType: "address_change",
  status: "Filed with Registrar",
  ownerId: "owner-1",
  quotedFee: 2800,
  currentNameEn: null,
  currentNameZh: null,
  newNameEn: null,
  newNameZh: null,
  transferorShareholdingId: null,
  transfereeShareholdingId: null,
  transfereeNewShareholderName: null,
  transfereeNewShareholderAddress: null,
  sharesTransferred: null,
  consideration: null,
  stampDutyAmount: null,
  officerId: null,
  officerAction: null,
  newOfficerType: null,
  newOfficerName: null,
  newOfficerIdentificationType: null,
  newOfficerIdentificationNumber: null,
  newOfficerAddress: null,
  effectiveDate: null,
  currentRegisteredOffice: null,
  newRegisteredOffice: "88 New Road, Hong Kong",
  completedAt: null,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  checklistItems: [
    {
      id: "item-1",
      requestId,
      itemLabel: "NR1 form",
      required: true,
      status: "Verified",
      note: null,
      receivedAt: null,
      verifiedAt: null,
    },
  ],
};

function renderDetail() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

  render(
    <QueryClientProvider client={queryClient}>
      <ProductionCorporateChangeDetail requestId={requestId} />
    </QueryClientProvider>,
  );

  return { queryClient, invalidateSpy };
}

describe("ProductionCorporateChangeDetail", () => {
  beforeEach(() => {
    serverFns.getCorporateChangeRequest.mockReset();
    serverFns.completeCorporateChangeRequest.mockReset();
    serverFns.cancelCorporateChangeRequest.mockReset();
    serverFns.updateCorporateChangeChecklistItemStatus.mockReset();

    serverFns.getCorporateChangeRequest.mockResolvedValue(baseRequest);
    serverFns.completeCorporateChangeRequest.mockResolvedValue({ status: "Completed" });
    serverFns.cancelCorporateChangeRequest.mockResolvedValue({ status: "Cancelled" });
    serverFns.updateCorporateChangeChecklistItemStatus.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
  });

  it("enables Complete once status is Filed with Registrar and all required items are Verified", async () => {
    renderDetail();

    const completeButton = (await screen.findByRole("button", {
      name: /^complete$/i,
    })) as HTMLButtonElement;
    expect(completeButton.disabled).toBe(false);

    fireEvent.click(completeButton);

    await waitFor(() => {
      expect(serverFns.completeCorporateChangeRequest).toHaveBeenCalledWith({
        data: { requestId },
      });
    });
  });

  it("disables Complete when a required checklist item is not yet Verified", async () => {
    serverFns.getCorporateChangeRequest.mockResolvedValue({
      ...baseRequest,
      checklistItems: [{ ...baseRequest.checklistItems[0], status: "Received" }],
    });

    renderDetail();

    const completeButton = (await screen.findByRole("button", {
      name: /^complete$/i,
    })) as HTMLButtonElement;
    expect(completeButton.disabled).toBe(true);
  });

  it("disables Complete when the request status is not Filed with Registrar", async () => {
    serverFns.getCorporateChangeRequest.mockResolvedValue({
      ...baseRequest,
      status: "Ready to file",
    });

    renderDetail();

    const completeButton = (await screen.findByRole("button", {
      name: /^complete$/i,
    })) as HTMLButtonElement;
    expect(completeButton.disabled).toBe(true);
  });

  it("enables Cancel request while the status is not terminal, and calls the cancel fn", async () => {
    renderDetail();

    const cancelButton = (await screen.findByRole("button", {
      name: /cancel request/i,
    })) as HTMLButtonElement;
    expect(cancelButton.disabled).toBe(false);

    fireEvent.click(cancelButton);

    await waitFor(() => {
      expect(serverFns.cancelCorporateChangeRequest).toHaveBeenCalledWith({ data: { requestId } });
    });
  });

  it("disables Cancel request once the request is Completed", async () => {
    serverFns.getCorporateChangeRequest.mockResolvedValue({
      ...baseRequest,
      status: "Completed",
    });

    renderDetail();

    const cancelButton = (await screen.findByRole("button", {
      name: /cancel request/i,
    })) as HTMLButtonElement;
    expect(cancelButton.disabled).toBe(true);
  });

  it("shows the summary fields and checklist, and updates a checklist item's status", async () => {
    renderDetail();

    await screen.findByRole("button", { name: /^complete$/i });

    expect(screen.getByText("address change")).toBeTruthy();
    expect(screen.getByText("Filed with Registrar")).toBeTruthy();
    expect(screen.getByText("HKD 2,800")).toBeTruthy();
    expect(screen.getByText("NR1 form")).toBeTruthy();

    const statusSelect = screen.getByLabelText(/nr1 form/i);
    fireEvent.change(statusSelect, { target: { value: "Rejected" } });

    await waitFor(() => {
      expect(serverFns.updateCorporateChangeChecklistItemStatus).toHaveBeenCalledWith({
        data: { requestId, itemId: "item-1", status: "Rejected", note: null },
      });
    });
  });

  it("marks an optional checklist item as such", async () => {
    serverFns.getCorporateChangeRequest.mockResolvedValue({
      ...baseRequest,
      checklistItems: [{ ...baseRequest.checklistItems[0], required: false }],
    });

    renderDetail();

    expect(await screen.findByText("NR1 form (optional)")).toBeTruthy();
  });

  it("shows a loading state before the request resolves", () => {
    serverFns.getCorporateChangeRequest.mockReturnValue(new Promise(() => {}));

    renderDetail();

    expect(screen.getByText(/loading/i)).toBeTruthy();
  });

  it("shows an error state when the request fails to load", async () => {
    serverFns.getCorporateChangeRequest.mockRejectedValue(new Error("boom"));

    renderDetail();

    expect(await screen.findByText(/failed to load this request/i)).toBeTruthy();
  });
});
