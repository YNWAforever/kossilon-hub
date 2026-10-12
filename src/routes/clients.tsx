import {
  createFileRoute,
  Outlet,
  useRouterState,
  type SearchSchemaInput,
} from "@tanstack/react-router";
import { DemoClientNotice } from "@/features/clients/components/demo-client-notice";
import { ProductionClientRegister } from "@/features/clients/components/production-client-register";
import { clientListSearch } from "@/lib/list-navigation";

export const Route = createFileRoute("/clients")({
  validateSearch: (input: SearchSchemaInput & Record<string, unknown>) => clientListSearch(input),
  component: ClientsRoute,
});

function ClientsRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { dataMode, actor } = Route.useRouteContext();
  const search = Route.useSearch(),
    navigate = Route.useNavigate();

  // /clients/$id is a child route and renders only through this outlet, so a
  // branch placed before it would silently stop the detail screen from
  // rendering. See annual-returns.tsx for the identical precedent.
  if (pathname !== "/clients") {
    return <Outlet />;
  }

  return dataMode === "demo" ? (
    <DemoClientNotice variant="register" />
  ) : (
    <ProductionClientRegister
      allowFixtureDiagnostics={actor?.active === true && actor.role === "Admin"}
      actor={actor}
      search={search}
      onSearchChange={(next) => void navigate({ search: next })}
    />
  );
}
