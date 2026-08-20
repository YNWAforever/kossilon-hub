import { type ReactNode, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import type { StatusTone } from "@/lib/status";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { listClientAssignmentOptions, listClients } from "../server-fns";
import type { ClientPaymentStatus, ClientSummary, CompanyStatus } from "../types";

const REGISTER_GRID_COLUMNS =
  "lg:grid-cols-[minmax(220px,1.6fr)_140px_140px_140px_100px_120px_110px_72px]";
const REGISTER_GRID_MIN_WIDTH = "lg:min-w-[1180px]";

const STATUS_FILTERS = ["all", "active", "inactive"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const companyStatusTone: Record<CompanyStatus, StatusTone> = {
  active: "green",
  inactive: "neutral",
};

const paymentStatusTone: Record<ClientPaymentStatus, StatusTone> = {
  "Not invoiced": "neutral",
  "Payment pending": "yellow",
  "Payment received": "green",
  Overdue: "red",
};

export function ProductionClientRegister() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const clientsQuery = useQuery({
    queryKey: ["clients"],
    queryFn: () => listClients(),
    retry: false,
  });

  const optionsQuery = useQuery({
    queryKey: ["clients", "assignment-options"],
    queryFn: () => listClientAssignmentOptions(),
    retry: false,
  });

  const clients = useMemo(() => clientsQuery.data ?? [], [clientsQuery.data]);

  const visibleClients = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return clients.filter((client) => {
      const matchesQuery =
        needle.length === 0 ||
        client.companyName.toLowerCase().includes(needle) ||
        client.crNumber.toLowerCase().includes(needle) ||
        client.brNumber.toLowerCase().includes(needle);
      const matchesStatus = statusFilter === "all" || client.status === statusFilter;
      const matchesTeam = teamFilter === "all" || client.teamId === teamFilter;
      return matchesQuery && matchesStatus && matchesTeam;
    });
  }, [clients, query, statusFilter, teamFilter]);

  function handleCreated() {
    void queryClient.invalidateQueries({ queryKey: ["clients"] });
  }

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader
        eyebrow="Operations"
        title="Clients"
        actions={
          <button
            type="button"
            disabled={!optionsQuery.data}
            onClick={() => setIsCreateOpen(true)}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60"
          >
            New client
          </button>
        }
      />

      {clientsQuery.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Client data is unavailable. Try again shortly.
        </p>
      ) : null}

      {optionsQuery.isError ? (
        <p role="status" className="text-sm text-status-yellow">
          Owner, team and package options are unavailable. New client is disabled until this loads.
        </p>
      ) : null}

      <section className="rounded-lg border bg-card">
        <div className="grid gap-3 border-b p-4 lg:grid-cols-[1fr_auto_auto]">
          <input
            className="rounded-md border bg-background px-3 py-2 text-sm"
            aria-label="Search company, CR or BR number"
            placeholder="Search company, CR or BR number"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((value) => (
              <button
                key={value}
                type="button"
                className={`rounded-md border px-3 py-2 text-sm capitalize ${
                  statusFilter === value ? "bg-primary text-primary-foreground" : "bg-background"
                }`}
                onClick={() => setStatusFilter(value)}
              >
                {value}
              </button>
            ))}
          </div>
          <select
            className="rounded-md border bg-background px-3 py-2 text-sm"
            aria-label="Filter by team"
            value={teamFilter}
            onChange={(event) => setTeamFilter(event.target.value)}
          >
            <option value="all">All teams</option>
            {(optionsQuery.data?.teams ?? []).map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto">
          <div className={REGISTER_GRID_MIN_WIDTH}>
            <div
              className={`hidden gap-3 border-b px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:grid ${REGISTER_GRID_COLUMNS}`}
            >
              <span>Company</span>
              <span>Owner</span>
              <span>Team</span>
              <span>Package</span>
              <span>Status</span>
              <span>AR due</span>
              <span>Payment</span>
              <span className="text-right">Open</span>
            </div>

            <div className="divide-y">
              {visibleClients.map((client) => (
                <ClientRow key={client.id} client={client} />
              ))}
            </div>
          </div>
        </div>

        {clientsQuery.isPending ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Loading clients...</p>
        ) : null}

        {!clientsQuery.isPending && !clientsQuery.isError && visibleClients.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            No clients match the current filters.
          </p>
        ) : null}
      </section>

      {optionsQuery.data ? (
        <ClientFormDialog
          open={isCreateOpen}
          onOpenChange={setIsCreateOpen}
          options={optionsQuery.data}
          onSaved={handleCreated}
        />
      ) : null}
    </main>
  );
}

function ClientRow({ client }: { client: ClientSummary }) {
  return (
    <div className={`grid gap-3 px-4 py-4 lg:items-center ${REGISTER_GRID_COLUMNS}`}>
      <div className="min-w-0">
        <p className="truncate font-medium">{client.companyName}</p>
        <p className="truncate text-xs text-muted-foreground">
          CR {client.crNumber} · BR {client.brNumber}
        </p>
      </div>
      <Field label="Owner" value={client.ownerName} />
      <Field label="Team" value={client.teamName} />
      <Field label="Package" value={client.packageName ?? "No package"} />
      <Field
        label="Status"
        value={<StatusPill tone={companyStatusTone[client.status]}>{client.status}</StatusPill>}
      />
      <Field label="AR due" value={client.arDueDate ?? "No case yet"} />
      <Field
        label="Payment"
        value={
          client.paymentStatus ? (
            <StatusPill tone={paymentStatusTone[client.paymentStatus]}>
              {client.paymentStatus}
            </StatusPill>
          ) : (
            "—"
          )
        }
      />
      <div className="flex justify-start lg:justify-end">
        <Link
          className="rounded-md border px-3 py-2 text-center text-sm"
          to="/clients/$id"
          params={{ id: client.id }}
        >
          Open
        </Link>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:hidden">
        {label}
      </p>
      <div className="text-sm leading-5">{value}</div>
    </div>
  );
}
