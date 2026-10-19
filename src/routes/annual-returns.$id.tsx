import { pageTitle } from "@/lib/page-title";
import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { DemoAnnualReturnCaseDetail } from "@/features/annual-return/components/demo-case-detail";
import { ProductionAnnualReturnCaseDetail } from "@/features/annual-return/components/production-case-detail";
import { caseReturnPath } from "@/features/annual-return/daily-view-state";

export const Route = createFileRoute("/annual-returns/$id")({
  head: () => ({ meta: [{ title: pageTitle("周年申報案件") }] }),
  validateSearch: (input: SearchSchemaInput & { returnTo?: unknown }) => ({
    ...(input.returnTo !== undefined ? { returnTo: caseReturnPath(input.returnTo) } : {}),
  }),
  component: AnnualReturnDetailRoute,
});

function AnnualReturnDetailRoute() {
  const { id } = Route.useParams();
  const { dataMode, actor } = Route.useRouteContext();
  const { returnTo } = Route.useSearch();

  return dataMode === "demo" ? (
    <DemoAnnualReturnCaseDetail caseId={id} />
  ) : (
    <ProductionAnnualReturnCaseDetail
      caseId={id}
      returnTo={returnTo}
      actorScope={JSON.stringify(actor)}
    />
  );
}
