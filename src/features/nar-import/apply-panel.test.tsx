// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
const mocks = vi.hoisted(() => ({
  options: vi.fn(),
  preview: vi.fn(),
  execute: vi.fn(),
  jobs: vi.fn(),
  get: vi.fn(),
  resume: vi.fn(),
  cancel: vi.fn(),
  compensate: vi.fn(),
}));
vi.mock("./server-fns", () => ({
  getNarApplyOptions: mocks.options,
  previewNarApply: mocks.preview,
  executeNarApply: mocks.execute,
  listNarApplyJobs: mocks.jobs,
  getNarApplyJob: mocks.get,
  resumeNarApplyJob: mocks.resume,
  cancelNarApplyJob: mocks.cancel,
  previewNarCompensation: mocks.compensate,
}));
import { NarApplyPanel } from "./apply-panel";
import type { NarImportRow } from "./repository";
const rowId = "30000000-0000-0000-0000-000000000001",
  batchId = "30000000-0000-0000-0000-000000000002";
const row: NarImportRow = {
  id: rowId,
  rowNumber: 3,
  companyName: "Synthetic company",
  externalClientId: "X1",
  parsed: { paymentReceived: { iso: "2025-03-01" } },
  raw: {},
  issues: [],
  appliedAt: null,
  batchId,
  disposition: "new",
  matchedCompanyId: null,
  matchedCaseId: null,
  appliedCaseId: null,
  applyError: null,
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function setup(saved: unknown[] = []) {
  mocks.options.mockResolvedValue({ templates: [], owners: [] });
  mocks.jobs.mockResolvedValue({ items: saved, nextCursor: null });
  mocks.preview.mockResolvedValue({
    previewId: batchId,
    revision: "stored",
    selected: 1,
    eligibleCount: 1,
    rows: [
      {
        rowId,
        original: null,
        candidate: { filingDueDate: "2025-02-15", invoiceNumber: "INV" },
        input: {},
        requiredInputs: [],
        conflicts: [],
        raw: {},
        parserVersion: "synthetic",
      },
    ],
  });
  mocks.execute.mockResolvedValue({ jobId: batchId });
  mocks.get.mockResolvedValue({
    jobId: batchId,
    state: "partial",
    selected: 1,
    unselected: 34,
    counts: { applied: 0, pending: 1, conflict: 0, failed: 0, cancelled: 0 },
    rows: [],
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <NarApplyPanel batchId={batchId} rows={[row]} actorKey="synthetic-admin" />
    </QueryClientProvider>,
  );
}
describe("reviewed selected NAR apply UI", () => {
  it("does not apply on preview; approval requires explicit current preview confirmation", async () => {
    setup();
    fireEvent.click(screen.getByLabelText("選取第3行"));
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "預覽所選行" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "預覽所選行" }));
    await screen.findByText("2025-02-15");
    expect(mocks.execute).not.toHaveBeenCalled();
    const approve = screen.getByRole("button", { name: "批准建立套用工作" });
    expect((approve as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("確認此版本及逐行差異"));
    fireEvent.click(approve);
    await waitFor(() => expect(mocks.execute).toHaveBeenCalledTimes(1));
    expect(mocks.resume).not.toHaveBeenCalled();
  });
  it("source payment date does not fill a fee or declare paid; selection changes invalidate preview", async () => {
    setup();
    fireEvent.click(screen.getByLabelText("選取第3行"));
    expect((screen.getByLabelText("第3行實際費用") as HTMLInputElement).value).toBe("");
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "預覽所選行" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    fireEvent.click(screen.getByRole("button", { name: "預覽所選行" }));
    await screen.findByText("2025-02-15");
    fireEvent.click(screen.getByLabelText("選取第3行"));
    expect(screen.queryByRole("button", { name: "批准建立套用工作" })).toBeNull();
  });
  it("saved pending jobs can be reopened and explicitly resumed without automatic retry", async () => {
    setup([{ id: batchId, state: "running", createdAt: "2026-10-01" }]);
    fireEvent.click(await screen.findByRole("button", { name: "開啟套用工作" }));
    await screen.findByText("未選取34行");
    expect(mocks.resume).not.toHaveBeenCalled();
    mocks.resume.mockResolvedValue({ processed: 1 });
    fireEvent.click(screen.getByRole("button", { name: "繼續處理最多100行" }));
    await waitFor(() => expect(mocks.resume).toHaveBeenCalledTimes(1));
  });
  it("compensation renders row identity, prior and current facts and retained snapshot", async () => {
    setup([{ id: batchId, state: "completed", createdAt: "2026-10-01" }]);
    mocks.compensate.mockResolvedValue([
      {
        rowId,
        caseId: batchId,
        companyName: "Synthetic company",
        rowNumber: 3,
        proposedBefore: { case: { filing_due_date: "2025-02-15" }, payments: [{ amount: 1200 }] },
        current: { case: { filing_due_date: "2025-02-16" } },
        currentMatches: false,
        action: "review_deadline_compensation",
        writes: 0,
      },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: "開啟套用工作" }));
    await screen.findByText("未選取34行");
    fireEvent.click(screen.getByRole("button", { name: "預覽補償" }));
    await screen.findByText(/原申報限期：2025-02-15/);
    expect(screen.getByText(/現申報限期：2025-02-16/)).toBeTruthy();
    expect(screen.getAllByText(/Synthetic company · 第3行/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("完整 before／current 資料")).toBeTruthy();
    expect(screen.getByText(/"amount": 1200/)).toBeTruthy();
    expect(mocks.resume).not.toHaveBeenCalled();
  });
  it("compensation query failure is visible and does not retry or reverse work", async () => {
    setup([{ id: batchId, state: "completed", createdAt: "2026-10-01" }]);
    mocks.compensate.mockRejectedValue(new Error("Synthetic private infrastructure detail"));
    fireEvent.click(await screen.findByRole("button", { name: "開啟套用工作" }));
    await screen.findByText("未選取34行");
    fireEvent.click(screen.getByRole("button", { name: "預覽補償" }));
    await screen.findByText("未能載入補償資料，請重新載入。");
    expect(screen.queryByText(/Synthetic private infrastructure detail/)).toBeNull();
    expect(mocks.compensate).toHaveBeenCalledTimes(1);
    expect(mocks.resume).not.toHaveBeenCalled();
  });
});
