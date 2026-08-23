import { createFileRoute } from "@tanstack/react-router";
import { DemoCorporateChangeNotice } from "@/features/corporate-changes/components/demo-corporate-change-notice";
import { ProductionCorporateChangeList } from "@/features/corporate-changes/components/production-corporate-change-list";

export const Route = createFileRoute("/corporate-changes")({
  component: CorporateChangesRoute,
});

function CorporateChangesRoute() {
  const { dataMode } = Route.useRouteContext();
  return dataMode === "demo" ? (
    <DemoCorporateChangeNotice variant="list" />
  ) : (
    <ProductionCorporateChangeList />
  );
}
