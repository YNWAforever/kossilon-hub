// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({
  role: "Staff" as "Staff" | "Manager",
  bulkCommand: vi.fn(),
  page: vi.fn(),
  cases: vi.fn(),
  review: vi.fn(),
  download: vi.fn(),
  preview: vi.fn(),
  intent: vi.fn(),
  finalize: vi.fn(),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (options: unknown) => ({
    options,
    useRouteContext: () => ({ dataMode: "production", actor: { role: rpc.role, active: true } }),
    useSearch: () => ({}),
    useNavigate: () => vi.fn(),
  }),
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}));
vi.mock("../features/documents/server-fns", () => ({
  listDocumentPage: rpc.page,
  downloadDocument: rpc.download,
  previewDocumentRecovery: rpc.preview,
  createDocumentUploadIntent: rpc.intent,
  finalizeDocumentUpload: rpc.finalize,
}));
vi.mock("../features/annual-return/server-fns", () => ({
  listAnnualReturnCases: rpc.cases,
  getAnnualReturnCase: async () => null,
}));
vi.mock("../features/annual-return/evidence-server-fns", () => ({
  reviewAnnualReturnEvidenceAction: rpc.review,
}));
vi.mock("../features/bulk-operations/server-fns", () => ({
  listBulkAssignees: async () => [],
  listBulkJobs: async () => ({ jobs: [], nextCursor: null }),
  createBulkSelectionSnapshot: rpc.bulkCommand,
  getBulkSnapshotMembership: rpc.bulkCommand,
  previewBulkAssignment: rpc.bulkCommand,
  previewBulkMaintenance: rpc.bulkCommand,
  executeBulkAssignment: rpc.bulkCommand,
  getBulkJob: rpc.bulkCommand,
  resumeBulkJob: rpc.bulkCommand,
  cancelBulkJob: rpc.bulkCommand,
  retryFailedBulkItems: rpc.bulkCommand,
  reconcileUnknownBulkItems: rpc.bulkCommand,
  exportBulkResults: rpc.bulkCommand,
}));
import { Route } from "./documents";
const staffDocument = {
  id: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  caseId: "33333333-3333-4333-8333-333333333333",
  category: "receipt",
  fileName: "staff-proof.pdf",
  currentVersionId: "44444444-4444-4444-8444-444444444444",
  uploadStatus: "available",
  scanVerdictSource: "provider",
  reviewStatus: "pending",
  availability: "available",
  uploadedAt: "2026-10-27T00:00:00Z",
};
beforeEach(() => {
  vi.resetAllMocks();
  rpc.role = "Staff";
  rpc.cases.mockResolvedValue([]);
  rpc.page.mockResolvedValue({ documents: [staffDocument], nextCursor: null });
});
async function archive() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const Component = Route.options.component!;
  await Component.preload?.();
  render(
    <QueryClientProvider client={client}>
      <Component />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "正式文件庫" });
  return client;
}
function expectNoDocumentCommands() {
  for (const command of [rpc.review, rpc.preview, rpc.intent, rpc.finalize, rpc.download])
    expect(command).not.toHaveBeenCalled();
}

afterEach(cleanup);

it("sends global filters to the RPC and restarts at page one after paging", async () => {
  rpc.page.mockImplementation(async ({ data }) => ({
    documents: [],
    nextCursor: data.cursor || data.q ? null : "next-page",
  }));
  const Component = Route.options.component!;
  await Component.preload?.();
  await act(async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <Component />
      </QueryClientProvider>,
    );
  });
  fireEvent.click(await screen.findByRole("button", { name: "載入更多文件" }));
  await waitFor(() =>
    expect(rpc.page).toHaveBeenCalledWith({ data: { cursor: "next-page", limit: 100 } }),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "搜尋正式文件" }), {
    target: { value: "needle" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "按類別篩選正式文件" }), {
    target: { value: "payment" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "按來源篩選正式文件" }), {
    target: { value: "client" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "按覆核狀態篩選正式文件" }), {
    target: { value: "pending" },
  });
  await waitFor(() =>
    expect(rpc.page).toHaveBeenLastCalledWith({
      data: {
        cursor: undefined,
        limit: 100,
        q: "needle",
        category: "payment",
        source: "client",
        reviewStatus: "pending",
      },
    }),
  );
});

it("recovers failed document reads without replaying commands and uses fresh proof version only for an explicit rejection", async () => {
  rpc.page.mockRejectedValueOnce(new Error("Archive unavailable"));
  const client = await archive();
  const retry = await screen.findByRole("button", { name: "重新載入正式文件" });
  expect(screen.queryByText("此範圍內沒有正式文件。")).toBeNull();
  expect(screen.queryByRole("button", { name: "核對" })).toBeNull();
  let finish!: (value: unknown) => void;
  rpc.page.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  act(() => {
    retry.click();
    retry.click();
  });
  await waitFor(() => expect(rpc.page).toHaveBeenCalledTimes(2));
  expect(await screen.findByRole("status")).toBeTruthy();
  expectNoDocumentCommands();
  await act(async () => {
    finish({
      documents: [{ ...staffDocument, currentVersionId: "55555555-5555-4555-8555-555555555555" }],
      nextCursor: null,
    });
  });
  await screen.findByText("staff-proof.pdf");
  expect(rpc.cases).toHaveBeenCalledTimes(1);
  expectNoDocumentCommands();
  rpc.review.mockImplementation(() => new Promise(() => {}));
  fireEvent.click(screen.getByRole("button", { name: "退回" }));
  fireEvent.change(screen.getByLabelText("給客戶的「staff-proof.pdf」說明"), {
    target: { value: "New rejection detail" },
  });
  fireEvent.click(screen.getByRole("button", { name: "確認退回" }));
  await waitFor(() => expect(rpc.review).toHaveBeenCalledTimes(1));
  expect(rpc.review.mock.calls[0][0]).toEqual({
    data: expect.objectContaining({
      documentId: staffDocument.id,
      caseId: staffDocument.caseId,
      expectedDocumentVersionId: "55555555-5555-4555-8555-555555555555",
      decision: "rejected",
      reason: "missing-page: 缺頁 — New rejection detail",
    }),
  });
  client.clear();
});

it("hides cached document review and recovery controls during a denied refresh and repeated retry failures", async () => {
  const client = await archive();
  await screen.findByText("staff-proof.pdf");
  let deny!: (reason: Error) => void;
  rpc.page.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        deny = reject;
      }),
  );
  act(() => {
    void client.invalidateQueries({ queryKey: ["documents", "archive"] });
  });
  await screen.findByRole("status");
  expect(screen.queryByText("staff-proof.pdf")).toBeNull();
  for (const name of ["核對", "退回", "預覽受控補傳"])
    expect(screen.queryByRole("button", { name })).toBeNull();
  await act(async () => {
    deny(new Error("Read denied"));
  });
  rpc.page.mockRejectedValueOnce(new Error("Still denied"));
  fireEvent.click(await screen.findByRole("button", { name: "重新載入正式文件" }));
  await waitFor(() => expect(rpc.page).toHaveBeenCalledTimes(3));
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "重新載入正式文件" }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  expect(screen.queryByText("staff-proof.pdf")).toBeNull();
  expect(screen.queryByText("此範圍內沒有正式文件。")).toBeNull();
  rpc.page.mockResolvedValue({
    documents: [{ ...staffDocument, uploadStatus: "rejected" }],
    nextCursor: null,
  });
  fireEvent.click(screen.getByRole("button", { name: "重新載入正式文件" }));
  await screen.findByText("staff-proof.pdf");
  expect(screen.queryByRole("button", { name: "核對" })).toBeNull();
  expect(screen.queryByRole("button", { name: "退回" })).toBeNull();
  expectNoDocumentCommands();
  client.clear();
});

it("restores an empty document archive only after successful empty recovery", async () => {
  rpc.page
    .mockRejectedValueOnce(new Error("Unavailable"))
    .mockResolvedValue({ documents: [], nextCursor: null });
  const client = await archive();
  fireEvent.click(await screen.findByRole("button", { name: "重新載入正式文件" }));
  expect(await screen.findByText("此範圍內沒有正式文件。")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "重新載入正式文件" })).toBeNull();
  expectNoDocumentCommands();
  client.clear();
});

it("requires complete archive read recovery after pagination failure before restoring review controls", async () => {
  rpc.page
    .mockResolvedValueOnce({ documents: [staffDocument], nextCursor: "next-page" })
    .mockRejectedValueOnce(new Error("Next page denied"));
  const client = await archive();
  await screen.findByText("staff-proof.pdf");
  fireEvent.click(screen.getByRole("button", { name: "載入更多文件" }));
  const retry = await screen.findByRole("button", { name: "重新載入正式文件" });
  expect(screen.queryByText("staff-proof.pdf")).toBeNull();
  expect(screen.queryByRole("button", { name: "核對" })).toBeNull();
  expect((screen.getByRole("button", { name: "載入更多文件" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  rpc.page.mockResolvedValue({ documents: [staffDocument], nextCursor: null });
  fireEvent.click(retry);
  await screen.findByText("staff-proof.pdf");
  expect(rpc.page).toHaveBeenLastCalledWith({ data: { cursor: undefined, limit: 100 } });
  expect(screen.getByRole("button", { name: "核對" })).toBeTruthy();
  expectNoDocumentCommands();
  client.clear();
});

it("disables manager bulk actions on archive failure without discarding the selection session", async () => {
  rpc.role = "Manager";
  const client = await archive();
  await screen.findByText("staff-proof.pdf", { selector: "p" });
  fireEvent.click(screen.getByText("批量日常維護"));
  fireEvent.click(screen.getByText("核對已載入紀錄與排除項"));
  fireEvent.click(screen.getByLabelText("選取 staff-proof.pdf"));
  expect(screen.getByText("已選取1筆")).toBeTruthy();
  const selectAll = screen.getByRole("button", { name: "選取全部篩選結果" });
  expect(selectAll.matches(":disabled")).toBe(false);
  rpc.page.mockRejectedValue(new Error("Archive read denied"));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["documents", "archive"] });
  });
  await screen.findByRole("button", { name: "重新載入正式文件" });
  expect(selectAll.matches(":disabled")).toBe(true);
  expect(screen.getByText("已選取1筆")).toBeTruthy();
  selectAll.click();
  expect(rpc.bulkCommand).not.toHaveBeenCalled();
  rpc.page.mockResolvedValue({ documents: [staffDocument], nextCursor: null });
  fireEvent.click(screen.getByRole("button", { name: "重新載入正式文件" }));
  await screen.findByText("staff-proof.pdf", { selector: "p" });
  expect(selectAll.matches(":disabled")).toBe(false);
  expect((screen.getByLabelText("選取 staff-proof.pdf") as HTMLInputElement).checked).toBe(true);
  expectNoDocumentCommands();
  client.clear();
});
