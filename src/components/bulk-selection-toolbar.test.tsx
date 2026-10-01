// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({
  snapshot: vi.fn(),
  membership: vi.fn(),
  preview: vi.fn(),
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
afterEach(cleanup);
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const element = (filters = { q: "scoped" }, p = page, actorScope = "manager-A") => (
    <QueryClientProvider client={client}>
      <BulkSelectionToolbar
        actorScope={actorScope}
        resource="annual_return_case"
        filters={filters}
        page={p}
        total={1240}
      />
    </QueryClientProvider>
  );
  const rendered = render(element());
  return { ...rendered, element };
}
describe("explicit scope and durable bulk toolbar", () => {
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
    await screen.findByRole("option", { name: /100筆.*partial/ });
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
    await screen.findByRole("option", { name: /100筆.*partial/ });
    fireEvent.change(screen.getByLabelText("Saved bulk job"), { target: { value: snapshotId } });
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
      expect((screen.getByLabelText("Select Scoped case 1") as HTMLInputElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(screen.getByLabelText("Select Scoped case 1"));
    fireEvent.change(screen.getByLabelText("Bulk assignee"), { target: { value: assignee } });
    fireEvent.click(screen.getByText("預覽批量分派"));
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
    fireEvent.click(screen.getByLabelText("Select Scoped case 1"));
    v.rerender(
      v.element({ q: "scoped" }, [
        { id: "40000000-0000-0000-0000-000000000051", label: "Next page" },
      ]),
    );
    expect(screen.getByText("已選取1筆")).toBeTruthy();
    v.rerender(v.element({ q: "different" }));
    expect(screen.getByText("已選取0筆")).toBeTruthy();
    expect((screen.getByText("預覽批量分派") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Select Scoped case 2"));
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
    fireEvent.click(screen.getByLabelText("Select Scoped case 1"));
    fireEvent.change(screen.getByLabelText("Bulk assignee"), { target: { value: assignee } });
    fireEvent.click(screen.getByText("預覽批量分派"));
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
    expect(screen.queryByText("批准並建立分派工作")).toBeNull();
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
    await screen.findByRole("option", { name: /100筆.*partial/ });
    fireEvent.change(screen.getByLabelText("Saved bulk job"), { target: { value: snapshotId } });
    await screen.findByText(/結果未知10/);
    expect(api.resume).not.toHaveBeenCalled();
    expect(api.retry).not.toHaveBeenCalled();
    expect(screen.getByText("先核對未知結果")).toBeTruthy();
    expect(screen.queryByText(/40000000/)).toBeNull();
  });
});
