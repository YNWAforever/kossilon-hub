import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { DemoAnnualReturnCaseDetail } from "@/features/annual-return/components/demo-case-detail";
import { ProductionAnnualReturnCaseDetail } from "@/features/annual-return/components/production-case-detail";
import { caseReturnPath } from "@/features/annual-return/daily-view-state";

export const Route = createFileRoute("/annual-returns/$id")({
  validateSearch: (input: SearchSchemaInput & { returnTo?: unknown }) => ({
    returnTo: caseReturnPath(input.returnTo),
  }),
  component: AnnualReturnDetailRoute,
});

function AnnualReturnDetailRoute() {
  const { id } = Route.useParams();
  const { dataMode } = Route.useRouteContext();
  const { returnTo } = Route.useSearch();

  return dataMode === "demo" ? (
    <DemoAnnualReturnCaseDetail caseId={id} />
  ) : (
    <ProductionAnnualReturnCaseDetail caseId={id} returnTo={returnTo} />
  );
}
