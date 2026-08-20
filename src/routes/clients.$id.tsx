import { createFileRoute } from "@tanstack/react-router";
import { DemoClientNotice } from "@/features/clients/components/demo-client-notice";
import { ProductionClientDetail } from "@/features/clients/components/production-client-detail";

export const Route = createFileRoute("/clients/$id")({
  component: ClientDetailRoute,
});

function ClientDetailRoute() {
  const { id } = Route.useParams();
  const { dataMode } = Route.useRouteContext();
  return dataMode === "demo" ? (
    <DemoClientNotice variant="detail" />
  ) : (
    <ProductionClientDetail clientId={id} />
  );
}
