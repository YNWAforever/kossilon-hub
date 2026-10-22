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
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductionClientDetail } from "./production-client-detail";
import { clientDetailSearch } from "../register-view-state";
import { caseReturnPath } from "@/features/annual-return/daily-view-state";
import { Route as AnnualReturnRoute } from "@/routes/annual-returns.$id";
import { Route as IncorporationRoute } from "@/routes/incorporation.$id";
import { Route as CorporateChangeRoute } from "@/routes/corporate-changes.$id";

const rpc = vi.hoisted(() => ({ client: vi.fn(), work: vi.fn(), documents: vi.fn() }));
vi.mock("../server-fns", () => ({
  getClient: rpc.client,
  listClientAssignmentOptions: async () => ({ owners: [], teams: [] }),
  removeClientContact: vi.fn(),
  ceaseClientOfficer: vi.fn(),
  ceaseClientShareholding: vi.fn(),
  ceaseClientController: vi.fn(),
}));
vi.mock("../company-work-server-fns", () => ({ listCompanyWorkPage: rpc.work }));
vi.mock("@/features/documents/server-fns", () => ({
  listDocumentPage: rpc.documents,
  downloadDocument: vi.fn(),
}));
vi.mock("@/features/service-subscriptions/server-fns", () => ({
  listServiceSubscriptions: async () => [],
  addServiceSubscription: vi.fn(),
  cancelServiceSubscription: vi.fn(),
  renewServiceSubscription: vi.fn(),
}));

const clientId = "10000000-0000-0000-0000-000000000001";
const cases = [
  {
    kind: "annual_return",
    label: "周年申報",
    path: "/annual-returns/$id",
    id: "20000000-0000-0000-0000-000000000001",
    route: AnnualReturnRoute,
  },
  {
    kind: "incorporation",
    label: "公司註冊",
    path: "/incorporation/$id",
    id: "30000000-0000-0000-0000-000000000001",
    route: IncorporationRoute,
  },
  {
    kind: "corporate_change",
    label: "公司變更",
    path: "/corporate-changes/$id",
    id: "40000000-0000-0000-0000-000000000001",
    route: CorporateChangeRoute,
  },
] as const;
const registerPath =
  "/clients?q=Acme&status=inactive&team=10000000-0000-0000-0000-000000000002&includeFixtures=false&cursor=%22%5B%5C%22Acme%5C%22%2C%5C%2210000000-0000-0000-0000-000000000001%5C%22%5D%22";
const clientPath = `/clients/${clientId}?returnTo=${encodeURIComponent(registerPath)}`;

async function openClient(path = clientPath) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
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
  const businessRoutes = cases.map((business) =>
    createRoute({
      getParentRoute: () => root,
      path: business.path,
      // Exercise the existing product route validator, not a test reimplementation.
      validateSearch: (search: Record<string, unknown>) => {
        const validate = business.route.options.validateSearch;
        if (typeof validate !== "function") throw new Error("Missing case search validator");
        return validate(search as SearchSchemaInput & Record<string, unknown>);
      },
      component: () => <p>Case route reached</p>,
    }),
  );
  const router = createRouter({
    routeTree: root.addChildren([client, ...businessRoutes]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await router.load();
  await act(async () => {
    render(<RouterProvider router={router} />);
  });
  return router;
}

const clientRecord = {
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
};
beforeEach(() => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  rpc.client.mockReset().mockResolvedValue(clientRecord);
  rpc.documents.mockReset().mockResolvedValue({ documents: [], nextCursor: null });
  rpc.work.mockReset().mockResolvedValue({
    total: 3,
    unfinished: 3,
    nextCursor: null,
    items: cases.map((business) => ({
      id: business.id,
      kind: business.kind,
      title: business.kind,
      status: "Documents pending",
      active: true,
      dueDate: null,
      paymentStatus: null,
      amount: null,
    })),
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Review2 finding6: client -> case -> exact client return", () => {
  it.each(cases)(
    "retains the exact client and register context through $kind",
    async (business) => {
      const router = await openClient();
      const link = await screen.findByRole("link", {
        name: `開啟${business.label}案件 ${business.kind}`,
      });
      const target = new URL(link.getAttribute("href")!, "https://example.test");
      expect(target.pathname).toBe(business.path.replace("$id", business.id));
      expect(defaultParseSearch(target.search)).toMatchObject({ returnTo: clientPath });
      fireEvent.click(link);
      await waitFor(() =>
        expect(router.state.matches.at(-1)?.search).toMatchObject({ returnTo: clientPath }),
      );
      const caseSearch = router.state.matches.at(-1)?.search;
      const back = caseReturnPath(
        caseSearch && "returnTo" in caseSearch ? caseSearch.returnTo : undefined,
      );
      expect(back).toBe(clientPath);
      await act(async () => {
        await router.navigate({ href: back });
      });
      expect((await screen.findByRole("link", { name: "返回客戶清單" })).getAttribute("href")).toBe(
        registerPath,
      );
      expect(defaultParseSearch(registerPath.slice(registerPath.indexOf("?")))).toMatchObject({
        q: "Acme",
        status: "inactive",
        cursor: '["Acme","10000000-0000-0000-0000-000000000001"]',
      });
    },
  );

  it("does not load company work for a malformed client id", async () => {
    await openClient("/clients/not-a-uuid");
    expect(await screen.findByRole("heading", { name: "找不到客戶" })).toBeTruthy();
    expect(rpc.client).not.toHaveBeenCalled();
    expect(rpc.work).not.toHaveBeenCalled();
  });

  it.each(["document", "history"])(
    "preserves the same client context for its %s case entry",
    async (entry) => {
      if (entry === "document")
        rpc.documents.mockResolvedValue({
          documents: [
            {
              id: "50000000-0000-0000-0000-000000000001",
              companyId: clientId,
              caseId: cases[0].id,
              fileName: "synthetic-proof.pdf",
              uploadStatus: "quarantined",
              scanVerdictSource: null,
              reviewStatus: "pending",
              currentVersionId: "60000000-0000-0000-0000-000000000001",
            },
          ],
          nextCursor: null,
        });
      else
        rpc.client.mockResolvedValue({
          ...clientRecord,
          annualReturnHistory: [
            {
              id: cases[0].id,
              returnYear: 2026,
              madeUpDate: "2026-10-01",
              filingDueDate: "2026-11-12",
              currentStatus: "Documents pending",
            },
          ],
        });
      await openClient();
      const link = await screen.findByRole("link", {
        name: entry === "document" ? "開啟文件所屬案件" : "開啟案件",
      });
      const target = new URL(link.getAttribute("href")!, "https://example.test");
      expect(target.pathname).toBe(`/annual-returns/${cases[0].id}`);
      expect(defaultParseSearch(target.search)).toMatchObject({ returnTo: clientPath });
    },
  );

  it("retains a backend denial without exposing case links or widening company scope", async () => {
    rpc.client.mockRejectedValue(new Error("Forbidden: synthetic foreign company"));
    await openClient();
    expect(await screen.findByRole("heading", { name: "客戶資料無法載入" })).toBeTruthy();
    expect(rpc.work).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /開啟.*案件/ })).toBeNull();
  });
});
