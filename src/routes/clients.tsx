import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { DemoClientNotice } from "@/features/clients/components/demo-client-notice";
import {
  ProductionClientRegister,
  type ClientRegisterSearch,
} from "@/features/clients/components/production-client-register";

export const Route = createFileRoute("/clients")({
  validateSearch: (search: Record<string, unknown>): ClientRegisterSearch => ({
    ...(typeof search.q === "string" && search.q.length > 0 ? { q: search.q.slice(0, 200) } : {}),
    ...(search.status === "active" || search.status === "inactive"
      ? { status: search.status }
      : {}),
    ...(typeof search.team === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(search.team)
      ? { team: search.team }
      : {}),
    ...(typeof search.page === "number" && Number.isSafeInteger(search.page) && search.page > 1
      ? { page: search.page }
      : {}),
    ...(typeof search.bulkOperation === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(search.bulkOperation)
      ? { bulkOperation: search.bulkOperation }
      : {}),
  }),
  component: ClientsRoute,
});

function ClientsRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { dataMode, actor } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

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
      search={search}
      canManage={actor?.active === true && (actor.role === "Admin" || actor.role === "Manager")}
      onSearchChange={(next) => void navigate({ search: next, replace: true })}
    />
  );
}
