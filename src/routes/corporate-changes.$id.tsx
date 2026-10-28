import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";
import { DemoCorporateChangeNotice } from "@/features/corporate-changes/components/demo-corporate-change-notice";
import { ProductionCorporateChangeDetail } from "@/features/corporate-changes/components/production-corporate-change-detail";
import { caseReturnPath } from "@/features/annual-return/daily-view-state";

export const Route = createFileRoute("/corporate-changes/$id")({
  head: () => ({ meta: [{ title: pageTitle("公司變更申請") }] }),
  validateSearch: (input: Record<string, unknown>) => ({
    ...(input.returnTo !== undefined ? { returnTo: caseReturnPath(input.returnTo) } : {}),
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
