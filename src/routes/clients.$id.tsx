import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { safeListReturnTo } from "@/lib/list-navigation";
import { DemoClientNotice } from "@/features/clients/components/demo-client-notice";
import { ProductionClientDetail } from "@/features/clients/components/production-client-detail";

export const Route = createFileRoute("/clients/$id")({
  validateSearch: (input: SearchSchemaInput & { returnTo?: unknown }) => ({
    ...(input.returnTo !== undefined ? { returnTo: safeListReturnTo(input.returnTo) } : {}),
  }),
  component: ClientDetailRoute,
});

function ClientDetailRoute() {
  const { id } = Route.useParams();
  const { dataMode } = Route.useRouteContext();
  const { returnTo } = Route.useSearch();
  return dataMode === "demo" ? (
    <DemoClientNotice variant="detail" />
  ) : (
    <ProductionClientDetail clientId={id} returnTo={returnTo} />
  );
}
