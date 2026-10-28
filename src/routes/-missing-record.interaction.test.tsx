// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import { getCorporateChangeRequestForActor } from "@/features/corporate-changes/read";
import { CorporateChangeRequestNotFoundError } from "@/features/corporate-changes/errors";
import { changeRouteFixture } from "@/test/case-route-fixtures";

const rpc = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn(), write: vi.fn() }));
vi.mock("@/features/corporate-changes/server-fns", () => ({
  getCorporateChangeRequest: rpc.get,
  listCorporateChangeRequestPage: rpc.list,
  completeCorporateChangeRequest: rpc.write,
  cancelCorporateChangeRequest: rpc.write,
  updateCorporateChangeChecklistItemStatus: rpc.write,
}));
vi.mock("@/features/clients/server-fns", () => ({
  listClientPage: async () => ({ clients: [], nextCursor: null }),
  listClientAssignmentOptions: async () => ({ owners: [], teams: [] }),
}));
vi.mock("@/components/corporate-changes/create-corporate-change-request-dialog", () => ({
  CreateCorporateChangeRequestDialog: () => null,
}));
import { Route as ListRoute } from "./corporate-changes";
import { Route as DetailRoute } from "./corporate-changes.$id";

const id = "d74e4679-0164-4164-8164-000000000001";
const otherId = "d74e4679-0164-4164-8164-000000000002";
const missingId = "d74e4679-0164-4164-8164-000000000099";
const listUrl = "/corporate-changes?q=QA&sort=company&cursor=QA-UC164-page3";
const detailUrl = `/corporate-changes/${id}?returnTo=${encodeURIComponent(listUrl)}`;
const actor: AuthenticatedActor = {
  authUserId: "QA-UC164-Staff-A",
  userId: "d74e4679-0164-4164-8164-000000000010",
  role: "Staff",
  teamId: "d74e4679-0164-4164-8164-000000000020",
  active: true,
};
const clients: QueryClient[] = [];
let currentActor: AuthenticatedActor;
const repository = { getRequest: vi.fn(), getCompanyTeamId: vi.fn() };

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
  });
  const list = ListRoute.update({
    getParentRoute: () => root,
    id: "/corporate-changes",
    path: "/corporate-changes",
  } as never);
  const detail = DetailRoute.update({
    getParentRoute: () => list,
    id: "/$id",
    path: "/$id",
  } as never);
  const router = createRouter({
    routeTree: root.addChildren([list.addChildren([detail])]),
    history: createMemoryHistory({ initialEntries: [url] }),
    context: { queryClient: client, actor: currentActor, dataMode: "production" },
    defaultPreload: false,
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  currentActor = { ...actor };
  rpc.write.mockRejectedValue(new Error("UC164 is read-only"));
  rpc.list.mockResolvedValue({ items: [], nextCursor: null });
  repository.getRequest.mockImplementation(async (requestId: string) => {
    if (requestId === missingId) throw new CorporateChangeRequestNotFoundError();
    return { ...changeRouteFixture(requestId), companyId: "d74e4679-0164-4164-8164-000000000030" };
  });
  repository.getCompanyTeamId.mockResolvedValue(actor.teamId);
  // Real domain read/error/authorization; only transport and repository IO are injected.
  rpc.get.mockImplementation(({ data }) =>
    getCorporateChangeRequestForActor(currentActor, data.requestId, { repository }),
  );
});
afterEach(() => {
  expect(rpc.write).not.toHaveBeenCalled();
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});

describe("UC164 corporate change missing/error recovery", () => {
  it.each(["invalid-id", "123", "00000000-0000-0000-0000-00000000000g"])(
    "keeps the filtered return path for malformed %s without any read",
    async (badId) => {
      await view(`/corporate-changes/${badId}?returnTo=${encodeURIComponent(listUrl)}`);
      await screen.findByRole("heading", { name: "找不到公司變更申請" });
      expect(rpc.get).not.toHaveBeenCalled();
      expect(repository.getRequest).not.toHaveBeenCalled();
      expect(screen.queryByRole("button", { name: "重試" })).toBeNull();
      expect(screen.getByRole("link", { name: "返回工作列表" }).getAttribute("href")).toBe(listUrl);
    },
  );

  it("typed repository absence yields missing, not outage, and a fresh read after reopening", async () => {
    const url = detailUrl.replace(id, missingId);
    await view(url);
    await screen.findByRole("heading", { name: "找不到公司變更申請" });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "重試" })).toBeNull();
    expect(rpc.get).toHaveBeenCalledTimes(1);
    expect(repository.getCompanyTeamId).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "返回工作列表" }).getAttribute("href")).toBe(listUrl);
    cleanup();
    clients.splice(0).forEach((client) => client.clear());
    repository.getRequest.mockResolvedValue({ ...changeRouteFixture(missingId), quotedFee: 9164 });
    await view(url);
    await screen.findByText("HKD 9,164");
    expect(rpc.get).toHaveBeenCalledTimes(2);
    expect(repository.getRequest).toHaveBeenLastCalledWith(missingId);
  });

  it("redacts transient repository details, finishes loading and explicitly retries only once", async () => {
    repository.getRequest.mockRejectedValueOnce(
      new Error("503 db.internal.invalid SQL select secret_company token=QA-not-a-secret"),
    );
    await view(detailUrl);
    await screen.findByRole("alert");
    expect(screen.queryByRole("heading", { name: "找不到公司變更申請" })).toBeNull();
    expect(screen.queryByText(/正在載入/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/db\.internal|secret_company|token=|503/);
    expect(rpc.get).toHaveBeenCalledTimes(1);
    let release!: (value: ReturnType<typeof changeRouteFixture>) => void;
    repository.getRequest.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    );
    const retry = screen.getByRole("button", { name: "重試" });
    fireEvent.click(retry);
    fireEvent.click(retry);
    await waitFor(() => expect(repository.getRequest).toHaveBeenCalledTimes(2));
    await act(async () => release({ ...changeRouteFixture(id), quotedFee: 9164 }));
    await screen.findByText("HKD 9,164");
    expect(repository.getRequest).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    { label: "other team", actor: {}, team: "d74e4679-0164-4164-8164-000000000021" },
    { label: "no team", actor: { teamId: null }, team: actor.teamId },
    { label: "Client", actor: { role: "Client" as const }, team: actor.teamId },
    { label: "inactive", actor: { active: false }, team: actor.teamId },
  ])("closes $label through real domain authorization and reveals no request", async (test) => {
    currentActor = { ...actor, ...test.actor };
    repository.getCompanyTeamId.mockResolvedValue(test.team);
    await view(detailUrl);
    await screen.findByRole("alert");
    expect(screen.queryByText(/HKD/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/Forbidden|another team|staff access|inactive/);
    expect(rpc.get).toHaveBeenCalledTimes(1);
    expect(repository.getCompanyTeamId).toHaveBeenCalledTimes(1);
  });

  it("Admin positive control reads another team without changing the URL", async () => {
    currentActor = { ...actor, role: "Admin", teamId: null };
    repository.getCompanyTeamId.mockResolvedValue("d74e4679-0164-4164-8164-000000000021");
    const router = await view(detailUrl);
    await screen.findByText("HKD 1,601");
    expect(router.state.location.pathname).toBe(`/corporate-changes/${id}`);
  });

  it("keeps unsafe returnTo local even for a malformed ID", async () => {
    await view("/corporate-changes/invalid?returnTo=https%3A%2F%2Fexternal.invalid%2Fprivate");
    await screen.findByRole("heading", { name: "找不到公司變更申請" });
    expect(screen.getByRole("link", { name: "返回工作列表" }).getAttribute("href")).toBe(
      "/annual-returns",
    );
    expect(rpc.get).not.toHaveBeenCalled();
  });

  it("Back restores the filtered list and leaving a pending retry ignores its late response", async () => {
    const router = await view(listUrl);
    await screen.findByRole("form", { name: "案件篩選" });
    repository.getRequest.mockRejectedValueOnce(new Error("503 temporary"));
    await act(async () => router.navigate({ href: detailUrl }));
    await screen.findByRole("alert");
    let release!: (value: ReturnType<typeof changeRouteFixture>) => void;
    repository.getRequest.mockImplementationOnce(
      () => new Promise((resolve) => (release = resolve)),
    );
    fireEvent.click(screen.getByRole("button", { name: "重試" }));
    await waitFor(() => expect(rpc.get).toHaveBeenCalledTimes(2));
    await act(async () => router.history.back());
    await screen.findByRole("form", { name: "案件篩選" });
    await act(async () => release(changeRouteFixture(id)));
    expect(router.state.location.href).toBe(listUrl);
    expect(screen.queryByText("HKD 1,601")).toBeNull();
    expect((screen.getByLabelText("搜尋既有案件") as HTMLInputElement).value).toBe("QA");
  });

  it("a late missing response cannot replace another request's successful read", async () => {
    let release!: (value: null) => void;
    rpc.get.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
    const router = await view(detailUrl);
    await waitFor(() => expect(rpc.get).toHaveBeenCalledTimes(1));
    await act(async () => router.navigate({ href: `/corporate-changes/${otherId}` }));
    await screen.findByText("HKD 1,602");
    await act(async () => release(null));
    expect(screen.queryByRole("heading", { name: "找不到公司變更申請" })).toBeNull();
    expect(screen.getByText("HKD 1,602")).toBeTruthy();
    expect(router.state.location.pathname).toBe(`/corporate-changes/${otherId}`);
  });
});
