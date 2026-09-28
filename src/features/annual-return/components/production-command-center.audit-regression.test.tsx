import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProductionAnnualReturnCommandCenter } from "./production-command-center";
import { boardFiltersFromSearch } from "../board-filters";
import { annualReturnQueryKeys } from "../query-keys";

describe("T03 board metric query state", () => {
  it("t03_scenario_3 shows loading instead of zero while totals are pending", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rootRoute = createRootRoute();
    const indexRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: () => createElement(ProductionAnnualReturnCommandCenter, { search: {} }),
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([indexRoute]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await router.load();
    const html = renderToString(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(RouterProvider, { router }),
      ),
    );
    expect(html).toContain("載入案件統計中");
    expect(html).not.toContain("Overdue cases");
    expect(html).not.toContain("Cases in scope");
  });

  it("hides stale zero tiles and offers retry when totals fail", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, retryOnMount: false, refetchOnMount: false } },
    });
    const filters = boardFiltersFromSearch({}, 50);
    queryClient.setQueryData(annualReturnQueryKeys.boardPages(filters), {
      pages: [{ cases: [], nextCursor: null }],
      pageParams: [null],
    });
    await queryClient.prefetchQuery({
      queryKey: annualReturnQueryKeys.boardTotals({}),
      queryFn: () => Promise.reject(new Error("private SQL detail")),
    });
    const rootRoute = createRootRoute();
    const indexRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: () => createElement(ProductionAnnualReturnCommandCenter, { search: {} }),
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([indexRoute]),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    await router.load();
    const html = renderToString(
      createElement(
        QueryClientProvider,
        { client: queryClient },
        createElement(RouterProvider, { router }),
      ),
    );
    expect(html).toContain("無法載入案件統計");
    expect(html).toContain("重試");
    expect(html).not.toContain("Overdue cases");
    expect(html).not.toContain("private SQL detail");
  });
});
