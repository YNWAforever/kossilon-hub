import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, Check, Clock3, Search, UserRoundPlus } from "lucide-react";
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
import {
  WorkQueueBulkAssignmentDialog,
  WorkQueueBulkOperationStatus,
} from "@/features/bulk-operations/work-queue-bulk-controls";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/features/auth/auth-context-neon";
import { workQueuePersonLabel, type AssignmentRecommendation } from "@/features/work-items/types";
import { deriveSlaDisplay, type SlaDisplay, type SlaDisplayState } from "@/features/work-items/sla";
import type { PersistedWorkItem } from "@/features/work-items/repository";
import { filterWorkQueueDisplay } from "@/features/work-items/queue-display-filters";
import {
  acknowledgeWorkItemEscalation,
  assignWorkItem,
  listWorkQueue,
  recommendWorkItemAssignees,
  workQueueLastSlaEvaluation,
} from "@/features/work-items/server-fns";
import { cn } from "@/lib/utils";

const QUEUE_PAGE_SIZE = 50;
type QueueView = "mine" | "team" | "breached";
type SlaFilter = "all" | SlaDisplayState;
type PriorityFilter = "all" | "high" | "normal";
type StatusFilter = "all" | "open" | "in_progress" | "blocked";

type CaseDetailLink =
  | { to: "/annual-returns/$id"; params: { id: string } }
  | { to: "/corporate-changes/$id"; params: { id: string } };

export function caseDetailLinkFor(item: PersistedWorkItem): CaseDetailLink | null {
  switch (item.caseType) {
    case "annual_return":
      return item.annualReturnCaseId
        ? { to: "/annual-returns/$id", params: { id: item.annualReturnCaseId } }
        : null;
    case "corporate_change_request":
      return item.corporateChangeRequestId
        ? { to: "/corporate-changes/$id", params: { id: item.corporateChangeRequestId } }
        : null;
    default: {
      const exhaustive: never = item.caseType;
      throw new Error(`Unhandled work item case type: ${exhaustive}`);
    }
  }
}

export const Route = createFileRoute("/work-queue")({
  validateSearch: (search: Record<string, unknown>) => ({
    view:
      search.view === "team" || search.view === "breached"
        ? (search.view as QueueView)
        : ("mine" as QueueView),
    owner: typeof search.owner === "string" ? search.owner : "all",
    q: typeof search.q === "string" ? search.q.slice(0, 200) : "",
    workType: typeof search.workType === "string" ? search.workType : "all",
    sla:
      search.sla === "none"
        ? ("on-track" as SlaFilter)
        : search.sla === "warning"
          ? ("at-risk" as SlaFilter)
          : search.sla === "breach"
            ? ("breached" as SlaFilter)
            : search.sla === "not-configured" ||
                search.sla === "not-started" ||
                search.sla === "on-track" ||
                search.sla === "at-risk" ||
                search.sla === "breached" ||
                search.sla === "acknowledged" ||
                search.sla === "unavailable"
              ? (search.sla as SlaFilter)
              : ("all" as SlaFilter),
    priority:
      search.priority === "high" || search.priority === "normal"
        ? (search.priority as PriorityFilter)
        : ("all" as PriorityFilter),
    status:
      search.status === "open" || search.status === "in_progress" || search.status === "blocked"
        ? (search.status as StatusFilter)
        : ("all" as StatusFilter),
    page:
      typeof search.page === "number" && Number.isSafeInteger(search.page) && search.page > 0
        ? search.page
        : 1,
    ...(typeof search.bulkOperation === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(search.bulkOperation)
      ? { bulkOperation: search.bulkOperation }
      : {}),
  }),
  component: WorkQueueRoute,
});

function WorkQueueRoute() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { view, owner, workType, sla, priority, status, q: query, page: requestedPage } = search;
  const [assignmentItem, setAssignmentItem] = useState<PersistedWorkItem | null>(null);
  const [acknowledgementItem, setAcknowledgementItem] = useState<PersistedWorkItem | null>(null);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const filterKey = JSON.stringify([
    view,
    owner,
    workType,
    sla,
    priority,
    status,
    query.trim().toLowerCase(),
  ]);
  const [selection, setSelection] = useState(() => newBulkSelection(filterKey));
  const [matchingSelection, setMatchingSelection] = useState<{
    filterKey: string;
    excludedIds: string[];
  } | null>(null);
  const currentMatching = matchingSelection?.filterKey === filterKey ? matchingSelection : null;
  const currentSelection =
    selection.filterKey === filterKey ? selection : changeSelectionFilter(selection, filterKey);
  const selectedIds = useMemo(() => new Set(currentSelection.ids), [currentSelection.ids]);
  useEffect(() => {
    setSelection((previous) => changeSelectionFilter(previous, filterKey));
    setSelectionError(null);
    setBulkDialogOpen(false);
    setMatchingSelection(null);
  }, [filterKey]);
  const canManage = session?.role === "Admin" || session?.role === "Manager";
  const filters = { view };
  const queueQuery = useQuery({
    queryKey: ["work-queue", view],
    queryFn: () => listWorkQueue({ data: filters }),
  });
  const evaluationQuery = useQuery({
    queryKey: ["work-queue", "last-sla-evaluation"],
    queryFn: () => workQueueLastSlaEvaluation(),
    retry: false,
  });
  const items = useMemo(() => queueQuery.data ?? [], [queueQuery.data]);
  const [asOf, setAsOf] = useState(() => new Date().toISOString());
  useEffect(() => {
    const interval = setInterval(() => setAsOf(new Date().toISOString()), 60_000);
    return () => clearInterval(interval);
  }, []);
  const displayFor = useCallback(
    (item: PersistedWorkItem): SlaDisplay =>
      deriveSlaDisplay(
        {
          status: item.status,
          escalationState: item.escalationState,
          workDueAt: item.workDueAt ?? null,
          slaPolicyVersionId: item.slaPolicyVersionId,
          slaStartedAt: item.slaStartedAt,
          slaWarningAt: item.slaWarningAt,
          slaDueAt: item.slaDueAt,
          slaBreachedAt: item.slaBreachedAt,
          evaluatedAt: evaluationQuery.data ?? null,
        },
        asOf,
      ),
    [asOf, evaluationQuery.data],
  );
  const owners = useMemo(
    () => Array.from(new Set(items.flatMap((item) => (item.ownerId ? [item.ownerId] : [])))).sort(),
    [items],
  );
  const workTypes = useMemo(
    () => Array.from(new Set(items.map((item) => item.workType))).sort(),
    [items],
  );
  const visibleItems = useMemo(
    () =>
      filterWorkQueueDisplay(
        items,
        { view, owner, workType, sla, priority, status, q: query },
        (item) => displayFor(item).state,
      ),
    [items, owner, priority, query, sla, status, workType, view, displayFor],
  );

  const pageCount = Math.max(1, Math.ceil(visibleItems.length / QUEUE_PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const pageItems = visibleItems.slice((page - 1) * QUEUE_PAGE_SIZE, page * QUEUE_PAGE_SIZE);

  const setFilter = (key: "owner" | "workType" | "sla" | "priority" | "status", value: string) =>
    void navigate({ search: { ...search, [key]: value, page: 1 }, replace: true });

  function addSelected(ids: string[]) {
    try {
      setSelection(addPageToSelection(currentSelection, ids));
      setSelectionError(null);
    } catch (error) {
      setSelectionError(error instanceof Error ? error.message : "Selection unavailable.");
    }
  }
  function toggleSelected(id: string, checked: boolean) {
    if (currentMatching) {
      setMatchingSelection({
        ...currentMatching,
        excludedIds: checked
          ? currentMatching.excludedIds.filter((excluded) => excluded !== id)
          : [...new Set([...currentMatching.excludedIds, id])],
      });
      return;
    }
    if (checked) addSelected([id]);
    else setSelection(removeFromSelection(currentSelection, id));
  }
  const representativeItem = currentMatching
    ? visibleItems.find((item) => !currentMatching.excludedIds.includes(item.id))
    : items.find((item) => selectedIds.has(item.id));

  const metrics = {
    dueToday: items.filter((item) => hongKongDateKey(item.slaDueAt) === hongKongDateKey(asOf))
      .length,
    atRisk: items.filter((item) => displayFor(item).state === "at-risk").length,
    breached: items.filter((item) => displayFor(item).state === "breached").length,
    unassigned: items.filter((item) => !item.ownerId).length,
  };

  return (
    <>
      <main className="min-w-0 flex-1 p-4 md:p-6">
        <PageHeader
          eyebrow="Operations"
          title="Work queue"
          subtitle="Assignment, capacity, and SLA control"
        />
        <p role="status" className="mt-3 text-xs text-muted-foreground">
          Last successful scheduled SLA evaluation:{" "}
          {evaluationQuery.isError
            ? "Unavailable"
            : evaluationQuery.isPending
              ? "Loading…"
              : evaluationQuery.data
                ? formatDateTime(evaluationQuery.data)
                : "No run recorded"}
          . Statuses below also compare deadlines with the current time.
        </p>
        {!queueQuery.isPending && !queueQuery.isError ? (
          <div className="mt-5 grid grid-cols-2 border-y border-border md:grid-cols-4">
            <Counter label="SLA due today" value={metrics.dueToday} />
            <Counter label="At risk" value={metrics.atRisk} tone="warning" />
            <Counter label="Breached" value={metrics.breached} tone="danger" />
            <Counter label="Unassigned" value={metrics.unassigned} />
          </div>
        ) : null}

        <div className="mt-5 flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-center lg:justify-between">
          <nav aria-label="Queue views" className="flex min-w-0 gap-1">
            {(
              [
                ["mine", "My work"],
                ["team", "Team queue"],
                ["breached", "Breached"],
              ] as const
            ).map(([value, label]) => (
              <Link
                key={value}
                to="/work-queue"
                search={{ ...search, view: value, page: 1 }}
                className={cn(
                  "min-h-9 border-b-2 px-3 py-2 text-sm font-medium",
                  view === value
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </Link>
            ))}
          </nav>
          <label className="relative block w-full lg:w-80">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <span className="sr-only">Search work queue</span>
            <input
              value={query}
              onChange={(event) => {
                void navigate({
                  search: { ...search, q: event.target.value.slice(0, 200), page: 1 },
                  replace: true,
                });
              }}
              placeholder="Search case or work type"
              className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
            />
          </label>
        </div>

        <div className="grid gap-2 border-b border-border py-3 sm:grid-cols-2 xl:grid-cols-5">
          <FilterSelect
            label="Filter by owner"
            value={owner}
            onChange={(value) => setFilter("owner", value)}
          >
            <option value="all">All owners</option>
            <option value="unassigned">Unassigned</option>
            {owners.map((ownerId) => {
              const item = items.find((entry) => entry.ownerId === ownerId);
              return (
                <option key={ownerId} value={ownerId} title={ownerId}>
                  {item?.ownerPerson
                    ? workQueuePersonLabel(item.ownerPerson)
                    : `${item?.ownerName ?? "Staff record unavailable"} · Profile unavailable`}
                </option>
              );
            })}
          </FilterSelect>
          <FilterSelect
            label="Filter by work type"
            value={workType}
            onChange={(value) => setFilter("workType", value)}
          >
            <option value="all">All work types</option>
            {workTypes.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Filter by SLA state"
            value={sla}
            onChange={(value) => setFilter("sla", value)}
          >
            <option value="all">All SLA states</option>
            <option value="not-configured">Not configured</option>
            <option value="not-started">Not started</option>
            <option value="on-track">On track</option>
            <option value="at-risk">At risk</option>
            <option value="breached">Breached</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="unavailable">Unavailable</option>
          </FilterSelect>
          <FilterSelect
            label="Filter by priority"
            value={priority}
            onChange={(value) => setFilter("priority", value)}
          >
            <option value="all">All priorities</option>
            <option value="high">High (70+)</option>
            <option value="normal">Normal</option>
          </FilterSelect>
          <FilterSelect
            label="Filter by case status"
            value={status}
            onChange={(value) => setFilter("status", value)}
          >
            <option value="all">All case statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In progress</option>
            <option value="blocked">Blocked</option>
          </FilterSelect>
        </div>

        {canManage ? (
          <>
            <BulkSelectionToolbar
              selectedCount={
                currentMatching
                  ? visibleItems.length - currentMatching.excludedIds.length
                  : currentSelection.ids.length
              }
              visibleCount={pageItems.length}
              notice={currentSelection.notice}
              selectionLabel={
                currentMatching
                  ? `All matching filter (${visibleItems.length - currentMatching.excludedIds.length} shown; server preview required)`
                  : undefined
              }
              previewEnabled={
                currentMatching
                  ? visibleItems.length > currentMatching.excludedIds.length
                  : undefined
              }
              onSelectVisible={() => {
                setMatchingSelection(null);
                addSelected(pageItems.map((item) => item.id));
              }}
              onSelectMatching={() => {
                if (visibleItems.length > 1000) {
                  setSelectionError("Selection exceeds the 1000-item preview limit.");
                  return;
                }
                setSelection(clearBulkSelection(currentSelection));
                setMatchingSelection({ filterKey, excludedIds: [] });
                setSelectionError(null);
              }}
              onClear={() => {
                setSelection(clearBulkSelection(currentSelection));
                setMatchingSelection(null);
                setSelectionError(null);
              }}
              onPreview={() => {
                if (!representativeItem) {
                  setSelectionError(
                    "Selected work items are no longer available in this view. Refresh or clear selection.",
                  );
                  return;
                }
                setBulkDialogOpen(true);
              }}
            />
            {selectionError ? (
              <p role="alert" className="mt-2 text-xs text-destructive">
                {selectionError}
              </p>
            ) : null}
            {search.bulkOperation ? (
              <WorkQueueBulkOperationStatus
                id={search.bulkOperation}
                onRetryFailed={(results) => {
                  try {
                    setSelection(retryFailedSelection(filterKey, results));
                    setMatchingSelection(null);
                    setSelectionError(null);
                  } catch (error) {
                    setSelectionError(
                      error instanceof Error ? error.message : "Retry selection unavailable.",
                    );
                  }
                }}
              />
            ) : null}
          </>
        ) : null}

        {queueQuery.isLoading ? <QueueMessage>Loading work queue...</QueueMessage> : null}
        {queueQuery.isError ? (
          <QueueMessage>Work queue could not be loaded. Refresh to try again.</QueueMessage>
        ) : null}
        {!queueQuery.isLoading && !queueQuery.isError && visibleItems.length === 0 ? (
          <QueueMessage>No work items match this view.</QueueMessage>
        ) : null}

        {visibleItems.length > 0 ? (
          <section aria-label="Work items" className="mt-1">
            <div role="table" aria-label="Work queue" className="hidden lg:block">
              <div role="rowgroup">
                <div
                  role="row"
                  className="grid grid-cols-[1.4fr_110px_110px_110px_140px_90px_100px_110px] gap-3 border-b border-border px-3 py-3 text-xs font-medium uppercase text-muted-foreground"
                >
                  {[
                    "Company / work item",
                    "Owner",
                    "SLA",
                    "Blocker",
                    "Due dates",
                    "Priority",
                    "Status",
                    "Actions",
                  ].map((label) => (
                    <span key={label} role="columnheader">
                      {label}
                    </span>
                  ))}
                </div>
              </div>
              <div role="rowgroup" className="divide-y divide-border">
                {pageItems.map((item) => (
                  <div
                    key={item.id}
                    role="row"
                    className="grid min-h-20 grid-cols-[1.4fr_110px_110px_110px_140px_90px_100px_110px] items-center gap-3 px-3 py-4 hover:bg-muted/30"
                  >
                    <div role="cell" className="min-w-0">
                      {canManage ? (
                        <input
                          type="checkbox"
                          aria-label={`Select ${item.title}`}
                          checked={
                            currentMatching
                              ? !currentMatching.excludedIds.includes(item.id)
                              : selectedIds.has(item.id)
                          }
                          onChange={(event) => toggleSelected(item.id, event.target.checked)}
                          className="mr-2"
                        />
                      ) : null}
                      {/* Was `Company {item.companyId.slice(0, 8)}` -- a raw uuid
                          prefix where the company name belongs, on the screen
                          staff are supposed to work from. */}
                      <p className="truncate text-xs text-muted-foreground">
                        {item.companyName ?? "Company no longer on file"}
                      </p>
                      {caseDetailLinkFor(item) ? (
                        <Link
                          to={caseDetailLinkFor(item)!.to}
                          params={caseDetailLinkFor(item)!.params}
                          className="font-medium hover:underline"
                        >
                          {item.title}
                        </Link>
                      ) : (
                        <p className="font-medium">{item.title}</p>
                      )}
                      <p className="truncate text-xs text-muted-foreground">
                        {item.workType}
                        {item.annualReturnCaseId
                          ? ` · Case ${item.annualReturnCaseId.slice(0, 8)}`
                          : ""}
                      </p>
                    </div>
                    <WorkQueueOwnerDisplay item={item} variant="desktop" />
                    <span role="cell">
                      <SlaPill state={displayFor(item).state} />
                    </span>
                    <span role="cell">{item.status === "blocked" ? "Blocked" : "None"}</span>
                    <span role="cell" className="text-xs">
                      {dueDatesLabel(item)}
                    </span>
                    <span role="cell" className="tabular-nums">
                      {item.priority}
                    </span>
                    <span role="cell" className="capitalize">
                      {item.status.replace("_", " ")}
                    </span>
                    <span role="cell">
                      <QueueActions
                        item={item}
                        canManage={canManage}
                        onAssign={setAssignmentItem}
                        onAcknowledge={setAcknowledgementItem}
                      />
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="divide-y divide-border lg:hidden">
              {pageItems.map((item) => (
                <article key={item.id} className="grid gap-3 px-3 py-4">
                  <div>
                    {canManage ? (
                      <input
                        type="checkbox"
                        aria-label={`Select ${item.title}`}
                        checked={
                          currentMatching
                            ? !currentMatching.excludedIds.includes(item.id)
                            : selectedIds.has(item.id)
                        }
                        onChange={(event) => toggleSelected(item.id, event.target.checked)}
                        className="mr-2"
                      />
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {item.companyName ?? "Company no longer on file"}
                    </p>
                    {caseDetailLinkFor(item) ? (
                      <Link
                        to={caseDetailLinkFor(item)!.to}
                        params={caseDetailLinkFor(item)!.params}
                        className="font-medium hover:underline"
                      >
                        {item.title}
                      </Link>
                    ) : (
                      <p className="font-medium">{item.title}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {item.workType}
                      {item.annualReturnCaseId
                        ? ` · Case ${item.annualReturnCaseId.slice(0, 8)}`
                        : ""}
                    </p>
                  </div>
                  <WorkQueueOwnerDisplay item={item} variant="mobile" />
                  <QueueField label="SLA">
                    <SlaPill state={displayFor(item).state} />
                  </QueueField>
                  <QueueField label="Blocker">
                    {item.status === "blocked" ? "Blocked" : "None"}
                  </QueueField>
                  <QueueField label="Due dates">{dueDatesLabel(item)}</QueueField>
                  <QueueField label="Priority">{item.priority}</QueueField>
                  <QueueActions
                    item={item}
                    canManage={canManage}
                    onAssign={setAssignmentItem}
                    onAcknowledge={setAcknowledgementItem}
                  />
                </article>
              ))}
            </div>
            {pageCount > 1 ? (
              <nav
                aria-label="Work queue pages"
                className="flex items-center justify-between gap-2 border-t border-border px-3 py-3 text-sm"
              >
                <span>
                  Page {page} of {pageCount} · {visibleItems.length} matching
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page === 1}
                    onClick={() =>
                      void navigate({ search: { ...search, page: page - 1 }, replace: true })
                    }
                    className="rounded-md border border-border px-3 py-1 disabled:opacity-50"
                  >
                    Previous page
                  </button>
                  <button
                    type="button"
                    disabled={page === pageCount}
                    onClick={() =>
                      void navigate({ search: { ...search, page: page + 1 }, replace: true })
                    }
                    className="rounded-md border border-border px-3 py-1 disabled:opacity-50"
                  >
                    Next page
                  </button>
                </div>
              </nav>
            ) : null}
          </section>
        ) : null}
      </main>
      {bulkDialogOpen &&
      representativeItem &&
      (currentMatching || currentSelection.ids.length > 0) ? (
        <WorkQueueBulkAssignmentDialog
          selection={
            currentMatching
              ? {
                  kind: "filter",
                  resource: "work-items",
                  filters: { view, owner, workType, sla, priority, status, q: query },
                  excludedIds: currentMatching.excludedIds,
                }
              : { kind: "ids", ids: currentSelection.ids }
          }
          selectedCount={
            currentMatching
              ? visibleItems.length - currentMatching.excludedIds.length
              : currentSelection.ids.length
          }
          representativeItem={representativeItem}
          selectedItems={
            currentMatching
              ? visibleItems.filter((item) => !currentMatching.excludedIds.includes(item.id))
              : items.filter((item) => selectedIds.has(item.id))
          }
          onClose={() => setBulkDialogOpen(false)}
          onCommitted={(operationId) => {
            setBulkDialogOpen(false);
            setSelection(newBulkSelection(filterKey));
            setMatchingSelection(null);
            void navigate({ search: { ...search, bulkOperation: operationId }, replace: true });
            void queryClient.invalidateQueries({ queryKey: ["work-queue"] });
          }}
        />
      ) : null}
      {assignmentItem ? (
        <AssignmentDialog
          item={assignmentItem}
          onClose={() => setAssignmentItem(null)}
          onAssigned={() => {
            setAssignmentItem(null);
            void queryClient.invalidateQueries({ queryKey: ["work-queue"] });
          }}
        />
      ) : null}
      {acknowledgementItem ? (
        <AcknowledgementDialog
          item={acknowledgementItem}
          onClose={() => setAcknowledgementItem(null)}
          onAcknowledged={() => {
            setAcknowledgementItem(null);
            void queryClient.invalidateQueries({ queryKey: ["work-queue"] });
          }}
        />
      ) : null}
    </>
  );
}

function AssignmentDialog({
  item,
  onClose,
  onAssigned,
}: {
  item: PersistedWorkItem;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [selected, setSelected] = useState("");
  const [reason, setReason] = useState("");
  const recommendations = useQuery({
    queryKey: ["work-item-recommendations", item.id],
    queryFn: () => recommendWorkItemAssignees({ data: { workItemId: item.id } }),
  });
  const assign = useMutation({
    mutationFn: () =>
      assignWorkItem({
        data: {
          workItemId: item.id,
          assigneeId: selected,
          expectedVersion: item.version,
          assignmentTarget: "owner",
          overrideReason: reason.trim() || undefined,
        },
      }),
    onSuccess: onAssigned,
  });
  const options = recommendations.data ?? [];
  const selectedRecommendation = options.find((option) => option.userId === selected);
  const requiresReason = Boolean(
    selectedRecommendation &&
    (selectedRecommendation.rank !== 1 ||
      selectedRecommendation.factors.capacityUtilization >= 100),
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl gap-0 p-0">
        <div className="border-b border-border px-5 py-4">
          <DialogHeader>
            <DialogTitle>Assign work item</DialogTitle>
            <DialogDescription>{item.title}</DialogDescription>
          </DialogHeader>
        </div>
        <div className="max-h-[55vh] space-y-2 overflow-y-auto p-5">
          {recommendations.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading recommendations...</p>
          ) : null}
          {options.map((option) => (
            <RecommendationOption
              key={option.userId}
              option={option}
              selected={selected === option.userId}
              onSelect={() => setSelected(option.userId)}
            />
          ))}
          {requiresReason ? (
            <textarea
              aria-label="Override reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Reason for override or capacity exception"
              className="mt-3 min-h-20 w-full rounded-md border border-input bg-background p-3 text-sm"
            />
          ) : null}
          {assign.isError ? (
            <p className="text-sm text-destructive">
              Assignment could not be saved. Refresh and try again.
            </p>
          ) : null}
        </div>
        <DialogFooter className="border-t border-border px-5 py-4">
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">
            Cancel
          </button>
          <button
            disabled={!selected || (requiresReason && !reason.trim()) || assign.isPending}
            onClick={() => assign.mutate()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Confirm assignment
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AcknowledgementDialog({
  item,
  onClose,
  onAcknowledged,
}: {
  item: PersistedWorkItem;
  onClose: () => void;
  onAcknowledged: () => void;
}) {
  const [note, setNote] = useState("");
  const acknowledge = useMutation({
    mutationFn: () =>
      acknowledgeWorkItemEscalation({
        data: { workItemId: item.id, note: note.trim() },
      }),
    onSuccess: onAcknowledged,
  });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Acknowledge escalation</DialogTitle>
          <DialogDescription>
            Record what was reviewed and the next action for {item.title}.
          </DialogDescription>
        </DialogHeader>
        <textarea
          autoFocus
          aria-label="Acknowledgement note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Review outcome and next action"
          className="min-h-24 w-full rounded-md border border-input bg-background p-3 text-sm"
        />
        {acknowledge.isError ? (
          <p className="text-sm text-destructive">Acknowledgement could not be saved.</p>
        ) : null}
        <DialogFooter>
          <button onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm">
            Cancel
          </button>
          <button
            disabled={!note.trim() || acknowledge.isPending}
            onClick={() => acknowledge.mutate()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Acknowledge
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecommendationOption({
  option,
  selected,
  onSelect,
}: {
  option: AssignmentRecommendation;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "grid w-full grid-cols-[36px_1fr_auto] items-center gap-3 rounded-md border p-3 text-left",
        selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40",
      )}
    >
      <span className="font-semibold tabular-nums">#{option.rank}</span>
      <span>
        <span className="block text-sm font-medium" title={option.userId}>
          {option.person ? workQueuePersonLabel(option.person) : "Staff record unavailable"}
        </span>
        <span className="mt-1 block text-xs text-muted-foreground">
          Skill {option.factors.skillProficiency}/5 · Load {option.factors.capacityUtilization}%
        </span>
      </span>
      <span className="text-sm font-semibold tabular-nums">{option.score}</span>
    </button>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
    >
      {children}
    </select>
  );
}

function QueueActions({
  item,
  canManage,
  onAssign,
  onAcknowledge,
}: {
  item: PersistedWorkItem;
  canManage: boolean;
  onAssign: (item: PersistedWorkItem) => void;
  onAcknowledge: (item: PersistedWorkItem) => void;
}) {
  return (
    <div className="flex justify-end gap-2">
      {canManage ? (
        <button
          title="Assign work item"
          onClick={() => onAssign(item)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-muted"
        >
          <UserRoundPlus className="h-4 w-4" />
        </button>
      ) : null}
      {canManage && (item.escalationState === "warning" || item.escalationState === "breach") ? (
        <button
          title="Acknowledge escalation"
          onClick={() => onAcknowledge(item)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-muted"
        >
          <Check className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}

function Counter({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "warning" | "danger";
}) {
  return (
    <div className="min-h-20 border-r border-border px-4 py-4 last:border-r-0">
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-2 text-2xl font-semibold tabular-nums",
          tone === "danger" && "text-destructive",
          tone === "warning" && "text-amber-700",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function QueueField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm lg:block">
      <span className="text-xs text-muted-foreground lg:hidden">{label}</span>
      <span>{children}</span>
    </div>
  );
}

function SlaPill({ state }: { state: SlaDisplayState }) {
  const icon =
    state === "breached" ? (
      <AlertTriangle className="h-3.5 w-3.5" />
    ) : (
      <Clock3 className="h-3.5 w-3.5" />
    );
  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium capitalize",
        state === "breached" && "border-destructive/40 bg-destructive/10 text-destructive",
        state === "at-risk" && "border-amber-300 bg-amber-50 text-amber-800",
      )}
    >
      {icon}
      {slaStateLabel(state)}
    </span>
  );
}

function QueueMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="border-b border-border px-3 py-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-HK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Hong_Kong",
  }).format(new Date(value));
}

function hongKongDateKey(value: string | Date): string {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function WorkQueueOwnerDisplay({
  item,
  variant,
}: {
  item: PersistedWorkItem;
  variant: "desktop" | "mobile";
}) {
  const label = queueOwnerLabel(item);
  return variant === "desktop" ? (
    <span role="cell" className="truncate" title={item.ownerId ?? undefined}>
      {label}
    </span>
  ) : (
    <QueueField label="Owner">
      <span title={item.ownerId ?? undefined}>{label}</span>
    </QueueField>
  );
}

function queueOwnerLabel(item: PersistedWorkItem): string {
  if (!item.ownerId) return "Unassigned";
  return item.ownerPerson
    ? workQueuePersonLabel(item.ownerPerson)
    : `${item.ownerName ?? "Staff record unavailable"} · Profile unavailable`;
}

function dueDatesLabel(item: PersistedWorkItem): string {
  return `Work: ${item.workDueAt ? formatDateTime(item.workDueAt) : "not set"} · SLA: ${item.slaDueAt ? formatDateTime(item.slaDueAt) : "not available"}`;
}

function slaStateLabel(state: SlaDisplayState): string {
  switch (state) {
    case "not-configured":
      return "未設定";
    case "not-started":
      return "未開始";
    case "on-track":
      return "正常";
    case "at-risk":
      return "接近截止";
    case "breached":
      return "已逾期";
    case "acknowledged":
      return "已確認";
    case "unavailable":
      return "無法確認";
  }
}
