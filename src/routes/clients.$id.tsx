import { createFileRoute, type SearchSchemaInput } from "@tanstack/react-router";
import { DemoClientNotice } from "@/features/clients/components/demo-client-notice";
import { CompanyWorkspaceScreen } from "@/features/clients/components/company-workspace-screen";
import { companyWorkspaceSearch } from "@/features/clients/company-workspace-navigation";
export const Route = createFileRoute("/clients/$id")({
  validateSearch: (input: SearchSchemaInput & Record<string, unknown>) =>
    companyWorkspaceSearch(input),
  component: ClientDetailRoute,
});
function ClientDetailRoute() {
  const { id } = Route.useParams(),
    { dataMode, actor } = Route.useRouteContext(),
    search = companyWorkspaceSearch(Route.useSearch()),
    navigate = Route.useNavigate();
  return dataMode === "demo" ? (
    <DemoClientNotice variant="detail" />
  ) : (
    <CompanyWorkspaceScreen
      companyId={id}
      actor={actor ?? undefined}
      search={search}
      onSearchChange={(s) => void navigate({ search: s, replace: true })}
    />
  );
}
