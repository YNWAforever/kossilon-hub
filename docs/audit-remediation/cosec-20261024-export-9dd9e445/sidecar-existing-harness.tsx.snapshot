// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  snapshot: vi.fn(),
  membership: vi.fn(),
  preview: vi.fn(),
  maintenance: vi.fn(),
  execute: vi.fn(),
  jobs: vi.fn(),
  get: vi.fn(),
  resume: vi.fn(),
  cancel: vi.fn(),
  retry: vi.fn(),
  reconcile: vi.fn(),
  export: vi.fn(),
  assignees: vi.fn(),
}));
vi.mock("@/features/bulk-operations/server-fns", () => ({
  createBulkSelectionSnapshot: api.snapshot,
  getBulkSnapshotMembership: api.membership,
  previewBulkAssignment: api.preview,
  previewBulkMaintenance: api.maintenance,
  executeBulkAssignment: api.execute,
  listBulkJobs: api.jobs,
  getBulkJob: api.get,
  resumeBulkJob: api.resume,
  cancelBulkJob: api.cancel,
  retryFailedBulkItems: api.retry,
  reconcileUnknownBulkItems: api.reconcile,
  exportBulkResults: api.export,
  listBulkAssignees: api.assignees,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, params }: { children: React.ReactNode; params: { id: string } }) => (
    <a href={"/annual-returns/" + params.id}>{children}</a>
  ),
}));
import { BulkSelectionToolbar } from "./bulk-selection-toolbar";
const ids = Array.from(
    { length: 50 },
    (_, i) => `40000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`,
  ),
  assignee = "20000000-0000-0000-0000-000000000003",
  snapshotId = "60000000-0000-0000-0000-000000000001";
const page = ids.map((id, i) => ({ id, label: `Scoped case ${i + 1}` }));
beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.jobs.mockResolvedValue({ jobs: [], nextCursor: null });
  api.assignees.mockResolvedValue([
    { id: assignee, name: "Mei Lam", teamName: "Annual return", role: "Staff", teamId: null },
  ]);
  api.snapshot.mockResolvedValue({ snapshotId, count: 1240 });
  api.membership.mockImplementation(async ({ data }) => ({ ids: data.ids }));
  api.preview.mockResolvedValue({
    previewId: snapshotId,
    count: 1239,
    eligibleCount: 1239,
    reasons: { forbidden: 0, locked: 0, failed: 0, conflict: 0 },
    payloadHash: "h",
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function setup(total: number | null = 1240) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const element = (filters = { q: "scoped" }, p = page, actorScope = "manager-A") => (
    <QueryClientProvider client={client}>
      <BulkSelectionToolbar
        actorScope={actorScope}
        resource="annual_return_case"
        filters={filters}
        page={p}
        total={total}
      />
    </QueryClientProvider>
  );
  const rendered = render(element());
  return { ...rendered, element };
}
describe("explicit scope and durable bulk toolbar", () => {
  it("F30 / UC110: creates a server-counted snapshot while total is unknown", async () => {
    setup(null);
    const button = screen.getByRole("button", {
      name: "選取全部篩選結果",
      hidden: true,
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    await screen.findByText(/已固定全部1240/);
    expect(api.snapshot).toHaveBeenCalledWith({
      data: { resource: "annual_return_case", filters: { q: "scoped" } },
    });
  });
  it("shows calculating and empty snapshot states without inventing a total", async () => {
    let resolve!: (value: unknown) => void;
    api.snapshot.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    setup(null);
    fireEvent.click(screen.getByText("選取全部篩選結果"));
    expect(await screen.findByText("正在計算範圍…")).toBeTruthy();
    expect((screen.getByText("清空選取") as HTMLButtonElement).disabled).toBe(true);
    await act(async () => resolve({ snapshotId, count: 0 }));
    expect(await screen.findByText("此篩選範圍沒有可選取紀錄。")).toBeTruthy();
    expect(screen.getByText("已選取0筆")).toBeTruthy();
    expect(api.preview).not.toHaveBeenCalled();
  });
  it("keeps a failed calculation distinct from empty and permits an explicit retry", async () => {
    api.snapshot.mockRejectedValueOnce(new Error("count unavailable"));
    setup(null);
    fireEvent.click(screen.getByText("選取全部篩選結果"));
    expect(await screen.findByText("未能計算範圍；請重試選取全部篩選結果。")).toBeTruthy();
    expect(screen.queryByText("此篩選範圍沒有可選取紀錄。")).toBeNull();
    expect(api.snapshot).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByText("選取全部篩選結果"));
    await screen.findByText(/已固定全部1240/);
    expect(api.snapshot).toHaveBeenCalledTimes(2);
  });
  it("polls an active job until partial, then stops without retrying unknown items", async () => {
    vi.useFakeTimers();
    api.jobs.mockResolvedValue({
      jobs: [{ jobId: snapshotId, state: "queued", total: 2, createdAt: "2026-10-01T00:00:00Z" }],
      nextCursor: null,
    });
    const job = {
      jobId: snapshotId,
      resource: "annual_return_case",
      operation: "follow_up_draft",
      createdBy: assignee,
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-01T00:00:05Z",
      payloadHash: "approved-content-hash",
      total: 2,
      retryableFailedCount: 0,
      items: [],
      nextCursor: null,
    };
    api.get
      .mockResolvedValueOnce({ ...job, state: "queued", counts: { pending: 2 } })
      .mockResolvedValueOnce({ ...job, state: "running", counts: { pending: 1, succeeded: 1 } })
      .mockResolvedValue({ ...job, state: "partial", counts: { succeeded: 1, unknown: 1 } });
    setup();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    fireEvent.change(screen.getByLabelText("已保存工作"), { target: { value: snapshotId } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/操作：追件草稿/)).toBeTruthy();
    expect(screen.getByText(/範圍：周年申報案件.*2筆/)).toBeTruthy();
    expect(screen.getByText(/建立者：/).textContent).toContain(assignee);
    expect(screen.getByText(/最後進度更新：/)).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(api.get).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(api.get).toHaveBeenCalledTimes(3);
    expect(screen.getByText(/結果未知1/)).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(api.get).toHaveBeenCalledTimes(3);
    expect(api.resume).not.toHaveBeenCalled();
    expect(api.retry).not.toHaveBeenCalled();
  });
  it("bounds automatic reads of a stranded job and still permits manual refresh", async () => {
    vi.useFakeTimers();
    api.jobs.mockResolvedValue({
      jobs: [{ jobId: snapshotId, state: "queued", total: 2, createdAt: "2026-10-01T00:00:00Z" }],
      nextCursor: null,
    });
    api.get.mockResolvedValue({
      jobId: snapshotId,
      resource: "annual_return_case",
      state: "queued",
      total: 2,
      counts: { pending: 2 },
      items: [],
      nextCursor: null,
    });
    setup();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    fireEvent.change(screen.getByLabelText("已保存工作"), { target: { value: snapshotId } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400_000);
    });
    const calls = api.get.mock.calls.length;
    expect(calls).toBeGreaterThan(1);
    expect(calls).toBeLessThanOrEqual(61);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(api.get).toHaveBeenCalledTimes(calls);
    fireEvent.click(screen.getByText("刷新工作結果"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(api.get).toHaveBeenCalledTimes(calls + 1);
    expect(api.resume).not.toHaveBeenCalled();
  });
  it.each(["completed", "cancelled", "unrecognised"])(
    "stops polling at %s without treating it as a retry request",
    async (state) => {
      vi.useFakeTimers();
      api.jobs.mockResolvedValue({
        jobs: [{ jobId: snapshotId, state: "queued", total: 2, createdAt: "2026-10-01T00:00:00Z" }],
        nextCursor: null,
      });
      api.get
        .mockResolvedValueOnce({
          jobId: snapshotId,
          resource: "annual_return_case",
          state: "running",
          total: 2,
          counts: { pending: 2 },
          items: [],
          nextCursor: null,
        })
        .mockResolvedValue({
          jobId: snapshotId,
          resource: "annual_return_case",
          state,
          total: 2,
          counts: { unknown: 2 },
          items: [],
          nextCursor: null,
        });
      setup();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      fireEvent.change(screen.getByLabelText("已保存工作"), { target: { value: snapshotId } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_100);
      });
      expect(api.get).toHaveBeenCalledTimes(2);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(api.get).toHaveBeenCalledTimes(2);
      expect(api.resume).not.toHaveBeenCalled();
      expect(api.retry).not.toHaveBeenCalled();
      expect(screen.queryByText(/工作狀態：已完成/)).toBeNull();
    },
  );
  it("stops after a failed progress read and retains unknown rather than confirming success", async () => {
    vi.useFakeTimers();
    api.jobs.mockResolvedValue({
      jobs: [{ jobId: snapshotId, state: "queued", total: 2, createdAt: "2026-10-01T00:00:00Z" }],
      nextCursor: null,
    });
    api.get
      .mockResolvedValueOnce({
        jobId: snapshotId,
        resource: "annual_return_case",
        state: "running",
        total: 2,
        counts: { pending: 1, unknown: 1 },
        items: [],
        nextCursor: null,
      })
      .mockRejectedValue(new Error("read timeout"));
    setup();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    fireEvent.change(screen.getByLabelText("已保存工作"), { target: { value: snapshotId } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_100);
    });
    expect(screen.getByText(/工作結果未能刷新/)).toBeTruthy();
    expect(screen.getByText(/結果未知1/)).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(api.retry).not.toHaveBeenCalled();
  });
  it("conserves a snapshot across pages and two exclusions, with new rows outside membership", async () => {
    const v = setup(null);
    fireEvent.click(screen.getByText("選取全部篩選結果"));
    await screen.findByText(/已固定全部1240/);
    await waitFor(() =>
      expect((screen.getByLabelText("選取 Scoped case 1") as HTMLInputElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByLabelText("選取 Scoped case 1"));
    api.membership.mockResolvedValue({ ids: [ids[1]] });
    v.rerender(v.element({ q: "scoped" }, [page[1], { id: "new-row", label: "Added later" }]));
    await waitFor(() =>
      expect((screen.getByLabelText("選取 Scoped case 2") as HTMLInputElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByLabelText("選取 Scoped case 2"));
    expect(screen.getByText("已選取1238筆")).toBeTruthy();
    expect((screen.getByLabelText("選取 Added later") as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("同事"), { target: { value: assignee } });
    fireEvent.click(screen.getByText("預覽批量分配"));
    await waitFor(() =>
      expect(api.preview).toHaveBeenCalledWith({
        data: {
          resource: "annual_return_case",
          selection: { mode: "filtered_snapshot", snapshotId, excludedIds: [ids[0], ids[1]] },
          assignment: { target: "owner", assigneeId: assignee },
        },
      }),
    );
  });
  it("does not offer retry or reconciliation of a cancelled job", async () => {
    api.jobs.mockResolvedValue({
      jobs: [
        { jobId: snapshotId, state: "cancelled", total: 3, createdAt: "2026-10-01T00:00:00Z" },
      ],
      nextCursor: null,
    });
    api.get.mockResolvedValue({
      jobId: snapshotId,
      resource: "annual_return_case",
      state: "cancelled",
      total: 3,
      counts: { succeeded: 1, failed: 1, unknown: 1 },
      retryableFailedCount: 1,
      items: [],
      nextCursor: null,
    });
    setup();
    await screen.findByRole("option", { name: /3筆.*已取消/ });
    fireEvent.change(screen.getByLabelText("已保存工作"), { target: { value: snapshotId } });
    await screen.findByText(/結果未知1/);
    expect((screen.getByText("只重試可重試失敗") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("先核對未知結果") as HTMLButtonElement).disabled).toBe(true);
    expect(api.retry).not.toHaveBeenCalled();
    expect(api.reconcile).not.toHaveBeenCalled();
  });
  it("does not reuse a late snapshot after an actor change", async () => {
    let resolve!: (value: unknown) => void;
    api.snapshot.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const v = setup(null);
    fireEvent.click(screen.getByText("選取全部篩選結果"));
    await waitFor(() => expect(api.snapshot).toHaveBeenCalledOnce());
    v.rerender(v.element({ q: "scoped" }, page, "manager-B"));
    await act(async () => resolve({ snapshotId, count: 1240 }));
    expect(screen.queryByText(/已固定全部1240/)).toBeNull();
    expect(screen.getByText("已選取0筆")).toBeTruthy();
  });
  it("searches beyond the bounded staff page before bulk preview", async () => {
    api.assignees.mockImplementation(async ({ data }) =>
      data.q === "201" ? [{ id: assignee, name: "Member201", role: "Staff", teamId: null }] : [],
    );
    setup();
    fireEvent.change(screen.getByLabelText("搜尋同事"), { target: { value: "201" } });
    await screen.findByText(/Member201/);
    expect(api.assignees).toHaveBeenLastCalledWith({ data: { q: "201", limit: 200 } });
  });
  it("previews a draft-only maintenance action without an assignee and invalidates approval on action changes", async () => {
    api.maintenance.mockResolvedValue({
      previewId: snapshotId,
      count: 1,
      eligibleCount: 1,
      reasons: { forbidden: 0, locked: 0, failed: 0, conflict: 0 },
      payloadHash: "draft-hash",
      details: [
        {
          id: ids[0],
          output: {
            kind: "follow_up_draft",
            messagePreview: "Synthetic draft, no dispatch",
            status: "draft",
          },
        },
      ],
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={client}>
        <BulkSelectionToolbar
          actorScope="manager"
          resource="annual_return_case"
          filters={{}}
          page={page.slice(0, 1)}
          total={1}
          maintenanceActions={["follow_up_draft", "payment_list_export"]}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByText("選取已載入紀錄"));
    fireEvent.click(screen.getByText("預覽批量維護"));
    await waitFor(() =>
      expect(api.maintenance).toHaveBeenCalledWith({
        data: {
          resource: "annual_return_case",
          selection: { mode: "explicit_ids", ids: [ids[0]] },
          action: { kind: "follow_up_draft" },
        },
      }),
    );
    expect(await screen.findByText("Synthetic draft, no dispatch")).toBeTruthy();
    expect(screen.getByText("批准並建立維護工作")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("批量操作"), {
      target: { value: "payment_list_export" },
    });
    expect(screen.queryByText("批准並建立維護工作")).toBeNull();
    expect(api.execute).not.toHaveBeenCalled();
    expect(api.preview).not.toHaveBeenCalled();
  });
  it("loads older saved job pages after refresh", async () => {
    api.jobs.mockImplementation(async ({ data }) =>
      data.cursor
        ? {
            jobs: [
              { jobId: ids[0], state: "partial", total: 100, createdAt: "2026-09-01T00:00:00Z" },
            ],
            nextCursor: null,
          }
        : { jobs: [], nextCursor: { id: snapshotId, createdAt: "2026-10-01T00:00:00.000001Z" } },
    );
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "載入較早的工作" }));
    await screen.findByRole("option", { name: /100筆.*部分完成/ });
    expect(api.jobs).toHaveBeenLastCalledWith({
      data: { cursor: { id: snapshotId, createdAt: "2026-10-01T00:00:00.000001Z" } },
    });
  });
  it("shows business labels and allows safe failures on later result pages to be retried", async () => {
    api.jobs.mockResolvedValue({
      jobs: [
        { jobId: snapshotId, state: "partial", total: 100, createdAt: "2026-10-01T00:00:00Z" },
      ],
      nextCursor: null,
    });
    api.get.mockResolvedValue({
      jobId: snapshotId,
      resource: "annual_return_case",
      state: "partial",
      total: 100,
      retryableFailedCount: 1,
      counts: { succeeded: 99, failed: 1 },
      items: [
        {
          ordinal: 0,
          resourceId: ids[0],
          resourceLabel: "Business company",
          state: "succeeded",
          reason: null,
          retryable: false,
          attempts: 1,
        },
      ],
      nextCursor: 50,
    });
    setup();
    await screen.findByRole("option", { name: /100筆.*部分完成/ });
    fireEvent.change(screen.getByLabelText("已保存工作"), { target: { value: snapshotId } });
    expect(await screen.findByRole("link", { name: "Business company" })).toBeTruthy();
    expect((screen.getByText("只重試可重試失敗") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(ids[0])).toBeNull();
  });
  it("states page50/total1240; all-filter selection uses a server snapshot and exclusions", async () => {
    setup();
    await screen.findByRole("option", { name: /Mei Lam/ });
    expect(screen.getByText(/每頁50.*全部1240/)).toBeTruthy();
    fireEvent.click(screen.getByText("選取全部篩選結果"));
    await screen.findByText(/已固定全部1240/);
    await waitFor(() =>
      expect((screen.getByLabelText("選取 Scoped case 1") as HTMLInputElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByLabelText("選取 Scoped case 1"));
    fireEvent.change(screen.getByLabelText("同事"), { target: { value: assignee } });
    fireEvent.click(screen.getByText("預覽批量分配"));
    await waitFor(() =>
      expect(api.preview).toHaveBeenCalledWith({
        data: {
          resource: "annual_return_case",
          selection: { mode: "filtered_snapshot", snapshotId, excludedIds: [ids[0]] },
          assignment: { target: "owner", assigneeId: assignee },
        },
      }),
    );
    expect(api.execute).not.toHaveBeenCalled();
  });
  it("retains explicit cross-page IDs and clears selection/preview on a filter or actor change", async () => {
    const v = setup();
    await screen.findByRole("option", { name: /Mei Lam/ });
    fireEvent.click(screen.getByLabelText("選取 Scoped case 1"));
    v.rerender(
      v.element({ q: "scoped" }, [
        { id: "40000000-0000-0000-0000-000000000051", label: "Next page" },
      ]),
    );
    expect(screen.getByText("已選取1筆")).toBeTruthy();
    v.rerender(v.element({ q: "different" }));
    expect(screen.getByText("已選取0筆")).toBeTruthy();
    expect((screen.getByText("預覽批量分配") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("選取 Scoped case 2"));
    v.rerender(v.element({ q: "different" }, page, "manager-B"));
    expect(screen.getByText("已選取0筆")).toBeTruthy();
  });
  it("ignores a late preview from the prior filter", async () => {
    let resolve!: (x: unknown) => void;
    api.preview.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const v = setup();
    await screen.findByRole("option", { name: /Mei Lam/ });
    fireEvent.click(screen.getByLabelText("選取 Scoped case 1"));
    fireEvent.change(screen.getByLabelText("同事"), { target: { value: assignee } });
    fireEvent.click(screen.getByText("預覽批量分配"));
    await waitFor(() => expect(api.preview).toHaveBeenCalledOnce());
    v.rerender(v.element({ q: "new" }));
    await act(async () =>
      resolve({
        previewId: snapshotId,
        count: 1,
        eligibleCount: 1,
        reasons: { forbidden: 0, locked: 0, failed: 0, conflict: 0 },
      }),
    );
    expect(screen.queryByText("批准並建立分配工作")).toBeNull();
    expect(screen.getByText("已選取0筆")).toBeTruthy();
  });
  it("recovers a persisted job after refresh and never automatically resumes unknown outcomes", async () => {
    api.jobs.mockResolvedValue({
      jobs: [
        { jobId: snapshotId, state: "partial", total: 100, createdAt: "2026-10-01T00:00:00Z" },
      ],
      nextCursor: null,
    });
    api.get.mockResolvedValue({
      jobId: snapshotId,
      state: "partial",
      total: 100,
      counts: { succeeded: 90, unknown: 10 },
      items: [
        {
          ordinal: 0,
          resourceId: null,
          state: "forbidden",
          reason: "access_denied",
          retryable: false,
          attempts: 0,
        },
      ],
      nextCursor: null,
    });
    setup();
    await screen.findByRole("option", { name: /100筆.*部分完成/ });
    fireEvent.change(screen.getByLabelText("已保存工作"), { target: { value: snapshotId } });
    await screen.findByText(/結果未知10/);
    expect(api.resume).not.toHaveBeenCalled();
    expect(api.retry).not.toHaveBeenCalled();
    expect(screen.getByText("先核對未知結果")).toBeTruthy();
    expect(screen.queryByText(/40000000/)).toBeNull();
  });
});
