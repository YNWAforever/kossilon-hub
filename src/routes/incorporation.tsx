import { pageTitle } from "@/lib/page-title";
import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { DemoIncorporationNotice } from "@/features/incorporation/components/demo-incorporation-notice";
import { ProductionIncorporationList } from "@/features/incorporation/components/production-incorporation-list";

export const Route = createFileRoute("/incorporation")({
  head: () => ({ meta: [{ title: pageTitle("公司註冊") }] }),
  component: IncorporationRoute,
});

function IncorporationRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { dataMode } = Route.useRouteContext();

  // /incorporation/$id is a child route and renders only through this outlet; without
  // it, opening a case changed the URL and left the list on screen.
  if (pathname !== "/incorporation") {
    return <Outlet />;
  }

  return dataMode === "demo" ? (
    <DemoIncorporationNotice variant="list" />
  ) : (
    <ProductionIncorporationList />
  );
}
