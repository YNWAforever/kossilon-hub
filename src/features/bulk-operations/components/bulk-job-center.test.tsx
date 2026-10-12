// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
import { BulkJobCenter } from "./bulk-job-center";
const api = vi.hoisted(() => ({
  listBulkJobs: vi.fn(),
  getBulkJob: vi.fn(),
  resumeBulkJob: vi.fn(),
  cancelBulkJob: vi.fn(),
  retryFailedBulkItems: vi.fn(),
  reconcileUnknownBulkItems: vi.fn(),
  exportBulkResults: vi.fn(),
}));
vi.mock("../server-fns", () => api);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("shows persisted metadata/unknown heartbeat and filters approvals without retrying unknown outcomes", async () => {
  api.listBulkJobs.mockResolvedValue({ jobs: [], nextCursor: null });
  api.getBulkJob.mockResolvedValue({
    jobId: "job",
    resource: "document",
    state: "partial",
    total: 50,
    counts: { succeeded: 47, conflict: 1, failed: 1, unknown: 1 },
    retryableFailedCount: 1,
    items: [
      {
        ordinal: 49,
        resourceId: "11111111-1111-4111-8111-111111111111",
        resourceLabel: "同名文件",
        state: "unknown",
        reason: "database_outcome_unknown",
        attempts: 1,
      },
    ],
    nextCursor: null,
    operationLabel: "文件登記清單",
    scopeSummary: "固定50筆",
    actorName: "陳同事",
    createdAt: "2026-10-12",
    updatedAt: "2026-10-12",
    lastHeartbeat: null,
    lastWorkerReceiptAt: "2026-10-12T00:00:00Z",
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <BulkJobCenter actorScope="scoped" jobId="job" onJobChange={() => {}} />
    </QueryClientProvider>,
  );
  await screen.findByText(/成功47/);
  expect(screen.getByText(/worker 心跳：待核對/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "同名文件" }).getAttribute("href")).toContain(
    "documentId=",
  );
  expect(api.resumeBulkJob).not.toHaveBeenCalled();
  expect(api.retryFailedBulkItems).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("操作篩選"), {
    target: { value: "document_list_export" },
  });
  await waitFor(() =>
    expect(api.listBulkJobs).toHaveBeenLastCalledWith({
      data: expect.objectContaining({ operation: "document_list_export" }),
    }),
  );
  fireEvent.click(screen.getByText("先核對未知結果"));
  await waitFor(() => expect(api.reconcileUnknownBulkItems).toHaveBeenCalledOnce());
  expect(api.retryFailedBulkItems).not.toHaveBeenCalled();
});
