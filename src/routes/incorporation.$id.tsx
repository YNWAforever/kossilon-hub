import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";
import { DemoIncorporationNotice } from "@/features/incorporation/components/demo-incorporation-notice";
import { ProductionIncorporationDetail } from "@/features/incorporation/components/production-incorporation-detail";

export const Route = createFileRoute("/incorporation/$id")({
  head: () => ({ meta: [{ title: pageTitle("公司註冊案件") }] }),
  component: IncorporationDetailRoute,
});

function IncorporationDetailRoute() {
  const { id } = Route.useParams();
  const { dataMode } = Route.useRouteContext();
  return dataMode === "demo" ? (
    <DemoIncorporationNotice variant="detail" />
  ) : (
    <ProductionIncorporationDetail caseId={id} />
  );
}
