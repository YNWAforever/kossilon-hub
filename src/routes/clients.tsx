import { createFileRoute, Outlet, useRouterState } from "@tanstack/react-router";
import { DemoClientNotice } from "@/features/clients/components/demo-client-notice";
import { ProductionClientRegister } from "@/features/clients/components/production-client-register";

export const Route = createFileRoute("/clients")({
  component: ClientsRoute,
});

function ClientsRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { dataMode } = Route.useRouteContext();

  // /clients/$id is a child route and renders only through this outlet, so a
  // branch placed before it would silently stop the detail screen from
  // rendering. See annual-returns.tsx for the identical precedent.
  if (pathname !== "/clients") {
    return <Outlet />;
  }

  return dataMode === "demo" ? (
    <DemoClientNotice variant="register" />
  ) : (
    <ProductionClientRegister />
  );
}
