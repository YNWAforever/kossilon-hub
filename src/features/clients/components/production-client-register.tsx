import { type ReactNode, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import type { StatusTone } from "@/lib/status";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { listClientAssignmentOptions, listClientPage } from "../server-fns";
import type { ClientPaymentStatus, ClientSummary, CompanyStatus } from "../types";
import { dataOriginLabel } from "../data-origin";
import { BulkSelectionToolbar } from "@/components/bulk-selection-toolbar";
import type { AuthenticatedActor } from "@/features/auth/types";

const REGISTER_GRID_COLUMNS =
  "lg:grid-cols-[minmax(220px,1.6fr)_140px_140px_100px_120px_110px_72px]";
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

export function ProductionClientRegister({
  allowFixtureDiagnostics = false,
  actor = null,
}: {
  allowFixtureDiagnostics?: boolean;
  actor?: AuthenticatedActor | null;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [includeFixtures, setIncludeFixtures] = useState(false);
  const [pagination, setPagination] = useState<{ key: string; cursor?: string }>({ key: "" });
  const filters = {
    includeFixtures,
    q: query,
    ...(statusFilter !== "all" ? { status: statusFilter } : {}),
    ...(teamFilter !== "all" ? { teamId: teamFilter } : {}),
  };
  const filterKey = JSON.stringify(filters),
    cursor = pagination.key === filterKey ? pagination.cursor : undefined;

  const clientsQuery = useQuery({
    queryKey: ["clients", { ...filters, cursor, actorScope: actor }],
    queryFn: () => listClientPage({ data: { ...filters, cursor, limit: 100 } }),
    retry: false,
  });

  const optionsQuery = useQuery({
    queryKey: ["clients", "assignment-options"],
    queryFn: () => listClientAssignmentOptions(),
    retry: false,
  });

  const visibleClients = clientsQuery.data?.clients ?? [];

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
      <p className="text-sm text-muted-foreground">
        {includeFixtures
          ? "診斷範圍：包含測試資料；測試與歷史資料不會外發。"
          : "正式範圍：排除測試資料；歷史資料只供查閱。"}
      </p>
      {actor?.active && (actor.role === "Admin" || actor.role === "Manager") ? (
        <BulkSelectionToolbar
          actorScope={JSON.stringify(actor)}
          resource="client_company"
          filters={{
            ...(query.trim() ? { q: query.trim() } : {}),
            ...(statusFilter !== "all" ? { clientStatus: statusFilter } : {}),
            ...(teamFilter !== "all" ? { teamId: teamFilter } : {}),
            includeFixtures,
          }}
          page={visibleClients.map((c) => ({ id: c.id, label: c.companyName }))}
          total={clientsQuery.data?.total ?? null}
          pageSize={100}
          maintenanceActions={["client_maintenance"]}
        />
      ) : null}
      {allowFixtureDiagnostics ? (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeFixtures}
            onChange={(event) => setIncludeFixtures(event.target.checked)}
          />
          包含測試資料（Admin 診斷）
        </label>
      ) : null}

      {clientsQuery.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Client data is unavailable. Try again shortly.
        </p>
      ) : null}

      {optionsQuery.isError ? (
        <p role="status" className="text-sm text-status-yellow">
          Owner and team options are unavailable. New client is disabled until this loads.
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
      <div className="flex gap-3">
        {cursor ? (
          <button
            className="min-h-11 rounded border px-3"
            onClick={() => setPagination({ key: filterKey })}
          >
            回第一頁客戶
          </button>
        ) : null}
        {clientsQuery.data?.nextCursor ? (
          <button
            className="min-h-11 rounded border px-3"
            onClick={() =>
              setPagination({ key: filterKey, cursor: clientsQuery.data!.nextCursor! })
            }
          >
            下一頁客戶
          </button>
        ) : null}
      </div>

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
        <span className="text-xs text-muted-foreground">{dataOriginLabel(client.dataOrigin)}</span>
        <p className="truncate text-xs text-muted-foreground">
          CR {client.crNumber} · BR {client.brNumber}
        </p>
      </div>
      <Field label="Owner" value={client.ownerName} />
      <Field label="Team" value={client.teamName} />
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
