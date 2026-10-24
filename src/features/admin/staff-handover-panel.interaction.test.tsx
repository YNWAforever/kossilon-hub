// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HandoverCommand, HandoverPage, StaffMember } from "./types";
const api = vi.hoisted(() => ({
  list: vi.fn(),
  preview: vi.fn(),
  execute: vi.fn(),
  receipt: vi.fn(),
  scope: vi.fn(),
  cancel: vi.fn(),
}));
vi.mock("./server-fns", () => ({
  listStaff: api.list,
  previewStaffHandover: api.preview,
  executeStaffHandover: api.execute,
  readStaffHandoverReceipt: api.receipt,
  previewReassignment: api.scope,
  cancelStaffHandover: api.cancel,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
  }: {
    to: string;
    params: { id: string };
    children: React.ReactNode;
  }) => <a href={to.replace("$id", params.id)}>{children}</a>,
}));
import { StaffHandoverPanel } from "./staff-handover-panel";
const uuid = (n: number) => `a30e04f1-0186-4186-8186-${String(n).padStart(12, "0")}`;
const member: StaffMember = {
  userId: uuid(1),
  displayName: "Source",
  email: "source@example.test",
  role: "Staff",
  teamId: uuid(99),
  teamName: "Synthetic",
  active: true,
  expectedVersion: 1,
  openCases: 104,
  openWorkItems: 0,
  lastLogin: null,
  stateMismatch: false,
};
const owner = { ...member, userId: uuid(2), displayName: "Owner" },
  reviewer = { ...member, userId: uuid(3), displayName: "Reviewer" };
const entries = Array.from({ length: 104 }, (_, i) => ({
  kind: "incorporation" as const,
  id: uuid(100 + i),
  title: `Case ${i}`,
  status: "Intake",
  owner: true,
  reviewer: false,
}));
const page: HandoverPage = {
  fingerprint: "a".repeat(64),
  caseCount: 104,
  workItemCount: 0,
  entries: entries.slice(0, 100),
  nextCursor: 100,
};
const receipt = (command: HandoverCommand) => ({
  operationId: command.operationId,
  userId: member.userId,
  actorId: uuid(9),
  expectedVersion: 2,
  caseCount: 104,
  workItemCount: 0,
  remainingCases: 0,
  remainingWorkItems: 0,
  replayed: false,
});
function mount(source = member) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <StaffHandoverPanel member={source} actorScope="verified-admin" />
    </QueryClientProvider>,
  );
}
async function select() {
  await within(screen.getByLabelText("負責接手人")).findByRole("option", { name: /Owner/ });
  fireEvent.change(screen.getByLabelText("負責接手人"), { target: { value: owner.userId } });
  fireEvent.change(screen.getByLabelText("覆核接手人"), { target: { value: reviewer.userId } });
  fireEvent.change(screen.getByLabelText("交接原因"), { target: { value: "員工離職責任交接" } });
}
async function fullPreview() {
  fireEvent.click(screen.getByText("預覽責任交接"));
  await screen.findByText(/仍有未列出的責任/);
  fireEvent.click(screen.getByText("載入下一頁責任"));
  await screen.findByRole("link", { name: /Case 103 · 負責/ });
}
beforeEach(() => {
  sessionStorage.clear();
  Object.values(api).forEach((f) => f.mockReset());
  api.list.mockImplementation(async ({ data }) => ({
    staff:
      data.q === member.userId
        ? [{ ...member, expectedVersion: 2, openCases: 0, openWorkItems: 0 }]
        : [owner, reviewer],
    nextCursor: null,
  }));
  api.preview.mockImplementation(async ({ data }) =>
    data.cursor ? { ...page, entries: entries.slice(100), nextCursor: null } : page,
  );
  api.execute.mockImplementation(async ({ data }) => receipt(data));
  api.cancel.mockImplementation(async ({ data }) => ({
    status: "cancelled",
    operationId: data.operationId,
  }));
  api.scope.mockResolvedValue({
    userId: member.userId,
    expectedVersion: 2,
    openCases: 0,
    openWorkItems: 0,
    cases: [],
    workItems: [],
    truncated: false,
  });
});
afterEach(cleanup);
describe("UC186 explicit handover confirmation (mock RPC only)", () => {
  it("UC186 preserves a newer pending operation when a superseded instance receives its old response", async () => {
    let resolveA!: (v: ReturnType<typeof receipt>) => void,
      resolveB!: (v: ReturnType<typeof receipt>) => void;
    api.execute
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveA = r;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveB = r;
          }),
      );
    const first = mount();
    await select();
    await fullPreview();
    fireEvent.click(screen.getByText("確認交接全部責任"));
    await waitFor(() => expect(api.execute).toHaveBeenCalledTimes(1));
    const commandA = api.execute.mock.calls[0][0].data;
    first.unmount();
    mount({ ...member, expectedVersion: 2 });
    api.receipt.mockResolvedValue({ ...receipt(commandA), replayed: true });
    await screen.findByText("核對交接收據");
    fireEvent.click(screen.getByText("核對交接收據"));
    await screen.findByText(/資料已重新讀取/);
    await select();
    await fullPreview();
    fireEvent.click(screen.getByText("確認交接全部責任"));
    await waitFor(() => expect(api.execute).toHaveBeenCalledTimes(2));
    const commandB = api.execute.mock.calls[1][0].data;
    const key = `kossilon:handover:verified-admin:${member.userId}`;
    expect(commandB.operationId).not.toBe(commandA.operationId);
    try {
      await act(async () => {
        resolveA(receipt(commandA));
      });
      expect(JSON.parse(sessionStorage.getItem(key) ?? "null")?.command?.operationId).toBe(
        commandB.operationId,
      );
      expect(api.scope).toHaveBeenCalledTimes(1);
    } finally {
      api.list.mockImplementation(async ({ data }) => ({
        staff:
          data.q === member.userId
            ? [{ ...member, expectedVersion: 3, openCases: 0, openWorkItems: 0 }]
            : [owner, reviewer],
        nextCursor: null,
      }));
      api.scope.mockResolvedValue({
        userId: member.userId,
        expectedVersion: 3,
        openCases: 0,
        openWorkItems: 0,
        cases: [],
        workItems: [],
        truncated: false,
      });
      await act(async () => {
        resolveB({ ...receipt(commandB), expectedVersion: 3 });
      });
    }
  });
  it("requires all pages, cancellation writes nothing, then confirms once and independently reads current scope", async () => {
    mount();
    await select();
    fireEvent.click(screen.getByText("預覽責任交接"));
    await screen.findByText(/仍有未列出的責任/);
    expect((screen.getByText("確認交接全部責任") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText("取消預覽"));
    expect(api.execute).not.toHaveBeenCalled();
    expect(sessionStorage.length).toBe(0);
    await fullPreview();
    fireEvent.click(screen.getByText("確認交接全部責任"));
    await screen.findByText(/資料已重新讀取：目前未交案件 0/);
    expect(api.execute).toHaveBeenCalledTimes(1);
    expect(api.execute.mock.calls[0][0].data).toMatchObject({
      userId: member.userId,
      expectedVersion: 1,
      owner: { userId: owner.userId, expectedVersion: 1 },
      reviewer: { userId: reviewer.userId, expectedVersion: 1 },
      reason: "員工離職責任交接",
      fingerprint: page.fingerprint,
    });
    expect(api.scope).toHaveBeenCalledExactlyOnceWith({
      data: { userId: member.userId, expectedVersion: 2 },
    });
    expect(sessionStorage.length).toBe(0);
  });
  it("retains the exact operation on lost response and remount; only explicit retry sends it again", async () => {
    api.execute.mockRejectedValueOnce(new Error("synthetic response lost"));
    const first = mount();
    await select();
    await fullPreview();
    fireEvent.click(screen.getByText("確認交接全部責任"));
    await screen.findByText(/未能確定提交結果/);
    const original = api.execute.mock.calls[0][0].data;
    first.unmount();
    mount({ ...member, expectedVersion: 2 });
    await screen.findByText("用同一操作編號重試");
    expect(api.execute).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("用同一操作編號重試"));
    await screen.findByText(/資料已重新讀取/);
    expect(api.execute).toHaveBeenCalledTimes(2);
    expect(api.execute.mock.calls[1][0].data).toEqual(original);
    expect(sessionStorage.length).toBe(0);
  });
  it("reads a committed receipt after unknown response without issuing another command; scope read failure stays unresolved", async () => {
    api.execute.mockRejectedValueOnce(new Error("synthetic response lost"));
    mount();
    await select();
    await fullPreview();
    fireEvent.click(screen.getByText("確認交接全部責任"));
    await screen.findByText(/未能確定提交結果/);
    const original = api.execute.mock.calls[0][0].data;
    api.receipt.mockResolvedValue({ ...receipt(original), replayed: true });
    api.scope.mockRejectedValueOnce(new Error("synthetic read unavailable"));
    fireEvent.click(screen.getByText("核對交接收據"));
    await waitFor(() => expect(api.scope).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.queryByText(/資料已重新讀取/)).toBeNull();
    expect(sessionStorage.length).toBe(1);
    fireEvent.click(screen.getByText("核對交接收據"));
    await screen.findByText(/資料已重新讀取/);
    expect(api.execute).toHaveBeenCalledTimes(1);
    expect(api.receipt).toHaveBeenCalledTimes(2);
    expect(sessionStorage.length).toBe(0);
  });
  it("never turns a preview error into empty scope, and empty scope cannot be submitted", async () => {
    api.preview.mockRejectedValueOnce(new Error("synthetic unavailable"));
    mount();
    await select();
    fireEvent.click(screen.getByText("預覽責任交接"));
    await screen.findByRole("alert");
    expect(screen.queryByText(/沒有未交責任/)).toBeNull();
    expect((screen.getByText("確認交接全部責任") as HTMLButtonElement).disabled).toBe(true);
    api.preview.mockResolvedValue({
      ...page,
      caseCount: 0,
      workItemCount: 0,
      entries: [],
      nextCursor: null,
    });
    fireEvent.click(screen.getByText("預覽責任交接"));
    await screen.findByText("沒有未交責任，沒有執行交接。");
    expect((screen.getByText("確認交接全部責任") as HTMLButtonElement).disabled).toBe(true);
    expect(api.execute).not.toHaveBeenCalled();
  });
  it("preserves cancellation intent on lost response and remount; never re-executes the handover", async () => {
    api.execute.mockRejectedValueOnce(new Error("synthetic response lost"));
    api.cancel.mockRejectedValueOnce(new Error("synthetic cancellation response lost"));
    const first = mount();
    await select();
    await fullPreview();
    fireEvent.click(screen.getByText("確認交接全部責任"));
    await screen.findByText(/未能確定提交結果/);
    const command = api.execute.mock.calls[0][0].data;
    fireEvent.click(screen.getByText("取消待核實交接"));
    await screen.findByText(/未能核實取消結果/);
    first.unmount();
    mount();
    await screen.findByText("重試取消交接");
    expect((screen.getByText("用同一操作編號重試") as HTMLButtonElement).disabled).toBe(true);
    expect(api.execute).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("重試取消交接"));
    await screen.findByText(/此操作已取消/);
    expect(api.cancel).toHaveBeenCalledTimes(2);
    expect(api.cancel.mock.calls[0][0].data).toEqual(command);
    expect(api.cancel.mock.calls[1][0].data).toEqual(command);
    expect(api.execute).toHaveBeenCalledTimes(1);
    expect(sessionStorage.length).toBe(0);
  });
});
