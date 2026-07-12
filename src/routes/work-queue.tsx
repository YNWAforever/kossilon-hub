import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, Check, Clock3, Search, UserRoundPlus } from "lucide-react";
import { TopBar } from "@/components/top-bar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/features/auth/auth-context-neon";
import type { AssignmentRecommendation } from "@/features/work-items/types";
import type { PersistedWorkItem } from "@/features/work-items/repository";
import {
  acknowledgeWorkItemEscalation,
  assignWorkItem,
  listWorkQueue,
  recommendWorkItemAssignees,
} from "@/features/work-items/server-fns";
import { cn } from "@/lib/utils";

type QueueView = "mine" | "team" | "breached";
type SlaFilter = "all" | PersistedWorkItem["escalationState"];
type PriorityFilter = "all" | "high" | "normal";
type StatusFilter = "all" | PersistedWorkItem["status"];

export const Route = createFileRoute("/work-queue")({
  validateSearch: (search: Record<string, unknown>) => ({
    view:
      search.view === "team" || search.view === "breached"
        ? (search.view as QueueView)
        : ("mine" as QueueView),
    owner: typeof search.owner === "string" ? search.owner : "all",
    workType: typeof search.workType === "string" ? search.workType : "all",
    sla:
      search.sla === "none" ||
      search.sla === "warning" ||
      search.sla === "breach" ||
      search.sla === "acknowledged"
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
  }),
  component: WorkQueueRoute,
});

function WorkQueueRoute() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { view, owner, workType, sla, priority, status } = search;
  const [query, setQuery] = useState("");
  const [assignmentItem, setAssignmentItem] = useState<PersistedWorkItem | null>(null);
  const [acknowledgementItem, setAcknowledgementItem] = useState<PersistedWorkItem | null>(null);
  const canManage = session?.role === "Admin" || session?.role === "Manager";
  const filters = {
    view,
    escalationState: view === "breached" ? ("breach" as const) : undefined,
  };
  const queueQuery = useQuery({
    queryKey: ["work-queue", view],
    queryFn: () => listWorkQueue({ data: filters }),
  });
  const items = useMemo(() => queueQuery.data ?? [], [queueQuery.data]);
  const owners = useMemo(
    () => Array.from(new Set(items.flatMap((item) => (item.ownerId ? [item.ownerId] : [])))).sort(),
    [items],
  );
  const workTypes = useMemo(
    () => Array.from(new Set(items.map((item) => item.workType))).sort(),
    [items],
  );
  const visibleItems = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return items.filter((item) => {
      const matchesQuery =
        !needle ||
        `${item.title} ${item.workType} ${item.caseId} ${item.companyId}`
          .toLowerCase()
          .includes(needle);
      const matchesOwner =
        owner === "all" || (owner === "unassigned" ? !item.ownerId : item.ownerId === owner);
      const matchesWorkType = workType === "all" || item.workType === workType;
      const matchesSla = sla === "all" || item.escalationState === sla;
      const matchesPriority =
        priority === "all" || (priority === "high" ? item.priority >= 70 : item.priority < 70);
      const matchesStatus = status === "all" || item.status === status;
      return (
        matchesQuery &&
        matchesOwner &&
        matchesWorkType &&
        matchesSla &&
        matchesPriority &&
        matchesStatus
      );
    });
  }, [items, owner, priority, query, sla, status, workType]);

  const setFilter = (key: "owner" | "workType" | "sla" | "priority" | "status", value: string) =>
    void navigate({ search: { ...search, [key]: value }, replace: true });

  const metrics = {
    dueToday: items.filter((item) => hongKongDateKey(item.slaDueAt) === hongKongDateKey(new Date()))
      .length,
    atRisk: items.filter((item) => item.escalationState === "warning").length,
    breached: items.filter((item) => item.escalationState === "breach").length,
    unassigned: items.filter((item) => !item.ownerId).length,
  };

  return (
    <>
      <TopBar title="Work queue" subtitle="Assignment, capacity, and SLA control" />
      <main className="min-w-0 flex-1 p-4 md:p-6">
        <div className="grid grid-cols-2 border-y border-border md:grid-cols-4">
          <Counter label="Due today" value={metrics.dueToday} />
          <Counter label="At risk" value={metrics.atRisk} tone="warning" />
          <Counter label="Breached" value={metrics.breached} tone="danger" />
          <Counter label="Unassigned" value={metrics.unassigned} />
        </div>

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
                search={{ ...search, view: value }}
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
              onChange={(event) => setQuery(event.target.value)}
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
            {owners.map((ownerId) => (
              <option key={ownerId} value={ownerId}>
                Staff {ownerId.slice(0, 8)}
              </option>
            ))}
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
            <option value="none">On track</option>
            <option value="warning">At risk</option>
            <option value="breach">Breached</option>
            <option value="acknowledged">Acknowledged</option>
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
                    "Due",
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
                {visibleItems.map((item) => (
                  <div
                    key={item.id}
                    role="row"
                    className="grid min-h-20 grid-cols-[1.4fr_110px_110px_110px_140px_90px_100px_110px] items-center gap-3 px-3 py-4 hover:bg-muted/30"
                  >
                    <div role="cell" className="min-w-0">
                      <p className="text-xs text-muted-foreground">
                        Company {item.companyId.slice(0, 8)}
                      </p>
                      <Link
                        to="/annual-returns/$id"
                        params={{ id: item.caseId }}
                        className="font-medium hover:underline"
                      >
                        {item.title}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {item.workType} · Case {item.caseId.slice(0, 8)}
                      </p>
                    </div>
                    <span role="cell">
                      {item.ownerId ? item.ownerId.slice(0, 8) : "Unassigned"}
                    </span>
                    <span role="cell">
                      <SlaPill state={item.escalationState} />
                    </span>
                    <span role="cell">{item.status === "blocked" ? "Blocked" : "None"}</span>
                    <span role="cell">{formatDateTime(item.slaDueAt)}</span>
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
              {visibleItems.map((item) => (
                <article key={item.id} className="grid gap-3 px-3 py-4">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      Company {item.companyId.slice(0, 8)}
                    </p>
                    <Link
                      to="/annual-returns/$id"
                      params={{ id: item.caseId }}
                      className="font-medium hover:underline"
                    >
                      {item.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {item.workType} · Case {item.caseId.slice(0, 8)}
                    </p>
                  </div>
                  <QueueField label="Owner">
                    {item.ownerId ? item.ownerId.slice(0, 8) : "Unassigned"}
                  </QueueField>
                  <QueueField label="SLA">
                    <SlaPill state={item.escalationState} />
                  </QueueField>
                  <QueueField label="Blocker">
                    {item.status === "blocked" ? "Blocked" : "None"}
                  </QueueField>
                  <QueueField label="Due">{formatDateTime(item.slaDueAt)}</QueueField>
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
          </section>
        ) : null}
      </main>
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
        <span className="block text-sm font-medium">Staff {option.userId.slice(0, 8)}</span>
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

function SlaPill({ state }: { state: PersistedWorkItem["escalationState"] }) {
  const icon =
    state === "breach" ? (
      <AlertTriangle className="h-3.5 w-3.5" />
    ) : (
      <Clock3 className="h-3.5 w-3.5" />
    );
  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium capitalize",
        state === "breach" && "border-destructive/40 bg-destructive/10 text-destructive",
        state === "warning" && "border-amber-300 bg-amber-50 text-amber-800",
      )}
    >
      {icon}
      {state}
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
