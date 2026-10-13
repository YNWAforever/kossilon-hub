import { pageTitle } from "@/lib/page-title";
import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { DemoCorporateChangeNotice } from "@/features/corporate-changes/components/demo-corporate-change-notice";
import { ProductionCorporateChangeList } from "@/features/corporate-changes/components/production-corporate-change-list";

export const Route = createFileRoute("/corporate-changes")({
  head: () => ({ meta: [{ title: pageTitle("公司變更") }] }),
  component: CorporateChangesRoute,
});

function CorporateChangesRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { dataMode } = Route.useRouteContext();

  // /corporate-changes/$id is a child route and renders only through this outlet; without
  // it, opening a case changed the URL and left the list on screen.
  if (pathname !== "/corporate-changes") {
    return <Outlet />;
  }

  return dataMode === "demo" ? (
    <DemoCorporateChangeNotice variant="list" />
  ) : (
    <ProductionCorporateChangeList />
  );
}
