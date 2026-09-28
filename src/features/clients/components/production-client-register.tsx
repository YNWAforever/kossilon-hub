import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { PageHeader } from "@/components/page-header";
import { BulkSelectionToolbar } from "@/components/bulk-selection-toolbar";
import {
  addPageToSelection,
  changeSelectionFilter,
  clearBulkSelection,
  newBulkSelection,
  removeFromSelection,
  retryFailedSelection,
} from "@/features/bulk-operations/selection";
import { ClientBulkAssignmentDialog } from "@/features/bulk-operations/client-bulk-controls";
import { ResourceTagDialog } from "@/features/bulk-operations/resource-tag-dialog";
import { WorkQueueBulkOperationStatus } from "@/features/bulk-operations/work-queue-bulk-controls";
import { StatusPill } from "@/components/status-pill";
import type { StatusTone } from "@/lib/status";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { listClientAssignmentOptions, listClients } from "../server-fns";
import type { ClientPaymentStatus, ClientSummary, CompanyStatus } from "../types";

const REGISTER_GRID_COLUMNS =
  "lg:grid-cols-[40px_minmax(220px,1.6fr)_140px_140px_100px_120px_110px_72px]";
const REGISTER_GRID_MIN_WIDTH = "lg:min-w-[1220px]";
const REGISTER_PAGE_SIZE = 50;

const STATUS_FILTERS = ["all", "active", "inactive"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];
export type ClientRegisterSearch = {
  q?: string;
  status?: StatusFilter;
  team?: string;
  page?: number;
  bulkOperation?: string;
};
const DEFAULT_SEARCH: ClientRegisterSearch = {};

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
  search,
  onSearchChange,
  canManage = false,
}: {
  search?: ClientRegisterSearch;
  onSearchChange?: (next: ClientRegisterSearch) => void;
  canManage?: boolean;
} = {}) {
  const queryClient = useQueryClient();
  const [localSearch, setLocalSearch] = useState<ClientRegisterSearch>(DEFAULT_SEARCH);
  const currentSearch = search ?? localSearch;
  const query = currentSearch.q ?? "";
  const statusFilter = currentSearch.status ?? "all";
  const teamFilter = currentSearch.team ?? "all";
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const filterKey = JSON.stringify([query.trim().toLowerCase(), statusFilter, teamFilter]);
  const [selection, setSelection] = useState(() => newBulkSelection(filterKey));
  const [matchingSelection, setMatchingSelection] = useState<{
    filterKey: string;
    excludedIds: string[];
  } | null>(null);
  const currentSelection =
    selection.filterKey === filterKey ? selection : changeSelectionFilter(selection, filterKey);
  const currentMatching = matchingSelection?.filterKey === filterKey ? matchingSelection : null;
  const selectedIds = useMemo(() => new Set(currentSelection.ids), [currentSelection.ids]);
  useEffect(() => {
    setSelection((previous) => changeSelectionFilter(previous, filterKey));
    setMatchingSelection(null);
    setBulkDialogOpen(false);
    setTagDialogOpen(false);
    setSelectionError(null);
  }, [filterKey]);
  function updateSearch(patch: Partial<ClientRegisterSearch>) {
    const next = { ...currentSearch, ...patch };
    if (onSearchChange) onSearchChange(next);
    else setLocalSearch(next);
  }

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

  const pageCount = Math.max(1, Math.ceil(visibleClients.length / REGISTER_PAGE_SIZE));
  const page = Math.min(currentSearch.page ?? 1, pageCount);
  const pageClients = visibleClients.slice(
    (page - 1) * REGISTER_PAGE_SIZE,
    page * REGISTER_PAGE_SIZE,
  );
  const selectionInput = currentMatching
    ? {
        kind: "filter" as const,
        resource: "clients" as const,
        filters: {
          ...(query.trim() ? { q: query.trim() } : {}),
          status: statusFilter,
          ...(teamFilter !== "all" ? { teamId: teamFilter } : {}),
        },
        excludedIds: currentMatching.excludedIds,
      }
    : { kind: "ids" as const, ids: currentSelection.ids };
  function toggleClient(id: string) {
    try {
      if (currentMatching) {
        const excluded = new Set(currentMatching.excludedIds);
        if (excluded.has(id)) excluded.delete(id);
        else excluded.add(id);
        setMatchingSelection({ filterKey, excludedIds: [...excluded] });
      } else {
        setSelection(
          selectedIds.has(id)
            ? removeFromSelection(currentSelection, id)
            : addPageToSelection(currentSelection, [id]),
        );
      }
      setSelectionError(null);
    } catch (error) {
      setSelectionError(error instanceof Error ? error.message : "Selection unavailable.");
    }
  }
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
            onChange={(event) => updateSearch({ q: event.target.value, page: 1 })}
          />
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((value) => (
              <button
                key={value}
                type="button"
                className={`rounded-md border px-3 py-2 text-sm capitalize ${
                  statusFilter === value ? "bg-primary text-primary-foreground" : "bg-background"
                }`}
                onClick={() => updateSearch({ status: value, page: 1 })}
              >
                {value}
              </button>
            ))}
          </div>
          <select
            className="rounded-md border bg-background px-3 py-2 text-sm"
            aria-label="Filter by team"
            value={teamFilter}
            onChange={(event) => updateSearch({ team: event.target.value, page: 1 })}
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
              <span>{canManage ? "Select" : ""}</span>
              <span>Company</span>
              <span>Owner</span>
              <span>Team</span>
              <span>Status</span>
              <span>AR due</span>
              <span>Payment</span>
              <span className="text-right">Open</span>
            </div>

            <div className="divide-y">
              {pageClients.map((client) => (
                <ClientRow
                  key={client.id}
                  client={client}
                  canManage={canManage}
                  selected={
                    currentMatching
                      ? !currentMatching.excludedIds.includes(client.id)
                      : selectedIds.has(client.id)
                  }
                  onToggle={() => toggleClient(client.id)}
                />
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

      {visibleClients.length > REGISTER_PAGE_SIZE ? (
        <nav aria-label="Client pages" className="flex items-center justify-between text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => updateSearch({ page: page - 1 })}
            className="rounded-md border border-border px-3 py-1.5 disabled:opacity-50"
          >
            Previous
          </button>
          <span>
            Page {page} of {pageCount} · {visibleClients.length} matching clients
          </span>
          <button
            type="button"
            disabled={page >= pageCount}
            onClick={() => updateSearch({ page: page + 1 })}
            className="rounded-md border border-border px-3 py-1.5 disabled:opacity-50"
          >
            Next
          </button>
        </nav>
      ) : null}

      {canManage && !clientsQuery.isError ? (
        <BulkSelectionToolbar
          selectedCount={currentSelection.ids.length}
          visibleCount={pageClients.length}
          selectionLabel={
            currentMatching ? "All matching clients (max 1000), server evaluated" : undefined
          }
          notice={currentSelection.notice}
          onSelectVisible={() => {
            try {
              if (currentMatching) {
                const pageIds = new Set(pageClients.map((client) => client.id));
                setMatchingSelection({
                  filterKey,
                  excludedIds: currentMatching.excludedIds.filter((id) => !pageIds.has(id)),
                });
              } else {
                setSelection(
                  addPageToSelection(
                    currentSelection,
                    pageClients.map((client) => client.id),
                  ),
                );
              }
              setSelectionError(null);
            } catch (error) {
              setSelectionError(error instanceof Error ? error.message : "Selection unavailable.");
            }
          }}
          onSelectMatching={() => {
            setSelection(newBulkSelection(filterKey));
            setMatchingSelection({ filterKey, excludedIds: [] });
            setSelectionError(null);
          }}
          onClear={() => {
            setSelection(clearBulkSelection(currentSelection));
            setMatchingSelection(null);
          }}
          previewEnabled={
            Boolean(optionsQuery.data) &&
            (Boolean(currentMatching) || currentSelection.ids.length > 0)
          }
          onPreview={() => setBulkDialogOpen(true)}
          onTag={() => setTagDialogOpen(true)}
          tagEnabled={Boolean(currentMatching) || currentSelection.ids.length > 0}
          exportSelection={
            selectionInput.kind === "ids"
              ? { ...selectionInput, resource: "clients" }
              : selectionInput
          }
          exportEnabled={Boolean(currentMatching) || currentSelection.ids.length > 0}
        />
      ) : null}
      {selectionError ? (
        <p role="alert" className="text-sm text-destructive">
          {selectionError}
        </p>
      ) : null}
      {canManage && currentSearch.bulkOperation ? (
        <WorkQueueBulkOperationStatus
          id={currentSearch.bulkOperation}
          onRetryFailed={(items) => {
            setMatchingSelection(null);
            setSelection(retryFailedSelection(filterKey, items));
          }}
        />
      ) : null}
      {canManage && bulkDialogOpen && optionsQuery.data ? (
        <ClientBulkAssignmentDialog
          selection={selectionInput}
          options={optionsQuery.data}
          onClose={() => setBulkDialogOpen(false)}
          onCommitted={(operationId) => {
            setBulkDialogOpen(false);
            setSelection(newBulkSelection(filterKey));
            setMatchingSelection(null);
            updateSearch({ bulkOperation: operationId });
            void queryClient.invalidateQueries({ queryKey: ["clients"] });
          }}
        />
      ) : null}

      {canManage && tagDialogOpen ? (
        <ResourceTagDialog
          selection={
            selectionInput.kind === "ids"
              ? { ...selectionInput, resource: "clients" }
              : selectionInput
          }
          onClose={() => setTagDialogOpen(false)}
          onCommitted={(operationId) => {
            setTagDialogOpen(false);
            setSelection(newBulkSelection(filterKey));
            setMatchingSelection(null);
            updateSearch({ bulkOperation: operationId });
            void queryClient.invalidateQueries({ queryKey: ["clients"] });
          }}
        />
      ) : null}

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

function ClientRow({
  client,
  canManage,
  selected,
  onToggle,
}: {
  client: ClientSummary;
  canManage: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`grid gap-3 px-4 py-4 lg:items-center ${REGISTER_GRID_COLUMNS}`}>
      <div>
        {canManage ? (
          <input
            type="checkbox"
            aria-label={`Select ${client.companyName}`}
            checked={selected}
            onChange={onToggle}
          />
        ) : null}
      </div>
      <div className="min-w-0">
        <p className="truncate font-medium">{client.companyName}</p>
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
