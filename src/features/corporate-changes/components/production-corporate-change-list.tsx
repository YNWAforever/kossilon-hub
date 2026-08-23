import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { CreateCorporateChangeRequestDialog } from "@/components/corporate-changes/create-corporate-change-request-dialog";
import { listCorporateChangeRequests } from "@/features/corporate-changes/server-fns";
import { listClients } from "@/features/clients/server-fns";

export function ProductionCorporateChangeList() {
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const requestsQuery = useQuery({
    queryKey: ["corporate-change-requests"],
    queryFn: () => listCorporateChangeRequests({ data: {} }),
    retry: false,
  });

  // `listClientAssignmentOptions` only returns owner/team pairs, not companies, so the
  // company picker is fed from `listClients` (the same list the client register renders).
  const clientsQuery = useQuery({
    queryKey: ["clients"],
    queryFn: () => listClients(),
    retry: false,
  });

  if (requestsQuery.isPending) {
    return (
      <div className="flex min-h-64 items-center justify-center p-6 text-sm text-muted-foreground">
        <Loader2 aria-hidden className="mr-2 h-4 w-4 animate-spin" />
        Loading corporate change requests
      </div>
    );
  }

  if (requestsQuery.isError) {
    return (
      <main className="flex-1 space-y-3 p-6">
        <PageHeader eyebrow="Operations" title="Corporate changes" />
        <p role="alert" className="text-sm text-destructive">
          Corporate change request data is unavailable. Try again shortly.
        </p>
      </main>
    );
  }

  const requests = requestsQuery.data ?? [];
  const companies = (clientsQuery.data ?? []).map((client) => ({
    id: client.id,
    companyName: client.companyName,
  }));

  return (
    <main className="flex-1 space-y-6 p-4 md:p-6">
      <PageHeader
        eyebrow="Operations"
        title="Corporate changes"
        subtitle="Name changes, share transfers, officer changes, and registered-office changes."
        actions={
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            New request
          </button>
        }
      />

      {clientsQuery.isError ? (
        <p role="status" className="text-sm text-status-yellow">
          Company options are unavailable. Starting a new request is disabled until this loads.
        </p>
      ) : null}

      <section className="rounded-lg border bg-card">
        {requests.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No corporate change requests yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="p-3 font-medium">Company</th>
                <th className="p-3 font-medium">Type</th>
                <th className="p-3 font-medium">Status</th>
                <th className="p-3 font-medium">Quoted fee</th>
              </tr>
            </thead>
            <tbody>
              {requests.map((request) => (
                <tr key={request.id} className="border-b last:border-0">
                  {/* The `/corporate-changes/$id` detail route ships in a later task in this
                      plan; until it exists, a typed <Link> to it fails typecheck, so this is
                      plain text rather than a dead or untyped link. */}
                  <td className="p-3 font-medium">{request.companyName}</td>
                  <td className="p-3">{request.changeType.replace("_", " ")}</td>
                  <td className="p-3">{request.status}</td>
                  <td className="p-3">HKD {request.quotedFee.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <CreateCorporateChangeRequestDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        companies={companies}
        isLoading={clientsQuery.isLoading}
        hasError={clientsQuery.isError}
        onCreated={() => {
          void queryClient.invalidateQueries({ queryKey: ["corporate-change-requests"] });
        }}
      />
    </main>
  );
}
