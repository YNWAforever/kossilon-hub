import { createFileRoute, useNavigate, type SearchSchemaInput } from "@tanstack/react-router";
import { businessListSearch } from "@/lib/business-list";
import { corporateChangeListPageSchema } from "@/features/corporate-changes/list-page";
import { DemoCorporateChangeNotice } from "@/features/corporate-changes/components/demo-corporate-change-notice";
import { ProductionCorporateChangeList } from "@/features/corporate-changes/components/production-corporate-change-list";

export const Route = createFileRoute("/corporate-changes")({
  validateSearch: (input: SearchSchemaInput & Record<string, unknown>) =>
    businessListSearch(input, corporateChangeListPageSchema.shape.status),
  component: CorporateChangesRoute,
});

function CorporateChangesRoute() {
  const { dataMode, actor } = Route.useRouteContext();
  const search = Route.useSearch(),
    navigate = useNavigate({ from: "/corporate-changes" });
  return dataMode === "demo" ? (
    <DemoCorporateChangeNotice variant="list" />
  ) : (
    <ProductionCorporateChangeList
      actor={actor ?? undefined}
      search={search}
      onSearchChange={(next) => void navigate({ search: next, replace: true })}
    />
  );
}
