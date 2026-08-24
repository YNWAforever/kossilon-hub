import { createFileRoute } from "@tanstack/react-router";
import { DemoCorporateChangeNotice } from "@/features/corporate-changes/components/demo-corporate-change-notice";
import { ProductionCorporateChangeDetail } from "@/features/corporate-changes/components/production-corporate-change-detail";

export const Route = createFileRoute("/corporate-changes/$id")({
  component: CorporateChangeDetailRoute,
});

function CorporateChangeDetailRoute() {
  const { id } = Route.useParams();
  const { dataMode } = Route.useRouteContext();
  return dataMode === "demo" ? (
    <DemoCorporateChangeNotice variant="detail" />
  ) : (
    <ProductionCorporateChangeDetail requestId={id} />
  );
}
