import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { safeListReturnTo } from "@/lib/list-navigation";
import { DemoIncorporationNotice } from "@/features/incorporation/components/demo-incorporation-notice";
import { ProductionIncorporationDetail } from "@/features/incorporation/components/production-incorporation-detail";

export const Route = createFileRoute("/incorporation/$id")({
  validateSearch: (input: SearchSchemaInput & { returnTo?: unknown }) => ({
    ...(input.returnTo !== undefined ? { returnTo: safeListReturnTo(input.returnTo) } : {}),
  }),
  component: IncorporationDetailRoute,
});

function IncorporationDetailRoute() {
  const { id } = Route.useParams();
  const { dataMode } = Route.useRouteContext();
  const { returnTo } = Route.useSearch();
  return dataMode === "demo" ? (
    <DemoIncorporationNotice variant="detail" />
  ) : (
    <ProductionIncorporationDetail caseId={id} returnTo={returnTo} />
  );
}
