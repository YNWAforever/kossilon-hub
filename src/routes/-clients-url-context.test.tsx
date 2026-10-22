// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRouter,
  createMemoryHistory,
  defaultParseSearch,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
const f = vi.hoisted(() => ({ page: vi.fn(), options: vi.fn(), detail: vi.fn() }));
vi.mock("@/features/bulk-operations/server-fns", () => ({
  listBulkAssignees: async () => [],
  listBulkJobs: async () => ({ jobs: [], nextCursor: null }),
  createBulkSelectionSnapshot: vi.fn(),
  getBulkSnapshotMembership: vi.fn(),
  previewBulkAssignment: vi.fn(),
  previewBulkMaintenance: vi.fn(),
  executeBulkAssignment: vi.fn(),
  getBulkJob: vi.fn(),
  resumeBulkJob: vi.fn(),
  cancelBulkJob: vi.fn(),
  retryFailedBulkItems: vi.fn(),
  reconcileUnknownBulkItems: vi.fn(),
  exportBulkResults: vi.fn(),
}));
vi.mock("@/features/clients/server-fns", () => ({
  listClientPage: f.page,
  listClientAssignmentOptions: f.options,
}));
vi.mock("@/components/clients/client-form-dialog", () => ({ ClientFormDialog: () => null }));
vi.mock("@/features/clients/components/production-client-detail", () => ({
  ProductionClientDetail: (props: unknown) => {
    f.detail(props);
    return <p>Client detail boundary</p>;
  },
}));
import { Route as ClientsRoute } from "./clients";
import { Route as DetailRoute } from "./clients.$id";
const team = "33333333-3333-4333-8333-333333333333";
const clientId = "11111111-1111-4111-8111-111111111111";
const cursor = JSON.stringify(["Acme", clientId]);
const nextCursor = JSON.stringify(["Beta", clientId]);
const actor: AuthenticatedActor = {
  authUserId: "admin-auth",
  userId: "22222222-2222-4222-8222-222222222222",
  role: "Admin",
  teamId: team,
  active: true,
};
const row = {
  id: clientId,
  companyName: "Acme",
  crNumber: "CR1234567",
  brNumber: "BR7654321",
  dataOrigin: "client",
  status: "active",
  ownerId: actor.userId,
  ownerName: "Ada",
  ownerInitials: "A",
  teamId: team,
  teamName: "Alpha",
  arDueDate: null,
  paymentStatus: null,
  invoiceAmount: 0,
};
const clients: QueryClient[] = [];
async function view(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  const root = createRootRouteWithContext<{
    queryClient: QueryClient;
    actor: AuthenticatedActor;
    dataMode: "production";
  }>()({
    component: () => (
      <QueryClientProvider client={client}>
        <Outlet />
      </QueryClientProvider>
    ),
    errorComponent: () => <p role="alert">Invalid client URL</p>,
  });
  const list = ClientsRoute.update({
    getParentRoute: () => root,
    id: "/clients",
    path: "/clients",
  } as never);
  const detail = DetailRoute.update({
    getParentRoute: () => list,
    id: "/$id",
    path: "/$id",
  } as never);
  const router = createRouter({
    routeTree: root.addChildren([list.addChildren([detail])]),
    history: createMemoryHistory({ initialEntries: [url] }),
    context: { queryClient: client, actor, dataMode: "production" },
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return router;
}
function filteredUrl() {
  return `/clients?${new URLSearchParams({ q: "Acme", status: "inactive", team, includeFixtures: "true", cursor: JSON.stringify(cursor) })}`;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  f.page.mockResolvedValue({ clients: [row], total: 3, nextCursor });
  f.options.mockResolvedValue({ owners: [], teams: [{ id: team, name: "Alpha" }] });
});
afterEach(() => {
  cleanup();
  clients.forEach((c) => c.clear());
  clients.length = 0;
  vi.restoreAllMocks();
});
it("restores q/status/team/includeFixtures/cursor from a copied page3 URL", async () => {
  await view(filteredUrl());
  await screen.findByRole("link", { name: "開啟" });
  expect((screen.getByLabelText("搜尋公司名稱、CR 或 BR 號碼") as HTMLInputElement).value).toBe(
    "Acme",
  );
  expect((screen.getByLabelText("按團隊篩選") as HTMLSelectElement).value).toBe(team);
  expect((screen.getByLabelText("包含測試資料（Admin 診斷）") as HTMLInputElement).checked).toBe(
    true,
  );
  expect(f.page).toHaveBeenCalledWith({
    data: {
      q: "Acme",
      status: "inactive",
      teamId: team,
      includeFixtures: true,
      cursor,
      limit: 100,
    },
  });
});
it.each(["q", "status", "team", "includeFixtures"] as const)(
  "persists %s changes and resets cursor",
  async (field) => {
    const router = await view(filteredUrl());
    await screen.findByRole("link", { name: "開啟" });
    if (field === "q")
      fireEvent.change(screen.getByLabelText("搜尋公司名稱、CR 或 BR 號碼"), {
        target: { value: "Beta" },
      });
    if (field === "status") fireEvent.click(screen.getByRole("button", { name: "有效" }));
    if (field === "team")
      fireEvent.change(screen.getByLabelText("按團隊篩選"), { target: { value: "all" } });
    if (field === "includeFixtures")
      fireEvent.click(screen.getByLabelText("包含測試資料（Admin 診斷）"));
    await waitFor(() => expect(router.state.location.search.cursor).toBeUndefined());
    const wanted =
      field === "q" ? "Beta" : field === "status" ? "active" : field === "team" ? "all" : false;
    expect(router.state.location.search[field]).toBe(wanted);
    await waitFor(() =>
      expect(f.page).toHaveBeenLastCalledWith({
        data: expect.objectContaining({ cursor: undefined }),
      }),
    );
  },
);
it("persists next page and carries a safe exact returnTo to detail", async () => {
  const router = await view(filteredUrl());
  await screen.findByRole("link", { name: "開啟" });
  fireEvent.click(screen.getByRole("button", { name: "下一頁客戶" }));
  await waitFor(() => expect(router.state.location.search.cursor).toBe(nextCursor));
  const open = screen.getByRole("link", { name: "開啟" });
  const url = new URL(open.getAttribute("href")!, "https://local.example");
  expect(url.pathname).toBe(`/clients/${clientId}`);
  const returnTo = url.searchParams.get("returnTo")!;
  const back = new URL(returnTo, "https://local.example");
  const backSearch = defaultParseSearch(back.search) as Record<string, unknown>;
  expect(back.pathname).toBe("/clients");
  expect(backSearch.q).toBe("Acme");
  expect(backSearch.cursor).toBe(nextCursor);
  await act(async () => {
    await router.navigate({ href: open.getAttribute("href")! });
  });
  await screen.findByText("Client detail boundary");
  expect(f.detail).toHaveBeenLastCalledWith(expect.objectContaining({ clientId, returnTo }));
  await act(async () => {
    await router.navigate({ href: returnTo });
  });
  await screen.findByRole("link", { name: "開啟" });
  expect((screen.getByLabelText("搜尋公司名稱、CR 或 BR 號碼") as HTMLInputElement).value).toBe(
    "Acme",
  );
});
it.each([
  "q=a&q=b",
  "status=active&status=inactive",
  "team=all&team=other",
  "includeFixtures=true&includeFixtures=false",
  "cursor=a&cursor=b",
  "status=unknown",
  "team=wrong",
  "includeFixtures=maybe",
  `q=${"a".repeat(201)}`,
])("fails closed without a directory read for invalid URL %s", async (search) => {
  await view(`/clients?${search}`);
  await screen.findByRole("alert");
  expect(f.page).not.toHaveBeenCalled();
});

it("clears the real bulk selection when the actor scope changes", async () => {
  const router = await view("/clients");
  await screen.findByRole("link", { name: "開啟" });
  const selected = screen.getByLabelText("選取 Acme") as HTMLInputElement;
  fireEvent.click(selected);
  expect(selected.checked).toBe(true);
  await act(async () => {
    router.update({
      context: {
        ...router.options.context,
        actor: {
          ...actor,
          authUserId: "other-admin",
          userId: "44444444-4444-4444-8444-444444444444",
        },
      },
    });
    await router.invalidate();
  });
  await waitFor(() =>
    expect((screen.getByLabelText("選取 Acme") as HTMLInputElement).checked).toBe(false),
  );
});
it("retains the prior successful page after next-page failure and explicitly resets pagination", async () => {
  const router = await view(filteredUrl());
  await screen.findByRole("link", { name: "開啟" });
  f.page.mockRejectedValueOnce(new Error("Synthetic page failure"));
  fireEvent.click(screen.getByRole("button", { name: "下一頁客戶" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("link", { name: "開啟" })).toBeTruthy();
  expect(router.state.location.search.cursor).toBe(nextCursor);
  fireEvent.click(screen.getByRole("button", { name: "回第一頁客戶" }));
  await waitFor(() => expect(router.state.location.search.cursor).toBeUndefined());
  expect((screen.getByLabelText("搜尋公司名稱、CR 或 BR 號碼") as HTMLInputElement).value).toBe(
    "Acme",
  );
});
it.each([
  "https://evil.example",
  "//evil.example",
  "/clients-other",
  ["/clients", "https://evil.example"],
])("passes only a safe fallback for hostile detail returnTo: %s", async (returnTo) => {
  const url = `/clients/${clientId}?${new URLSearchParams({ returnTo: typeof returnTo === "string" ? returnTo : JSON.stringify(returnTo) })}`;
  await view(url);
  await screen.findByText("Client detail boundary");
  expect(f.detail).toHaveBeenLastCalledWith(
    expect.objectContaining({ clientId, returnTo: "/clients" }),
  );
  expect(f.page).not.toHaveBeenCalled();
});
