// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ drafts: vi.fn(), send: vi.fn(), snapshot: vi.fn() }));
vi.mock("../follow-up-server-fns", () => ({
  listProductionFollowUpDrafts: api.drafts,
  sendProductionFollowUp: api.send,
}));
vi.mock("@/features/whatsapp/server-fns", () => ({
  getWhatsAppIntegrationStatus: async () => ({ deliveryMode: "simulated" }),
}));
vi.mock("@/features/bulk-operations/server-fns", () => ({
  createBulkSelectionSnapshot: api.snapshot,
  listBulkJobs: async () => ({ jobs: [], nextCursor: null }),
  getBulkSnapshotMembership: async ({ data }: { data: { ids: string[] } }) => ({ ids: data.ids }),
  previewBulkAssignment: vi.fn(),
  previewBulkMaintenance: vi.fn(),
  executeBulkAssignment: vi.fn(),
  getBulkJob: vi.fn(),
  resumeBulkJob: vi.fn(),
  cancelBulkJob: vi.fn(),
  retryFailedBulkItems: vi.fn(),
  reconcileUnknownBulkItems: vi.fn(),
  exportBulkResults: vi.fn(),
  listBulkAssignees: vi.fn(),
}));
import { ProductionWhatsAppAutomation } from "./production-whatsapp-automation";
const first = "40000000-0000-0000-0000-000000000001";
const second = "40000000-0000-0000-0000-000000000002";
const draft = {
  id: first,
  entityId: first,
  caseId: first,
  source: "annual-return",
  version: "v1",
  companyId: first,
  companyName: "Draft company",
  ownerName: "Owner",
  recipientName: "Client",
  phone: "+85290000000",
  messagePreview: "Synthetic draft",
  reasonLabel: "Missing evidence",
  status: "draft",
};
function setup() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
    >
      <ProductionWhatsAppAutomation actorScope="manager-A" canBulk />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  api.snapshot.mockResolvedValue({ snapshotId: first, count: 1 });
});
afterEach(cleanup);
it("F13/F35: snapshots only distinct displayed draft cases, excluding delivered and unknown rows", async () => {
  api.drafts.mockResolvedValue([
    draft,
    { ...draft, id: second, entityId: second, source: "document-review" },
    { ...draft, id: "delivered", caseId: second, status: "delivered" },
    { ...draft, id: "unknown", caseId: "40000000-0000-0000-0000-000000000003", status: "unknown" },
  ]);
  setup();
  await screen.findByRole("button", { name: "已送達" });
  fireEvent.click(screen.getByText("選取全部篩選結果"));
  await waitFor(() => expect(api.snapshot).toHaveBeenCalledOnce());
  expect(api.snapshot).toHaveBeenCalledWith({
    data: { resource: "annual_return_case", filters: { draftCaseIds: [first] } },
  });
  expect(screen.queryByLabelText("選取 Draft company") === null).toBe(false);
  expect(api.send).not.toHaveBeenCalled();
});
it("does not expose a global snapshot while drafts are loading or unavailable", async () => {
  api.drafts.mockRejectedValue(new Error("drafts unavailable"));
  setup();
  expect(screen.queryByText("選取全部篩選結果")).toBeNull();
  await screen.findByRole("alert");
  expect(screen.queryByText("選取全部篩選結果")).toBeNull();
  expect(screen.queryByText("沒有待處理的跟進。")).toBeNull();
  expect(api.snapshot).not.toHaveBeenCalled();
});
it("an empty draft set sends an empty restriction rather than unrestricted filters", async () => {
  api.drafts.mockResolvedValue([]);
  setup();
  await screen.findByText("沒有待處理的跟進。");
  fireEvent.click(screen.getByText("選取全部篩選結果"));
  await waitFor(() =>
    expect(api.snapshot).toHaveBeenCalledWith({
      data: { resource: "annual_return_case", filters: { draftCaseIds: [] } },
    }),
  );
});
