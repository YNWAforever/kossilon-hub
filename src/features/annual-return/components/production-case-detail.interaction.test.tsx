// @vitest-environment jsdom

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { annualReturnQueryKeys } from "../query-keys";
import type { AnnualReturnCase } from "../types";
import { ProductionAnnualReturnCaseDetail } from "./production-case-detail";

const serverFns = vi.hoisted(() => ({
  getAnnualReturnCase: vi.fn(),
  listAnnualReturnCaseNotes: vi.fn(),
  listAnnualReturnCaseHistory: vi.fn(),
  assignAnnualReturnCaseOwner: vi.fn(),
  updateAnnualReturnStatus: vi.fn(),
  updateAnnualReturnChecklistItem: vi.fn(),
  updateAnnualReturnPayment: vi.fn(),
  addAnnualReturnCaseNote: vi.fn(),
  queueAnnualReturnWhatsAppReminderMessage: vi.fn(),
  updateAnnualReturnFilingProof: vi.fn(),
  listAssignableStaff: vi.fn(),
}));

// The Owner ID and receipt-document UUID boxes became scoped pickers, so the
// screen now reads two lists. Mocked here rather than stubbed per-test so every
// existing assertion keeps exercising the same commands.
const documentServerFns = vi.hoisted(() => ({
  listDocuments: vi.fn(),
  downloadDocument: vi.fn(),
}));

vi.mock("../server-fns", () => serverFns);
vi.mock("../handoff-server-fns", () => ({
  getCaseHandoffs: vi
    .fn()
    .mockResolvedValue({
      preview: { readyForApproval: false, sourceVersion: null, manifestSha256: null, blockers: [] },
      handoffs: [],
      returns: [],
      connectorConfigured: false,
    }),
  runHandoffCommand: vi.fn(),
}));
vi.mock("@/features/documents/server-fns", () => documentServerFns);
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/annual-returns">{children}</a>,
}));

const caseId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";
const nextOwnerId = "33333333-3333-4333-8333-333333333333";
const checklistItemId = "44444444-4444-4444-8444-444444444444";
const checklistDocumentId = "55555555-5555-4555-8555-555555555555";
const paymentProofId = "66666666-6666-4666-8666-666666666666";
const receiptId = "77777777-7777-4777-8777-777777777777";

const caseItem: AnnualReturnCase = {
  readiness: {
    sourceVersion: "a".repeat(32),
    readyToPrepare: true,
    readyForApproval: true,
    readyToTransmit: false,
    manifestPayload: null,
    blockers: [],
  },
  id: caseId,
  companyId: "88888888-8888-4888-8888-888888888888",
  companyTeamId: "99999999-9999-4999-8999-999999999999",
  companyName: "Acme Company Limited",
  returnYear: 2026,
  madeUpDate: "2026-06-30",
  filingDueDate: "2026-08-12",
  currentStatus: "Upcoming",
  riskLevel: "green",
  ownerId,
  ownerName: "Ada Chan",
  reviewerId: null,
  reviewerName: null,
  remindersSent: 0,
  filingReference: null,
  confirmationDocumentId: null,
  lockedAt: null,
  completedAt: null,
  checklist: [
    {
      id: checklistItemId,
      caseId,
      itemLabel: "Signed NAR1",
      required: true,
      status: "Verified",
      dueDate: "2026-08-01",
      receivedAt: "2026-07-10T00:00:00.000Z",
      verifiedAt: "2026-07-11T00:00:00.000Z",
      documentId: checklistDocumentId,
    },
  ],
  payment: {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    caseId,
    invoiceNumber: "INV-2026-001",
    amount: 1800,
    currency: "HKD",
    status: "Payment received",
    dueDate: "2026-08-01",
    paidAt: "2026-07-11T00:00:00.000Z",
    paymentProofDocumentId: paymentProofId,
  },
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
      <ProductionAnnualReturnCaseDetail caseId={caseId} />
    </QueryClientProvider>,
  );

  return { queryClient, invalidateSpy };
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  serverFns.getAnnualReturnCase.mockResolvedValue(caseItem);
  serverFns.listAnnualReturnCaseNotes.mockResolvedValue([]);
  serverFns.listAnnualReturnCaseHistory.mockResolvedValue([]);
  serverFns.assignAnnualReturnCaseOwner.mockResolvedValue(caseItem);
  serverFns.updateAnnualReturnStatus.mockResolvedValue(caseItem);
  serverFns.updateAnnualReturnChecklistItem.mockResolvedValue(caseItem);
  serverFns.updateAnnualReturnPayment.mockResolvedValue(caseItem);
  serverFns.addAnnualReturnCaseNote.mockResolvedValue({});
  serverFns.queueAnnualReturnWhatsAppReminderMessage.mockResolvedValue({});
  serverFns.updateAnnualReturnFilingProof.mockResolvedValue(caseItem);
  serverFns.listAssignableStaff.mockResolvedValue([
    { id: ownerId, name: "Iris Wong", role: "Staff", teamId: null, teamName: "Annual return" },
    { id: nextOwnerId, name: "Calvin Ho", role: "Staff", teamId: null, teamName: "Annual return" },
  ]);
  documentServerFns.listDocuments.mockResolvedValue([
    {
      id: receiptId,
      companyId: caseItem.companyId,
      caseId,
      category: "receipt",
      fileName: "filing-receipt.pdf",
      objectKey: "documents/receipt",
      contentType: "application/pdf",
      sizeBytes: 4,
      checksum: "a".repeat(64),
      uploadStatus: "available",
      // A picker that offers a file whose only "clean" came from the fixture
      // scanner would be offering unverified evidence, so the fixture is a real
      // provider verdict.
      scanVerdictSource: "provider",
      reviewStatus: "verified",
      uploadedBy: null,
      uploadedAt: "2026-07-12T00:00:00.000Z",
    },
    {
      id: paymentProofId,
      companyId: caseItem.companyId,
      caseId,
      category: "payment",
      fileName: "payment-proof.pdf",
      objectKey: "documents/payment",
      contentType: "application/pdf",
      sizeBytes: 4,
      checksum: "b".repeat(64),
      uploadStatus: "available",
      scanVerdictSource: "provider",
      reviewStatus: "verified",
      uploadedBy: null,
      uploadedAt: "2026-07-12T00:00:00.000Z",
    },
  ]);
});

describe("ProductionAnnualReturnCaseDetail", () => {
  it("disables preparation for unknown current evidence and shows an actionable blocker", async () => {
    serverFns.getAnnualReturnCase.mockResolvedValue({ ...caseItem, readiness: undefined });
    renderDetail();
    await screen.findByRole("heading", { name: "Acme Company Limited" });
    expect(
      (screen.getByRole("button", { name: "Prepare packet" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByLabelText("交件阻擋原因").textContent).toContain("未取得當前付款");
    expect(serverFns.updateAnnualReturnStatus).not.toHaveBeenCalled();
  });
  it("clicks every production command with case-scoped payloads and refreshes cache", async () => {
    const { queryClient, invalidateSpy } = renderDetail();
    await screen.findByRole("heading", { name: "Acme Company Limited" });

    // The picker offers people by name; the payload is still the id, which is
    // the point -- no staff member has to know or type one.
    const ownerPicker = await screen.findByLabelText("負責同事");
    expect(within(ownerPicker as HTMLSelectElement).getByText(/Calvin Ho/)).toBeTruthy();
    fireEvent.change(ownerPicker, { target: { value: nextOwnerId } });
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));

    fireEvent.change(screen.getByLabelText("Case status"), {
      target: { value: "Ready to file" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    fireEvent.click(screen.getByRole("button", { name: "Mark missing" }));

    fireEvent.change(screen.getByLabelText("Payment status"), {
      target: { value: "Payment pending" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update payment" }));

    fireEvent.change(screen.getByLabelText("Case note"), {
      target: { value: "Checked with the client." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));

    fireEvent.change(screen.getByLabelText("Reminder recipient name"), {
      target: { value: "Ada Chan" },
    });
    fireEvent.change(screen.getByLabelText("Reminder phone"), {
      target: { value: "+85291234567" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send reminder" }));

    fireEvent.click(screen.getByRole("button", { name: "Prepare packet" }));

    fireEvent.change(screen.getByLabelText("Filing reference"), {
      target: { value: "NAR1-2026-001" },
    });
    const receiptPicker = await screen.findByLabelText("已核實回執文件");
    expect(
      within(receiptPicker as HTMLSelectElement).getByText(/filing-receipt\.pdf/),
    ).toBeTruthy();
    fireEvent.change(receiptPicker, { target: { value: receiptId } });
    fireEvent.click(screen.getByRole("button", { name: "Accept receipt" }));

    await waitFor(() => {
      expect(serverFns.assignAnnualReturnCaseOwner).toHaveBeenCalledWith({
        data: { caseId, ownerId: nextOwnerId },
      });
      expect(serverFns.updateAnnualReturnStatus).toHaveBeenNthCalledWith(1, {
        data: { caseId, nextStatus: "Ready to file", expectedVersion: "a".repeat(32) },
      });
      expect(serverFns.updateAnnualReturnChecklistItem).toHaveBeenCalledWith({
        data: {
          caseId,
          itemId: checklistItemId,
          status: "Missing",
          documentId: null,
        },
      });
      expect(serverFns.updateAnnualReturnPayment).toHaveBeenCalledWith({
        data: {
          caseId,
          status: "Payment pending",
          paymentProofDocumentId: null,
        },
      });
      expect(serverFns.addAnnualReturnCaseNote).toHaveBeenCalledWith({
        data: { caseId, body: "Checked with the client." },
      });
      expect(serverFns.queueAnnualReturnWhatsAppReminderMessage).toHaveBeenCalledWith({
        data: {
          caseId,
          recipientName: "Ada Chan",
          recipientPhone: "+85291234567",
        },
      });
      expect(serverFns.updateAnnualReturnStatus).toHaveBeenNthCalledWith(2, {
        data: { caseId, nextStatus: "NAR1 prepared", expectedVersion: "a".repeat(32) },
      });
      expect(serverFns.updateAnnualReturnFilingProof).toHaveBeenCalledWith({
        data: {
          caseId,
          filingReference: "NAR1-2026-001",
          confirmationDocumentId: receiptId,
        },
      });
    });

    expect(invalidateSpy).toHaveBeenCalled();
    expect(queryClient.getQueryData(annualReturnQueryKeys.detail(caseId))).toEqual(caseItem);
  });

  it("disables only the owner control while assignment is pending", async () => {
    let resolveAssignment!: (value: AnnualReturnCase) => void;
    serverFns.assignAnnualReturnCaseOwner.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveAssignment = resolve;
        }),
    );

    renderDetail();
    await screen.findByRole("heading", { name: "Acme Company Limited" });
    fireEvent.change(screen.getByLabelText("Case status"), {
      target: { value: "Ready to file" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));

    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Assign" }) as HTMLButtonElement).disabled).toBe(
        true,
      ),
    );
    expect((screen.getByRole("button", { name: "Update" }) as HTMLButtonElement).disabled).toBe(
      false,
    );

    await act(async () => resolveAssignment(caseItem));
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "Assign" }) as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
  });

  it("disables only the checklist row whose mutation is pending", async () => {
    const secondItemId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    serverFns.getAnnualReturnCase.mockResolvedValue({
      ...caseItem,
      checklist: [
        ...caseItem.checklist,
        {
          ...caseItem.checklist[0],
          id: secondItemId,
          itemLabel: "Director details",
        },
      ],
    });
    const checklistResolvers: Array<(value: AnnualReturnCase) => void> = [];
    serverFns.updateAnnualReturnChecklistItem.mockImplementation(
      () =>
        new Promise((resolve) => {
          checklistResolvers.push(resolve);
        }),
    );

    renderDetail();
    await screen.findByRole("heading", { name: "Acme Company Limited" });
    const checklistButtons = screen.getAllByRole("button", { name: "Mark missing" });
    fireEvent.click(checklistButtons[0]);

    await waitFor(() => expect((checklistButtons[0] as HTMLButtonElement).disabled).toBe(true));
    expect((checklistButtons[1] as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(checklistButtons[1]);
    await waitFor(() => {
      expect((checklistButtons[0] as HTMLButtonElement).disabled).toBe(true);
      expect((checklistButtons[1] as HTMLButtonElement).disabled).toBe(true);
    });
    expect(serverFns.updateAnnualReturnChecklistItem).toHaveBeenCalledTimes(2);

    await act(async () => {
      checklistResolvers.forEach((resolve) => resolve(caseItem));
    });
  });
  it("retains note text and renders the error after a failed command", async () => {
    serverFns.addAnnualReturnCaseNote.mockRejectedValue(new Error("Unable to save note."));

    renderDetail();
    await screen.findByRole("heading", { name: "Acme Company Limited" });
    const note = screen.getByLabelText("Case note");
    fireEvent.change(note, { target: { value: "Keep this draft." } });
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Unable to save note.");
    expect((note as HTMLTextAreaElement).value).toBe("Keep this draft.");
    expect((screen.getByRole("button", { name: "Add note" }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("renders merged audit history entries newest first", async () => {
    serverFns.listAnnualReturnCaseHistory.mockResolvedValue([
      {
        kind: "audit",
        id: "a1000000-0000-0000-0000-000000000001",
        createdAt: "2026-08-01T09:00:00.000Z",
        actorId: ownerId,
        actorName: null,
        actorRole: "Staff",
        action: "add_note",
        result: "succeeded",
        summary: "Checked with the client.",
        metadata: {},
      },
      {
        kind: "assignment",
        id: "b1000000-0000-0000-0000-000000000001",
        createdAt: "2026-08-02T09:00:00.000Z",
        workItemId: "c1000000-0000-0000-0000-000000000001",
        previousAssigneeId: ownerId,
        previousAssigneeName: "Ada Chan",
        assignedToId: nextOwnerId,
        assignedToName: "Ken Wong",
        assignedById: ownerId,
        assignedByName: "Mei Lam",
        decision: "manual",
        overrideReason: null,
        recommendationRank: null,
        recommendationScore: null,
        recommendationFactors: {},
      },
    ]);

    renderDetail();
    await screen.findByRole("heading", { name: "Acme Company Limited" });

    const history = (await screen.findByText("Audit history")).closest("section")!;
    await within(history).findByText("Assignment: manual");
    const [firstEntry, secondEntry] = within(history).getAllByRole("listitem");
    expect(firstEntry.textContent).toContain("Assignment: manual");
    expect(secondEntry.textContent).toContain("Note added");
    expect(firstEntry.textContent).toContain("by Mei Lam");
    expect(secondEntry.textContent).toContain("by System");
  });

  it("shows an empty state when no history exists", async () => {
    renderDetail();
    await screen.findByRole("heading", { name: "Acme Company Limited" });

    expect(await screen.findByText("No history yet.")).toBeTruthy();
  });
});
