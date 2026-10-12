import { createFileRoute, useNavigate, type SearchSchemaInput } from "@tanstack/react-router";
import { businessListSearch } from "@/lib/business-list";
import { incorporationListPageSchema } from "@/features/incorporation/list-page";
import { DemoIncorporationNotice } from "@/features/incorporation/components/demo-incorporation-notice";
import { ProductionIncorporationList } from "@/features/incorporation/components/production-incorporation-list";

export const Route = createFileRoute("/incorporation")({
  validateSearch: (input: SearchSchemaInput & Record<string, unknown>) =>
    businessListSearch(input, incorporationListPageSchema.shape.status),
  component: IncorporationRoute,
});

function IncorporationRoute() {
  const { dataMode, actor } = Route.useRouteContext();
  const search = Route.useSearch(),
    navigate = useNavigate({ from: "/incorporation" });
  return dataMode === "demo" ? (
    <DemoIncorporationNotice variant="list" />
  ) : (
    <ProductionIncorporationList
      actor={actor ?? undefined}
      search={search}
      onSearchChange={(next) => void navigate({ search: next, replace: true })}
    />
  );
}
