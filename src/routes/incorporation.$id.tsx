import { createFileRoute } from "@tanstack/react-router";
import { DemoIncorporationNotice } from "@/features/incorporation/components/demo-incorporation-notice";
import { ProductionIncorporationDetail } from "@/features/incorporation/components/production-incorporation-detail";

export const Route = createFileRoute("/incorporation/$id")({
  component: IncorporationDetailRoute,
});

function IncorporationDetailRoute() {
  const { id } = Route.useParams();
  const { dataMode } = Route.useRouteContext();
  return dataMode === "demo" ? (
    <DemoIncorporationNotice variant="detail" />
  ) : (
    <ProductionIncorporationDetail caseId={id} />
  );
}
