import { pageTitle } from "@/lib/page-title";
import {
  createFileRoute,
  Outlet,
  useRouterState,
  type SearchSchemaInput,
} from "@tanstack/react-router";
import { DemoClientNotice } from "@/features/clients/components/demo-client-notice";
import { ProductionClientRegister } from "@/features/clients/components/production-client-register";
import { clientRegisterSearch } from "@/features/clients/register-view-state";

export const Route = createFileRoute("/clients")({
  head: () => ({ meta: [{ title: pageTitle("客戶") }] }),
  validateSearch: (input: SearchSchemaInput & Record<string, unknown>) =>
    clientRegisterSearch(input),
  errorComponent: () => (
    <main className="space-y-4 p-6">
      <p role="alert">客戶篩選或頁位無效，請重設條件。</p>
      <a className="underline" href="/clients">
        重設客戶篩選
      </a>
    </main>
  ),
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
      allowFixtureDiagnostics={actor?.active === true && actor.role === "Admin"}
      actor={actor}
      search={search}
      onSearchChange={(next) => void navigate({ search: next, replace: true })}
    />
  );
}
