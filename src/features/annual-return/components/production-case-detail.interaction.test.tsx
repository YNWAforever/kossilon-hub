// @vitest-environment jsdom

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { annualReturnQueryKeys } from "../query-keys";
import type { AnnualReturnCase } from "../types";
import { ProductionAnnualReturnCaseDetail } from "./production-case-detail";

const serverFns = vi.hoisted(() => ({
  getAnnualReturnCase: vi.fn(),
  listAnnualReturnCaseNotes: vi.fn(),
  listAnnualReturnCaseHistory: vi.fn(),
  listAnnualReturnCaseFindings: vi.fn(),
  listAnnualReturnCaseParties: vi.fn(),
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
  getCaseHandoffs: vi.fn().mockResolvedValue({
    preview: { readyForApproval: false, sourceVersion: null, manifestSha256: null, blockers: [] },
    handoffs: [],
    returns: [],
    connectorConfigured: false,
  }),
  runHandoffCommand: vi.fn(),
}));
vi.mock("@/features/documents/server-fns", () => ({
  ...documentServerFns,
  listDocumentPage: async (input: unknown) => ({
    documents: await documentServerFns.listDocuments(input),
    nextCursor: null,
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
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

function renderDetail(
  returnTo?: string,
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  }),
) {
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <ProductionAnnualReturnCaseDetail caseId={caseId} returnTo={returnTo} />
    </QueryClientProvider>,
  );

  return { queryClient, invalidateSpy, rerender: rendered.rerender };
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  vi.clearAllMocks();
  serverFns.getAnnualReturnCase.mockReset();
  serverFns.getAnnualReturnCase.mockResolvedValue(caseItem);
  serverFns.listAnnualReturnCaseNotes.mockReset();
  serverFns.listAnnualReturnCaseNotes.mockResolvedValue([]);
  serverFns.listAnnualReturnCaseHistory.mockReset();
  serverFns.listAnnualReturnCaseHistory.mockResolvedValue([]);
  serverFns.listAnnualReturnCaseFindings.mockResolvedValue([]);
  serverFns.listAnnualReturnCaseParties.mockResolvedValue([]);
  serverFns.assignAnnualReturnCaseOwner.mockResolvedValue(caseItem);
  serverFns.updateAnnualReturnStatus.mockResolvedValue(caseItem);
  serverFns.updateAnnualReturnChecklistItem.mockResolvedValue(caseItem);
  serverFns.updateAnnualReturnPayment.mockResolvedValue(caseItem);
  serverFns.addAnnualReturnCaseNote.mockReset();
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
  it("treats a malformed case link as not found instead of loading forever", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ProductionAnnualReturnCaseDetail caseId="not-a-case" />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("heading", { name: "找不到案件" })).toBeTruthy();
    expect(screen.queryByText("正在載入周年申報案件")).toBeNull();
    expect(serverFns.getAnnualReturnCase).not.toHaveBeenCalled();
  });

  it("offers 處理 only for blockers whose fix lives on another page", async () => {
    serverFns.getAnnualReturnCase.mockResolvedValue({
      ...caseItem,
      readiness: {
        ...caseItem.readiness!,
        readyToPrepare: false,
        blockers: [
          {
            code: "required_document_missing",
            stage: "prepare",
            message: "CDD 尚欠可用文件。",
            action: `/documents?caseId=${caseId}`,
          },
          {
            code: "party_applicability_unknown",
            stage: "prepare",
            message: "案件人士尚未確認。",
            action: `/annual-returns/${caseId}`,
          },
        ],
      },
    });
    renderDetail();

    const list = await screen.findByLabelText("交件阻礙事項");
    const rows = within(list).getAllByRole("listitem");
    expect(within(rows[0]).getByRole("link", { name: "處理" })).toBeTruthy();
    expect(within(rows[1]).queryByRole("link", { name: "處理" })).toBeNull();
  });

  it("disables preparation for unknown current evidence and shows an actionable blocker", async () => {
    serverFns.getAnnualReturnCase.mockResolvedValue({ ...caseItem, readiness: undefined });
    renderDetail();
    await screen.findByRole("heading", { name: "Acme Company Limited" });
    expect(
      (screen.getByRole("button", { name: "準備交件套件" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByLabelText("交件阻礙事項").textContent).toContain("未取得當前付款");
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
    fireEvent.click(screen.getByRole("button", { name: "分配" }));

    fireEvent.change(screen.getByLabelText("案件狀態"), {
      target: { value: "Ready to file" },
    });
    fireEvent.click(screen.getByRole("button", { name: "更新" }));

    fireEvent.click(screen.getByRole("button", { name: "標記為缺少" }));

    fireEvent.change(screen.getByLabelText("付款狀態"), {
      target: { value: "Payment pending" },
    });
    fireEvent.click(screen.getByRole("button", { name: "更新付款" }));

    fireEvent.change(screen.getByLabelText("案件備註"), {
      target: { value: "Checked with the client." },
    });
    fireEvent.click(screen.getByRole("button", { name: "加入備註" }));

    fireEvent.change(screen.getByLabelText("提醒收件人姓名"), {
      target: { value: "Ada Chan" },
    });
    fireEvent.change(screen.getByLabelText("提醒電話號碼"), {
      target: { value: "+85291234567" },
    });
    fireEvent.click(screen.getByRole("button", { name: "發送提醒" }));

    fireEvent.click(screen.getByRole("button", { name: "準備交件套件" }));

    fireEvent.change(screen.getByLabelText("遞交編號"), {
      target: { value: "NAR1-2026-001" },
    });
    const receiptPicker = await screen.findByLabelText("已核對回條文件");
    expect(
      within(receiptPicker as HTMLSelectElement).getByText(/filing-receipt\.pdf/),
    ).toBeTruthy();
    fireEvent.change(receiptPicker, { target: { value: receiptId } });
    fireEvent.click(screen.getByRole("button", { name: "接納回條" }));

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
    await waitFor(() =>
      expect(vi.mocked(toast.success).mock.calls.map(([message]) => message)).toEqual(
        expect.arrayContaining([
          "已分配負責同事。",
          "已更新案件狀態。",
          "已更新付款。",
          "已加入備註。",
          "已排入 WhatsApp 提醒。",
          "已準備文件套件。",
          "已接納回條。",
        ]),
      ),
    );
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
    fireEvent.click(screen.getByRole("button", { name: "分配" }));

    await waitFor(() =>
      expect((screen.getByRole("button", { name: "分配" }) as HTMLButtonElement).disabled).toBe(
        true,
      ),
    );
    expect((screen.getByRole("button", { name: "更新" }) as HTMLButtonElement).disabled).toBe(
      false,
    );

    await act(async () => resolveAssignment(caseItem));
    await waitFor(() =>
      expect((screen.getByRole("button", { name: "分配" }) as HTMLButtonElement).disabled).toBe(
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
    const checklistButtons = screen.getAllByRole("button", { name: "標記為缺少" });
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
    fireEvent.click(screen.getByRole("button", { name: "加入備註" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Unable to save note.");
    expect((note as HTMLTextAreaElement).value).toBe("Keep this draft.");
    expect((screen.getByRole("button", { name: "加入備註" }) as HTMLButtonElement).disabled).toBe(
      true,
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

    const history = (await screen.findByText("審計記錄")).closest("section")!;
    await within(history).findByText("分配：手動");
    const [firstEntry, secondEntry] = within(history).getAllByRole("listitem");
    expect(firstEntry.textContent).toContain("分配：手動");
    expect(secondEntry.textContent).toContain("已加入備註");
    expect(firstEntry.textContent).toContain("操作人：Mei Lam");
    expect(secondEntry.textContent).toContain("操作人：系統");
  });

  it("shows an empty state when no history exists", async () => {
    renderDetail();
    await screen.findByRole("heading", { name: "Acme Company Limited" });

    expect(await screen.findByText("暫時沒有記錄。")).toBeTruthy();
  });
});

function expectNoCaseCommands() {
  for (const command of [
    serverFns.assignAnnualReturnCaseOwner,
    serverFns.updateAnnualReturnStatus,
    serverFns.updateAnnualReturnChecklistItem,
    serverFns.updateAnnualReturnPayment,
    serverFns.addAnnualReturnCaseNote,
    serverFns.queueAnnualReturnWhatsAppReminderMessage,
    serverFns.updateAnnualReturnFilingProof,
  ])
    expect(command).not.toHaveBeenCalled();
}

it("recovers the exact case/readiness with no command replay and uses the fresh source version only on explicit action", async () => {
  serverFns.getAnnualReturnCase.mockRejectedValueOnce(new Error("Temporary case failure"));
  renderDetail("/today?view=blocked&q=Acme");
  await screen.findByRole("heading", { name: "無法載入周年申報案件" });
  expect(screen.getByRole("link", { name: "返回工作列表" }).getAttribute("href")).toBe(
    "/today?view=blocked&q=Acme",
  );
  const retry = screen.getByRole("button", { name: "重新載入案件資料" });
  serverFns.getAnnualReturnCase.mockResolvedValue({
    ...caseItem,
    readiness: { ...caseItem.readiness!, sourceVersion: "b".repeat(32), readyToPrepare: false },
  });
  fireEvent.click(retry);
  await screen.findByRole("heading", { name: "Acme Company Limited" });
  expect(serverFns.getAnnualReturnCase).toHaveBeenCalledTimes(2);
  expect(serverFns.getAnnualReturnCase).toHaveBeenLastCalledWith({ data: { id: caseId } });
  expect(serverFns.listAnnualReturnCaseNotes).toHaveBeenCalledTimes(1);
  expect(serverFns.listAnnualReturnCaseHistory).toHaveBeenCalledTimes(1);
  expect((screen.getByRole("button", { name: "準備交件套件" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expectNoCaseCommands();
  fireEvent.change(screen.getByLabelText("案件狀態"), { target: { value: "Ready to file" } });
  fireEvent.click(screen.getByRole("button", { name: "更新" }));
  await waitFor(() =>
    expect(serverFns.updateAnnualReturnStatus).toHaveBeenCalledWith({
      data: { caseId, nextStatus: "Ready to file", expectedVersion: "b".repeat(32) },
    }),
  );
});

it("deduplicates pending initial-case recovery and keeps commands unavailable", async () => {
  serverFns.getAnnualReturnCase.mockRejectedValueOnce(new Error("Temporary failure"));
  renderDetail();
  const retry = await screen.findByRole("button", { name: "重新載入案件資料" });
  let finish!: (value: AnnualReturnCase) => void;
  serverFns.getAnnualReturnCase.mockImplementationOnce(
    () =>
      new Promise<AnnualReturnCase>((resolve) => {
        finish = resolve;
      }),
  );
  act(() => {
    retry.click();
    retry.click();
  });
  await waitFor(() => expect(serverFns.getAnnualReturnCase).toHaveBeenCalledTimes(2));
  expect(await screen.findByRole("status")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "準備交件套件" })).toBeNull();
  expectNoCaseCommands();
  await act(async () => {
    finish(caseItem);
  });
  await screen.findByRole("heading", { name: "Acme Company Limited" });
  expect(serverFns.getAnnualReturnCase).toHaveBeenCalledTimes(2);
  expectNoCaseCommands();
});

it("keeps a repeated failed case recovery closed and offers another explicit read retry", async () => {
  serverFns.getAnnualReturnCase.mockRejectedValue(new Error("Read denied"));
  renderDetail();
  fireEvent.click(await screen.findByRole("button", { name: "重新載入案件資料" }));
  await waitFor(() => expect(serverFns.getAnnualReturnCase).toHaveBeenCalledTimes(2));
  const retry = await screen.findByRole("button", { name: "重新載入案件資料" });
  await waitFor(() => expect((retry as HTMLButtonElement).disabled).toBe(false));
  expect(screen.queryByRole("heading", { name: "Acme Company Limited" })).toBeNull();
  expect(screen.queryByRole("button", { name: "更新" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "找不到案件" })).toBeNull();
  expectNoCaseCommands();
});

it("treats a missing recovery result as not found without exposing commands", async () => {
  serverFns.getAnnualReturnCase.mockRejectedValueOnce(new Error("Unavailable"));
  renderDetail();
  const retry = await screen.findByRole("button", { name: "重新載入案件資料" });
  serverFns.getAnnualReturnCase.mockResolvedValue(null);
  fireEvent.click(retry);
  expect(await screen.findByRole("heading", { name: "找不到案件" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "準備交件套件" })).toBeNull();
  expectNoCaseCommands();
});

it("hides cached case commands after a denied refresh and respects a newly locked recovery result", async () => {
  const { queryClient } = renderDetail();
  await screen.findByRole("heading", { name: "Acme Company Limited" });
  serverFns.getAnnualReturnCase.mockRejectedValue(new Error("Refresh denied"));
  await act(async () => {
    await queryClient.invalidateQueries({
      queryKey: annualReturnQueryKeys.detail(caseId),
      exact: true,
    });
  });
  const retry = await screen.findByRole("button", { name: "重新載入案件資料" });
  expect(screen.queryByRole("heading", { name: "Acme Company Limited" })).toBeNull();
  expect(screen.queryByRole("button", { name: "更新" })).toBeNull();
  let finish!: (value: AnnualReturnCase) => void;
  serverFns.getAnnualReturnCase.mockImplementationOnce(
    () =>
      new Promise<AnnualReturnCase>((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(retry);
  await waitFor(() => expect((retry as HTMLButtonElement).disabled).toBe(true));
  expect(screen.queryByRole("button", { name: "更新" })).toBeNull();
  await act(async () => {
    finish({ ...caseItem, lockedAt: "2026-10-27T00:00:00Z" });
  });
  await screen.findByRole("heading", { name: "Acme Company Limited" });
  for (const name of ["更新", "更新付款", "準備交件套件", "分配"])
    expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(true);
  expectNoCaseCommands();
});

const contextReads = [
  {
    name: "notes",
    heading: "備註",
    retry: "重新載入備註",
    empty: "暫時沒有備註。",
    read: serverFns.listAnnualReturnCaseNotes,
    other: serverFns.listAnnualReturnCaseHistory,
    key: annualReturnQueryKeys.notes(caseId),
    text: "Recovered notes",
    data: [{ id: "saved-note", body: "Recovered notes", createdAt: "2026-10-27T09:00:00Z" }],
  },
  {
    name: "history",
    heading: "審計記錄",
    retry: "重新載入審計記錄",
    empty: "暫時沒有記錄。",
    read: serverFns.listAnnualReturnCaseHistory,
    other: serverFns.listAnnualReturnCaseNotes,
    key: annualReturnQueryKeys.history(caseId),
    text: "Recovered history",
    data: [
      {
        kind: "audit",
        id: "saved-audit",
        createdAt: "2026-10-27T09:00:00Z",
        actorId: ownerId,
        actorName: "Ada Chan",
        actorRole: "Staff",
        action: "add_note",
        result: "succeeded",
        summary: "Recovered history",
        metadata: {},
      },
    ],
  },
];

it.each(contextReads)(
  "recovers failed $name reads independently while preserving the unsaved note draft",
  async (context) => {
    context.read.mockRejectedValueOnce(new Error("Context read unavailable"));
    renderDetail();
    await screen.findByRole("heading", { name: "Acme Company Limited" });
    const panel = within(
      screen.getByRole("heading", { name: context.heading }).closest("section")!,
    );
    await panel.findByRole("alert");
    expect(panel.queryByText(context.empty)).toBeNull();
    fireEvent.change(screen.getByLabelText("案件備註"), {
      target: { value: "Unsaved follow-up draft" },
    });
    const retry = panel.getByRole("button", { name: context.retry });
    let finish!: (value: unknown) => void;
    context.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    act(() => {
      retry.click();
      retry.click();
    });
    await waitFor(() => expect(context.read).toHaveBeenCalledTimes(2));
    expect(await panel.findByRole("status")).toBeTruthy();
    expect(panel.queryByText(context.empty)).toBeNull();
    expectNoCaseCommands();
    await act(async () => {
      finish(context.data);
    });
    expect(await panel.findByText(context.text)).toBeTruthy();
    expect(panel.queryByRole("alert")).toBeNull();
    expect((screen.getByLabelText("案件備註") as HTMLTextAreaElement).value).toBe(
      "Unsaved follow-up draft",
    );
    expect(context.read).toHaveBeenLastCalledWith({ data: { caseId } });
    expect(context.other).toHaveBeenCalledTimes(1);
    expect(serverFns.getAnnualReturnCase).toHaveBeenCalledTimes(1);
    expectNoCaseCommands();
  },
);

it.each(contextReads)(
  "keeps cached $name hidden after denial and recovers repeated failures only through its own list",
  async (context) => {
    context.read.mockResolvedValue(context.data);
    const { queryClient } = renderDetail();
    await screen.findByRole("heading", { name: "Acme Company Limited" });
    const panel = within(
      screen.getByRole("heading", { name: context.heading }).closest("section")!,
    );
    await panel.findByText(context.text);
    context.read.mockRejectedValue(new Error("Read denied"));
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: context.key, exact: true });
    });
    await panel.findByRole("alert");
    expect(panel.queryByText(context.text)).toBeNull();
    expect(panel.queryByText(context.empty)).toBeNull();
    let reject!: (reason: Error) => void;
    context.read.mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    const retry = panel.getByRole("button", { name: context.retry });
    act(() => {
      retry.click();
      retry.click();
    });
    await waitFor(() => expect(context.read).toHaveBeenCalledTimes(3));
    expect((retry as HTMLButtonElement).disabled).toBe(true);
    expect(panel.queryByText(context.text)).toBeNull();
    await act(async () => {
      reject(new Error("Still denied"));
    });
    await waitFor(() =>
      expect(
        (panel.getByRole("button", { name: context.retry }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(panel.queryByText(context.empty)).toBeNull();
    context.read.mockResolvedValue([]);
    fireEvent.click(panel.getByRole("button", { name: context.retry }));
    expect(await panel.findByText(context.empty)).toBeTruthy();
    expect(panel.queryByRole("alert")).toBeNull();
    expect(context.other).toHaveBeenCalledTimes(1);
    expect(serverFns.getAnnualReturnCase).toHaveBeenCalledTimes(1);
    expectNoCaseCommands();
  },
);

it("does not retry failed history when explicitly recovering failed notes", async () => {
  serverFns.listAnnualReturnCaseNotes.mockRejectedValue(new Error("Notes unavailable"));
  serverFns.listAnnualReturnCaseHistory.mockRejectedValue(new Error("History unavailable"));
  renderDetail();
  await screen.findByRole("heading", { name: "Acme Company Limited" });
  const notes = within(screen.getByRole("heading", { name: "備註" }).closest("section")!);
  const history = within(screen.getByRole("heading", { name: "審計記錄" }).closest("section")!);
  await notes.findByRole("alert");
  await history.findByRole("alert");
  serverFns.listAnnualReturnCaseNotes.mockResolvedValue(contextReads[0].data);
  fireEvent.click(notes.getByRole("button", { name: "重新載入備註" }));
  await notes.findByText("Recovered notes");
  expect(history.getByRole("button", { name: "重新載入審計記錄" })).toBeTruthy();
  expect(history.queryByText("暫時沒有記錄。")).toBeNull();
  expect(serverFns.listAnnualReturnCaseHistory).toHaveBeenCalledTimes(1);
  expect(serverFns.listAnnualReturnCaseNotes).toHaveBeenCalledTimes(2);
  expectNoCaseCommands();
});

function notePanel() {
  return within(screen.getByRole("heading", { name: "備註" }).closest("section")!);
}
async function uncertainNote() {
  serverFns.addAnnualReturnCaseNote.mockRejectedValueOnce(new Error("Note response lost"));
  const rendered = renderDetail();
  await screen.findByRole("heading", { name: "Acme Company Limited" });
  fireEvent.change(screen.getByLabelText("案件備註"), { target: { value: "Keep this draft." } });
  fireEvent.click(screen.getByRole("button", { name: "加入備註" }));
  await notePanel().findByRole("button", { name: "重新核對備註結果" });
  return rendered;
}

it("reads back an uncertain saved note without replaying it or clearing the retained draft", async () => {
  const { queryClient } = await uncertainNote();
  const panel = notePanel();
  expect((panel.getByRole("button", { name: "加入備註" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  let finish!: (value: unknown) => void;
  serverFns.listAnnualReturnCaseNotes.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const retry = panel.getByRole("button", { name: "重新核對備註結果" });
  act(() => {
    retry.click();
    retry.click();
  });
  await waitFor(() => expect(serverFns.listAnnualReturnCaseNotes).toHaveBeenCalledTimes(2));
  expect((retry as HTMLButtonElement).disabled).toBe(true);
  expect(serverFns.addAnnualReturnCaseNote).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish([{ id: "saved-note", body: "Keep this draft.", createdAt: "2026-10-27T09:00:00Z" }]);
  });
  expect(await panel.findByText("Keep this draft.", { selector: "p" })).toBeTruthy();
  expect(panel.getByText(/草稿仍保留/)).toBeTruthy();
  expect((screen.getByLabelText("案件備註") as HTMLTextAreaElement).value).toBe("Keep this draft.");
  expect(panel.queryByRole("alert")).toBeNull();
  expect(serverFns.addAnnualReturnCaseNote).toHaveBeenCalledTimes(1);
  expect(serverFns.listAnnualReturnCaseHistory).toHaveBeenCalledTimes(2);
  expect(serverFns.getAnnualReturnCase).toHaveBeenCalledTimes(1);
  expect(toast.success).not.toHaveBeenCalled();
  queryClient.clear();
});

it("keeps note writes blocked through failed recovery and background success while preserving edited drafts", async () => {
  const { queryClient } = await uncertainNote();
  fireEvent.change(screen.getByLabelText("案件備註"), { target: { value: "Revised follow-up" } });
  serverFns.listAnnualReturnCaseNotes.mockRejectedValueOnce(new Error("Read denied"));
  fireEvent.click(notePanel().getByRole("button", { name: "重新核對備註結果" }));
  await waitFor(() => expect(serverFns.listAnnualReturnCaseNotes).toHaveBeenCalledTimes(2));
  await waitFor(() =>
    expect(
      (notePanel().getByRole("button", { name: "重新核對備註結果" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  await act(async () => {
    await queryClient.invalidateQueries({
      queryKey: annualReturnQueryKeys.notes(caseId),
      exact: true,
    });
  });
  expect(
    (notePanel().getByRole("button", { name: "加入備註" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect((screen.getByLabelText("案件備註") as HTMLTextAreaElement).value).toBe(
    "Revised follow-up",
  );
  expect(serverFns.addAnnualReturnCaseNote).toHaveBeenCalledTimes(1);
  fireEvent.click(notePanel().getByRole("button", { name: "重新核對備註結果" }));
  await notePanel().findByText(/草稿仍保留/);
  expect(serverFns.addAnnualReturnCaseNote).toHaveBeenCalledTimes(1);
  fireEvent.click(notePanel().getByRole("button", { name: "加入備註" }));
  await waitFor(() => expect(serverFns.addAnnualReturnCaseNote).toHaveBeenCalledTimes(2));
  expect(serverFns.addAnnualReturnCaseNote).toHaveBeenLastCalledWith({
    data: { caseId, body: "Revised follow-up" },
  });
  await waitFor(() =>
    expect((screen.getByLabelText("案件備註") as HTMLTextAreaElement).value).toBe(""),
  );
  queryClient.clear();
});

it("admits one same-turn note submission and overrides configured automatic write retries", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: 1, retryDelay: 0 } },
  });
  let reject!: (reason: Error) => void;
  serverFns.addAnnualReturnCaseNote.mockImplementation(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  renderDetail(undefined, client);
  await screen.findByRole("heading", { name: "Acme Company Limited" });
  fireEvent.change(screen.getByLabelText("案件備註"), { target: { value: "One note only" } });
  const button = screen.getByRole("button", { name: "加入備註" });
  act(() => {
    button.click();
    button.click();
  });
  await waitFor(() => expect(serverFns.addAnnualReturnCaseNote).toHaveBeenCalledTimes(1));
  serverFns.addAnnualReturnCaseNote.mockRejectedValue(new Error("Unknown result"));
  await act(async () => {
    reject(new Error("Response lost"));
  });
  await notePanel().findByRole("button", { name: "重新核對備註結果" });
  expect(serverFns.addAnnualReturnCaseNote).toHaveBeenCalledTimes(1);
  client.clear();
});

it("does not unlock note writes from query cancellation or cache changes while independent readback is pending", async () => {
  const { queryClient } = await uncertainNote();
  let finish!: (value: unknown) => void;
  serverFns.listAnnualReturnCaseNotes.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(notePanel().getByRole("button", { name: "重新核對備註結果" }));
  await waitFor(() => expect(serverFns.listAnnualReturnCaseNotes).toHaveBeenCalledTimes(2));
  await act(async () => {
    await queryClient.cancelQueries({ queryKey: annualReturnQueryKeys.notes(caseId), exact: true });
  });
  act(() => {
    queryClient.setQueryData(annualReturnQueryKeys.notes(caseId), []);
  });
  expect(
    (notePanel().getByRole("button", { name: "加入備註" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(
    (notePanel().getByRole("button", { name: "重新核對備註結果" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  await act(async () => {
    finish([]);
  });
  await notePanel().findByText(/草稿仍保留/);
  expect(serverFns.addAnnualReturnCaseNote).toHaveBeenCalledTimes(1);
  queryClient.clear();
});

it("does not mistake an older pending notes read for reconciliation after an uncertain create", async () => {
  let reject!: (reason: Error) => void;
  serverFns.addAnnualReturnCaseNote.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  const { queryClient } = renderDetail();
  await screen.findByRole("heading", { name: "Acme Company Limited" });
  fireEvent.change(screen.getByLabelText("案件備註"), { target: { value: "Pending note" } });
  fireEvent.click(screen.getByRole("button", { name: "加入備註" }));
  await waitFor(() => expect(serverFns.addAnnualReturnCaseNote).toHaveBeenCalledTimes(1));
  let finishOld!: (value: unknown) => void;
  serverFns.listAnnualReturnCaseNotes
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    )
    .mockRejectedValueOnce(new Error("Fresh read denied"));
  act(() => {
    void queryClient.invalidateQueries({
      queryKey: annualReturnQueryKeys.notes(caseId),
      exact: true,
    });
  });
  await waitFor(() => expect(serverFns.listAnnualReturnCaseNotes).toHaveBeenCalledTimes(2));
  await act(async () => {
    reject(new Error("Unknown result"));
  });
  fireEvent.click(await notePanel().findByRole("button", { name: "重新核對備註結果" }));
  await waitFor(() => expect(serverFns.listAnnualReturnCaseNotes).toHaveBeenCalledTimes(3));
  await act(async () => {
    finishOld([]);
  });
  await waitFor(() =>
    expect(
      (notePanel().getByRole("button", { name: "重新核對備註結果" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  expect(
    (notePanel().getByRole("button", { name: "加入備註" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(serverFns.addAnnualReturnCaseNote).toHaveBeenCalledTimes(1);
  queryClient.clear();
});

it.each([null, undefined])(
  "keeps the note draft blocked on unavailable readback: %s",
  async (data) => {
    await uncertainNote();
    serverFns.listAnnualReturnCaseNotes.mockResolvedValueOnce(data);
    fireEvent.click(notePanel().getByRole("button", { name: "重新核對備註結果" }));
    await waitFor(() => expect(serverFns.listAnnualReturnCaseNotes).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        (notePanel().getByRole("button", { name: "重新核對備註結果" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect(
      (notePanel().getByRole("button", { name: "加入備註" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByLabelText("案件備註") as HTMLTextAreaElement).value).toBe(
      "Keep this draft.",
    );
    expect(serverFns.addAnnualReturnCaseNote).toHaveBeenCalledTimes(1);
  },
);

it("keeps a newer draft typed during a successful pending submission", async () => {
  let finish!: (value: unknown) => void;
  serverFns.addAnnualReturnCaseNote.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  renderDetail();
  await screen.findByRole("heading", { name: "Acme Company Limited" });
  fireEvent.change(screen.getByLabelText("案件備註"), { target: { value: "Submitted draft" } });
  fireEvent.click(screen.getByRole("button", { name: "加入備註" }));
  await waitFor(() => expect(serverFns.addAnnualReturnCaseNote).toHaveBeenCalledTimes(1));
  fireEvent.change(screen.getByLabelText("案件備註"), { target: { value: "New unsaved draft" } });
  await act(async () => {
    finish({});
  });
  expect((screen.getByLabelText("案件備註") as HTMLTextAreaElement).value).toBe(
    "New unsaved draft",
  );
  expect(serverFns.addAnnualReturnCaseNote).toHaveBeenLastCalledWith({
    data: { caseId, body: "Submitted draft" },
  });
});

it("isolates note uncertainty and late recovery from a newly opened case draft", async () => {
  const { queryClient, rerender } = await uncertainNote();
  let finishOld!: (value: unknown) => void;
  serverFns.listAnnualReturnCaseNotes.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishOld = resolve;
      }),
  );
  fireEvent.click(notePanel().getByRole("button", { name: "重新核對備註結果" }));
  await waitFor(() => expect(serverFns.listAnnualReturnCaseNotes).toHaveBeenCalledTimes(2));
  const newCaseId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  serverFns.getAnnualReturnCase.mockResolvedValue({ ...caseItem, id: newCaseId });
  rerender(
    <QueryClientProvider client={queryClient}>
      <ProductionAnnualReturnCaseDetail caseId={newCaseId} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Acme Company Limited" });
  expect((screen.getByLabelText("案件備註") as HTMLTextAreaElement).value).toBe("");
  fireEvent.change(screen.getByLabelText("案件備註"), { target: { value: "New case draft" } });
  await act(async () => {
    finishOld([]);
  });
  expect((screen.getByLabelText("案件備註") as HTMLTextAreaElement).value).toBe("New case draft");
  expect(notePanel().queryByRole("button", { name: "重新核對備註結果" })).toBeNull();
  expect(serverFns.addAnnualReturnCaseNote).toHaveBeenCalledTimes(1);
  queryClient.clear();
});
