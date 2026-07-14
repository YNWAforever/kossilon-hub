import { createFileRoute } from "@tanstack/react-router";
import { DemoAnnualReturnCaseDetail } from "@/features/annual-return/components/demo-case-detail";
import { ProductionAnnualReturnCaseDetail } from "@/features/annual-return/components/production-case-detail";

export const Route = createFileRoute("/annual-returns/$id")({
  component: AnnualReturnDetailRoute,
});

function AnnualReturnDetailRoute() {
  const { id } = Route.useParams();
  const { dataMode } = Route.useRouteContext();

  return dataMode === "demo" ? (
    <DemoAnnualReturnCaseDetail caseId={id} />
  ) : (
    <ProductionAnnualReturnCaseDetail caseId={id} />
  );
}
