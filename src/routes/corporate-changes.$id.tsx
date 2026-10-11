import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { safeListReturnTo } from "@/lib/list-navigation";
import { DemoCorporateChangeNotice } from "@/features/corporate-changes/components/demo-corporate-change-notice";
import { ProductionCorporateChangeDetail } from "@/features/corporate-changes/components/production-corporate-change-detail";

export const Route = createFileRoute("/corporate-changes/$id")({
  validateSearch: (input: SearchSchemaInput & { returnTo?: unknown }) => ({
    ...(input.returnTo !== undefined ? { returnTo: safeListReturnTo(input.returnTo) } : {}),
  }),
  component: CorporateChangeDetailRoute,
});

function CorporateChangeDetailRoute() {
  const { id } = Route.useParams();
  const { dataMode } = Route.useRouteContext();
  const { returnTo } = Route.useSearch();
  return dataMode === "demo" ? (
    <DemoCorporateChangeNotice variant="detail" />
  ) : (
    <ProductionCorporateChangeDetail requestId={id} returnTo={returnTo} />
  );
}
