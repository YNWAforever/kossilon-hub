import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";
import { DemoIncorporationNotice } from "@/features/incorporation/components/demo-incorporation-notice";
import { ProductionIncorporationList } from "@/features/incorporation/components/production-incorporation-list";

export const Route = createFileRoute("/incorporation")({
  head: () => ({ meta: [{ title: pageTitle("公司註冊") }] }),
  component: IncorporationRoute,
});

function IncorporationRoute() {
  const { dataMode } = Route.useRouteContext();
  return dataMode === "demo" ? (
    <DemoIncorporationNotice variant="list" />
  ) : (
    <ProductionIncorporationList />
  );
}
