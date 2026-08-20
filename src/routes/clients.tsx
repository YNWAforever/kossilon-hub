import { createFileRoute } from "@tanstack/react-router";
import { DemoClientNotice } from "@/features/clients/components/demo-client-notice";
import { ProductionClientRegister } from "@/features/clients/components/production-client-register";

export const Route = createFileRoute("/clients")({
  component: ClientsRoute,
});

function ClientsRoute() {
  const { dataMode } = Route.useRouteContext();
  return dataMode === "demo" ? (
    <DemoClientNotice variant="register" />
  ) : (
    <ProductionClientRegister />
  );
}
