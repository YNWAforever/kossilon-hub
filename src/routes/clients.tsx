import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";

import { useAuth } from "@/features/auth/auth-context-neon";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { ProductionClientDirectory } from "@/features/clients/components/production-client-directory";
import { clientSearchFromUrl } from "@/features/clients/board-filters";

export const Route = createFileRoute("/clients")({
  // Filters live in the URL so they survive a reload and a return from a profile.
  // The sanitiser is in board-filters.ts so it can be unit-tested; a route file
  // cannot export a non-component without tripping react-refresh.
  validateSearch: clientSearchFromUrl,
  component: ClientsRoute,
});

function ClientsRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);

  // Hoisted above the branch. /clients/$id is a child route and renders only
  // through this outlet, so anything placed before it would silently stop the
  // profile rendering — which is exactly what happened on the first attempt.
  if (pathname !== "/clients") {
    return <Outlet />;
  }

  const canManage = session?.role === "Admin" || session?.role === "Manager";

  return (
    <>
      <ProductionClientDirectory
        search={search}
        onSearchChange={(next) => void navigate({ search: next, replace: true })}
        canManage={canManage}
        onAddClient={() => setAddOpen(true)}
      />
      <ClientFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        canManage={canManage}
        onSaved={() => void queryClient.invalidateQueries({ queryKey: ["clients"] })}
      />
    </>
  );
}
