import { pageTitle } from "@/lib/page-title";
import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { DemoClientNotice } from "@/features/clients/components/demo-client-notice";
import { ProductionClientDetail } from "@/features/clients/components/production-client-detail";
import { clientDetailSearch } from "@/features/clients/register-view-state";

export const Route = createFileRoute("/clients/$id")({
  head: () => ({ meta: [{ title: pageTitle("客戶資料") }] }),
  validateSearch: (input: SearchSchemaInput & Record<string, unknown>) => clientDetailSearch(input),
  component: ClientDetailRoute,
});

function ClientDetailRoute() {
  const { id } = Route.useParams();
  const { dataMode, actor } = Route.useRouteContext();
  const { returnTo } = Route.useSearch();
  const detailProps = { clientId: id, actorScope: actor, returnTo };
  return dataMode === "demo" ? (
    <DemoClientNotice variant="detail" />
  ) : (
    <ProductionClientDetail {...detailProps} />
  );
}
