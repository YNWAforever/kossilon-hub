// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
function setup(
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }),
) {
  render(
    <QueryClientProvider client={client}>
      <ProductionWhatsAppAutomation actorScope="manager-A" canBulk />
    </QueryClientProvider>,
  );
  return client;
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

it("retains bulk selection through denied draft refresh while blocking new selections", async () => {
  api.drafts.mockResolvedValue([draft]);
  const client = setup();
  const selected = (await screen.findByLabelText("選取 Draft company")) as HTMLInputElement;
  fireEvent.click(selected);
  expect(selected.checked).toBe(true);
  api.drafts.mockRejectedValue(new Error("private list failure"));
  await act(async () => {
    await client.refetchQueries({ queryKey: ["annual-returns", "notifications", "automation"] });
  });
  const retry = await screen.findByRole("button", { name: "重新載入跟進" });
  expect(screen.getByLabelText("選取 Draft company")).toBe(selected);
  expect((selected.closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
  expect(selected.checked).toBe(true);
  api.drafts.mockResolvedValue([draft]);
  fireEvent.click(retry);
  await screen.findByRole("button", { name: "預覽並批准" });
  expect((selected.closest("fieldset") as HTMLFieldSetElement).disabled).toBe(false);
  expect(selected.checked).toBe(true);
  expect(api.snapshot).not.toHaveBeenCalled();
  expect(api.send).not.toHaveBeenCalled();
});

it("keeps bulk selection mounted but disabled until uncertain-send readback succeeds", async () => {
  api.drafts.mockResolvedValue([draft]);
  api.send.mockRejectedValue(new Error("lost queue result"));
  setup();
  const selected = (await screen.findByLabelText("選取 Draft company")) as HTMLInputElement;
  fireEvent.click(selected);
  fireEvent.click(screen.getByRole("button", { name: "預覽並批准" }));
  fireEvent.click(screen.getByRole("button", { name: "批准並加入隊列" }));
  const retry = await screen.findByRole("button", { name: "重新核對跟進結果" });
  expect(screen.getByLabelText("選取 Draft company")).toBe(selected);
  expect(selected.checked).toBe(true);
  expect((selected.closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
  api.drafts.mockResolvedValue([{ ...draft, status: "unknown" }]);
  fireEvent.click(retry);
  await screen.findByRole("button", { name: "與供應商核對" });
  expect(screen.queryByRole("button", { name: "預覽並批准" })).toBeNull();
  expect(api.send).toHaveBeenCalledTimes(1);
  expect(api.snapshot).not.toHaveBeenCalled();
});
