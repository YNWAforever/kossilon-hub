// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  defaultParseSearch,
  type SearchSchemaInput,
} from "@tanstack/react-router";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductionAnnualReturnCaseDetail } from "./production-case-detail";
import { ProductionClientDetail } from "@/features/clients/components/production-client-detail";
import { clientDetailSearch } from "@/features/clients/register-view-state";
import { Route as AnnualReturnRoute } from "@/routes/annual-returns.$id";

const rpc = vi.hoisted(() => ({ case: vi.fn(), client: vi.fn() }));
vi.mock("../server-fns", () => ({
  getAnnualReturnCase: rpc.case,
  listAnnualReturnCaseNotes: async () => [],
  listAnnualReturnCaseHistory: async () => [],
  assignAnnualReturnCaseOwner: vi.fn(),
  updateAnnualReturnStatus: vi.fn(),
  updateAnnualReturnChecklistItem: vi.fn(),
  updateAnnualReturnPayment: vi.fn(),
  addAnnualReturnCaseNote: vi.fn(),
  queueAnnualReturnWhatsAppReminderMessage: vi.fn(),
  updateAnnualReturnFilingProof: vi.fn(),
}));
vi.mock("@/features/clients/server-fns", () => ({
  getClient: rpc.client,
  listClientAssignmentOptions: async () => ({ owners: [], teams: [] }),
  removeClientContact: vi.fn(),
  ceaseClientOfficer: vi.fn(),
  ceaseClientShareholding: vi.fn(),
  ceaseClientController: vi.fn(),
}));
vi.mock("@/features/clients/company-work-server-fns", () => ({
  listCompanyWorkPage: async () => ({ total: 0, unfinished: 0, items: [], nextCursor: null }),
}));
vi.mock("@/features/documents/server-fns", () => ({
  listDocumentPage: async () => ({ documents: [], nextCursor: null }),
  downloadDocument: vi.fn(),
}));
vi.mock("@/features/service-subscriptions/server-fns", () => ({
  listServiceSubscriptions: async () => [],
  addServiceSubscription: vi.fn(),
  cancelServiceSubscription: vi.fn(),
  renewServiceSubscription: vi.fn(),
}));

const caseId = "20000000-0000-0000-0000-000000000001";
const clientId = "10000000-0000-0000-0000-000000000001";
const registerPath =
  "/clients?q=Acme&status=inactive&team=10000000-0000-0000-0000-000000000002&includeFixtures=false&cursor=%22%5B%5C%22Acme%5C%22%2C%5C%2210000000-0000-0000-0000-000000000001%5C%22%5D%22";
const clientPath = `/clients/${clientId}?returnTo=${encodeURIComponent(registerPath)}`;
const failures = [
  { state: "request error", heading: "無法載入周年申報案件" },
  { state: "not found", heading: "找不到案件" },
] as const;
const queryClients: QueryClient[] = [];

async function openCase(returnTo: string | undefined = clientPath, id = caseId) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClients.push(queryClient);
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    ),
  });
  const annualReturn = createRoute({
    getParentRoute: () => root,
    path: "/annual-returns/$id",
    validateSearch: (search: Record<string, unknown>) => {
      const validate = AnnualReturnRoute.options.validateSearch;
      if (typeof validate !== "function") throw new Error("Missing annual-return search validator");
      return validate(search as SearchSchemaInput & Record<string, unknown>);
    },
    component: () => (
      <ProductionAnnualReturnCaseDetail
        caseId={annualReturn.useParams().id}
        returnTo={annualReturn.useSearch().returnTo}
      />
    ),
  });
  const client = createRoute({
    getParentRoute: () => root,
    path: "/clients/$id",
    validateSearch: clientDetailSearch,
    component: () => (
      <ProductionClientDetail
        clientId={client.useParams().id}
        returnTo={client.useSearch().returnTo}
      />
    ),
  });
  const annualReturns = createRoute({
    getParentRoute: () => root,
    path: "/annual-returns",
    component: () => <p>Annual-return list</p>,
  });
  const search = returnTo === undefined ? "" : `?returnTo=${encodeURIComponent(returnTo)}`;
  const router = createRouter({
    routeTree: root.addChildren([annualReturn, client, annualReturns]),
    history: createMemoryHistory({ initialEntries: [`/annual-returns/${id}${search}`] }),
  });
  await router.load();
  await act(async () => {
    render(<RouterProvider router={router} />);
  });
  return router;
}

beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  rpc.case.mockReset();
  rpc.client.mockReset().mockResolvedValue({
    id: clientId,
    companyName: "Acme Company Limited",
    crNumber: "1234567",
    brNumber: "12345678",
    status: "active",
    ownerName: "Synthetic owner",
    teamName: "Synthetic team",
    incorporationDate: "2020-01-01",
    annualReturnBasisDate: "2020-01-01",
    registeredOffice: "Synthetic office",
    companySecretary: "Synthetic secretary",
    paymentStatus: null,
    officers: [],
    shareholdings: [],
    significantControllers: [],
    inspectionRequests: [],
    contacts: [],
    annualReturnHistory: [],
    documents: [],
    timeline: [],
  });
});
afterEach(() => {
  cleanup();
  queryClients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});

describe("Review3: annual-return failure recovery retains client context", () => {
  it.each(failures)(
    "returns from $state to the same client and filtered register",
    async (failure) => {
      if (failure.state === "request error")
        rpc.case.mockRejectedValue(new Error("Synthetic denial"));
      else rpc.case.mockResolvedValue(null);
      const router = await openCase();
      expect(await screen.findByRole("heading", { name: failure.heading })).toBeTruthy();
      const back = screen.getByRole("link", { name: /返回/ }).getAttribute("href");
      expect(back).toBe(clientPath);
      // Follow the actual rendered anchor URI; native document navigation is not available in jsdom.
      await act(async () => {
        await router.navigate({ href: back! });
      });
      const register = await screen.findByRole("link", { name: "返回客戶清單" });
      expect(router.state.location.pathname).toBe(`/clients/${clientId}`);
      expect(register.getAttribute("href")).toBe(registerPath);
      expect(defaultParseSearch(registerPath.slice(registerPath.indexOf("?")))).toMatchObject({
        q: "Acme",
        status: "inactive",
        team: "10000000-0000-0000-0000-000000000002",
        cursor: '["Acme","10000000-0000-0000-0000-000000000001"]',
      });
      expect(rpc.case).toHaveBeenCalledWith({ data: { id: caseId } });
      expect(rpc.client).toHaveBeenCalledWith({ data: { id: clientId } });
    },
  );

  it("retains safe context for malformed case links without reading a case", async () => {
    await openCase(clientPath, "not-a-uuid");
    expect(await screen.findByRole("heading", { name: "找不到案件" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /返回/ }).getAttribute("href")).toBe(clientPath);
    expect(rpc.case).not.toHaveBeenCalled();
  });

  it.each(failures)(
    "keeps the annual-return fallback for an unsafe origin on $state",
    async (failure) => {
      if (failure.state === "request error")
        rpc.case.mockRejectedValue(new Error("Synthetic denial"));
      else rpc.case.mockResolvedValue(null);
      await openCase("https://foreign.example/clients");
      expect(await screen.findByRole("heading", { name: failure.heading })).toBeTruthy();
      expect(screen.getByRole("link", { name: /返回/ }).getAttribute("href")).toBe(
        "/annual-returns",
      );
    },
  );
});
