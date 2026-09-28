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

const packageServerFns = vi.hoisted(() => ({
  getAnnualReturnPackage: vi.fn(),
  getAnnualReturnSubmission: vi.fn(),
  listAnnualReturnSubmissionProofs: vi.fn(),
  recordAnnualReturnSubmission: vi.fn(),
  getAnnualReturnReturnIntakes: vi.fn(),
  recordAnnualReturnReturnIntake: vi.fn(),
  reconcileAnnualReturnReturn: vi.fn(),
  prepareAnnualReturnPackage: vi.fn(),
  approveAnnualReturnPackage: vi.fn(),
  downloadAnnualReturnPackage: vi.fn(),
}));

vi.mock("../server-fns", () => serverFns);
vi.mock("../package-server-fns", () => packageServerFns);
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
  packageServerFns.getAnnualReturnPackage.mockResolvedValue(null);
  packageServerFns.getAnnualReturnSubmission.mockResolvedValue(null);
  packageServerFns.getAnnualReturnReturnIntakes.mockResolvedValue([]);
  packageServerFns.recordAnnualReturnReturnIntake.mockResolvedValue({
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  });
  packageServerFns.reconcileAnnualReturnReturn.mockResolvedValue({
    id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  });
  packageServerFns.listAnnualReturnSubmissionProofs.mockResolvedValue([]);
  packageServerFns.recordAnnualReturnSubmission.mockResolvedValue({
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  });
  packageServerFns.prepareAnnualReturnPackage.mockResolvedValue({
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    caseId,
    revision: 1,
    state: "draft",
    manifestHash: "a".repeat(64),
    artifactSha256: "b".repeat(64),
    artifactSizeBytes: 128,
  });
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
      verifiedChecksum: "a".repeat(64),
      verifiedByteSize: 4,
      versionNumber: 1,
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
      verifiedChecksum: "b".repeat(64),
      verifiedByteSize: 4,
      versionNumber: 1,
      uploadStatus: "available",
      scanVerdictSource: "provider",
      reviewStatus: "verified",
      uploadedBy: null,
      uploadedAt: "2026-07-12T00:00:00.000Z",
    },
  ]);
});

describe("ProductionAnnualReturnCaseDetail", () => {
  it("clicks every production command with case-scoped payloads and refreshes cache", async () => {
    const { queryClient, invalidateSpy } = renderDetail();
    await screen.findByRole("heading", { name: "Acme Company Limited" });

    // The picker offers people by name; the payload is still the id, which is
    // the point -- no staff member has to know or type one.
    const ownerPicker = await screen.findByLabelText("負責同事");
    expect(within(ownerPicker as HTMLSelectElement).getByText(/Calvin Ho/)).toBeTruthy();
    fireEvent.change(ownerPicker, { target: { value: nextOwnerId } });
    fireEvent.click(screen.getByRole("button", { name: "指派" }));

    fireEvent.change(screen.getByLabelText("案件狀態"), {
      target: { value: "Ready to file" },
    });
    fireEvent.click(screen.getByRole("button", { name: "更新" }));

    fireEvent.click(screen.getByRole("button", { name: "標記欠缺" }));

    fireEvent.change(screen.getByLabelText("付款狀態"), {
      target: { value: "Payment pending" },
    });
    fireEvent.click(screen.getByRole("button", { name: "更新付款狀態" }));

    fireEvent.change(screen.getByLabelText("案件備註"), {
      target: { value: "Checked with the client." },
    });
    fireEvent.click(screen.getByRole("button", { name: "新增備註" }));

    fireEvent.change(screen.getByLabelText("追件收件人姓名"), {
      target: { value: "Ada Chan" },
    });
    fireEvent.change(screen.getByLabelText("追件電話"), {
      target: { value: "+85291234567" },
    });
    fireEvent.click(screen.getByRole("button", { name: "發送追件訊息" }));

    fireEvent.click(await screen.findByRole("button", { name: "準備套件" }));

    fireEvent.change(screen.getByLabelText("交件參考編號"), {
      target: { value: "NAR1-2026-001" },
    });
    const receiptPicker = await screen.findByLabelText("已核實回執文件");
    expect(
      within(receiptPicker as HTMLSelectElement).getByText(/filing-receipt\.pdf/),
    ).toBeTruthy();
    fireEvent.change(receiptPicker, { target: { value: receiptId } });
    fireEvent.click(screen.getByRole("button", { name: "確認回執" }));

    await waitFor(() => {
      expect(serverFns.assignAnnualReturnCaseOwner).toHaveBeenCalledWith({
        data: { caseId, ownerId: nextOwnerId },
      });
      expect(serverFns.updateAnnualReturnStatus).toHaveBeenNthCalledWith(1, {
        data: { caseId, nextStatus: "Ready to file" },
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
      expect(packageServerFns.prepareAnnualReturnPackage).toHaveBeenCalledWith({
        data: { caseId, expectedRevision: 0 },
      });
      expect(serverFns.updateAnnualReturnStatus).toHaveBeenCalledTimes(1);
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
    fireEvent.change(screen.getByLabelText("案件狀態"), {
      target: { value: "Ready to file" },
    });
    fireEvent.click(screen.getByRole("button", { name: "指派" }));

    await waitFor(() =>
      expect((screen.getByRole("button", { name: "指派" }) as HTMLButtonElement).disabled).toBe(
        true,
      ),
    );
    expect((screen.getByRole("button", { name: "更新" }) as HTMLButtonElement).disabled).toBe(
      false,
    );

    await act(async () => resolveAssignment(caseItem));
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "指派" }) as HTMLButtonElement).disabled).toBe(
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
    const checklistButtons = screen.getAllByRole("button", { name: "標記欠缺" });
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
    const note = screen.getByLabelText("案件備註");
    fireEvent.change(note, { target: { value: "Keep this draft." } });
    fireEvent.click(screen.getByRole("button", { name: "新增備註" }));

    expect(await screen.findByText("Unable to save note.")).toBeTruthy();
    expect((note as HTMLTextAreaElement).value).toBe("Keep this draft.");
    expect((screen.getByRole("button", { name: "新增備註" }) as HTMLButtonElement).disabled).toBe(
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

    const history = (await screen.findByRole("heading", { name: "審計紀錄" })).closest("section")!;
    await within(history).findByText("Assignment: manual");
    const [firstEntry, secondEntry] = within(history).getAllByRole("listitem");
    expect(firstEntry.textContent).toContain("Assignment: manual");
    expect(secondEntry.textContent).toContain("Note added");
    expect(firstEntry.textContent).toContain("執行者：Mei Lam");
    expect(secondEntry.textContent).toContain("執行者：系統");
  });

  it("shows an empty state when no history exists", async () => {
    renderDetail();
    await screen.findByRole("heading", { name: "Acme Company Limited" });

    expect(await screen.findByText("暫無紀錄。")).toBeTruthy();
  });
});

describe("T15 production manual submission controls", () => {
  it("records an approved package only after a reviewed proof and explicit HKT details", async () => {
    const packageId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const proofVersionId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    packageServerFns.getAnnualReturnPackage.mockResolvedValue({
      id: packageId,
      caseId,
      revision: 1,
      state: "approved",
      manifestHash: "a".repeat(64),
      artifactSha256: "b".repeat(64),
      artifactSizeBytes: 128,
    });
    packageServerFns.listAnnualReturnSubmissionProofs.mockResolvedValue([
      { versionId: proofVersionId, fileName: "portal-confirmation.pdf", category: "submission" },
    ]);
    renderDetail();
    await screen.findByRole("heading", { name: "記錄人手交件" });
    const recordButton = screen.getByRole("button", { name: "記錄外部交件" });
    expect((recordButton as HTMLButtonElement).disabled).toBe(true);
    const proof = await screen.findByLabelText("已覆核外部交件證明");
    fireEvent.change(screen.getByLabelText("外部交件目的地"), {
      target: { value: "Companies Registry portal" },
    });
    fireEvent.change(screen.getByLabelText("外部參考編號"), {
      target: { value: "NAR1-2026-001" },
    });
    fireEvent.change(screen.getByLabelText("交件時間（香港）"), {
      target: { value: "2026-09-27T15:00" },
    });
    fireEvent.change(proof, { target: { value: proofVersionId } });
    fireEvent.click(recordButton);
    await waitFor(() =>
      expect(packageServerFns.recordAnnualReturnSubmission).toHaveBeenCalledWith({
        data: {
          packageId,
          manifestHash: "a".repeat(64),
          expectedRevision: 1,
          submittedAt: "2026-09-27T15:00:00+08:00",
          destinationLabel: "Companies Registry portal",
          externalReference: "NAR1-2026-001",
          proofVersionId,
        },
      }),
    );
    expect(serverFns.updateAnnualReturnStatus).not.toHaveBeenCalled();
  });
});
