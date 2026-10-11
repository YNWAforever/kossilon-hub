import { useEffect, useMemo, useState } from "react";
import { queueSearch, safeListReturnTo } from "@/lib/list-navigation";
import { useRetainedPage } from "@/lib/use-retained-page";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, type SearchSchemaInput } from "@tanstack/react-router";
import { AlertTriangle, Check, Clock3, Search, UserRoundPlus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { BulkSelectionToolbar } from "@/components/bulk-selection-toolbar";
import type { BulkFilters } from "@/features/bulk-operations/types";
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
import {
  assignmentLabels,
  activeAssignmentOptions,
  type AssignmentOption,
} from "@/features/work-items/assignment-labels";
import type { WorkQueueSummary as PersistedWorkItem } from "@/features/work-items/queue-page";
import {
  acknowledgeWorkItemEscalation,
  assignWorkItem,
  listWorkQueuePage,
  listWorkQueueFilterOptions,
  recommendWorkItemAssignees,
} from "@/features/work-items/server-fns";
import { cn } from "@/lib/utils";

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
  validateSearch: (input: SearchSchemaInput & Record<string, unknown>) => queueSearch(input),
  component: WorkQueueRoute,
});

export function WorkQueueRoute() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const { actor, dataMode } = Route.useRouteContext();
  const actorScope = JSON.stringify(
    actor ? [actor.authUserId, actor.userId, actor.role, actor.teamId, actor.active] : null,
  );
  const navigate = Route.useNavigate();
  const {
    view,
    owner,
    workType,
    sla,
    priority,
    status,
    q: query = "",
    sort = "sla",
    cursor,
    anchor,
  } = search;
  const [assignmentItem, setAssignmentItem] = useState<PersistedWorkItem | null>(null);
  const [acknowledgementItem, setAcknowledgementItem] = useState<PersistedWorkItem | null>(null);
  const canManage = session?.role === "Admin" || session?.role === "Manager";
  const filters = {
    view,
    q: query,
    sort,
    limit: 50,
    ...(owner === "unassigned" ? { unassigned: true } : owner !== "all" ? { ownerId: owner } : {}),
    ...(workType !== "all" ? { workType } : {}),
    ...(sla !== "all" ? { escalationState: sla } : {}),
    ...(priority !== "all" ? { priority } : {}),
    ...(status !== "all" ? { workStatus: status } : {}),
    ...(view === "breached" ? { escalationState: "breach" as const } : {}),
  };
  const queueQuery = useQuery({
    queryKey: ["work-queue", actorScope, filters, cursor],
    queryFn: () => listWorkQueuePage({ data: { ...filters, cursor } }),
    retry: false,
  });
  const page = useRetainedPage(JSON.stringify([actorScope, filters]), queueQuery.data);
  const items = useMemo(() => page?.items ?? [], [page]);
  const visibleItems = items;
  const bulkFilters: BulkFilters = {
    view,
    activeOnly: true,
    ...(query.trim() ? { q: query.trim() } : {}),
    ...(owner === "unassigned" ? { unassigned: true } : owner !== "all" ? { ownerId: owner } : {}),
    ...(workType !== "all" ? { workType } : {}),
    ...(sla !== "all" ? { escalationState: sla } : {}),
    ...(priority !== "all" ? { priority } : {}),
    ...(status !== "all" ? { workStatus: status } : {}),
  };
  const pageItems = items;
  const setFilter = (
    key: "owner" | "workType" | "sla" | "priority" | "status" | "sort",
    value: string,
  ) =>
    void navigate({
      search: { ...search, [key]: value, cursor: undefined, anchor: undefined },
      replace: true,
    });
  const metrics = page?.metrics ?? { dueToday: 0, atRisk: 0, breached: 0, unassigned: 0 };
  const returnTo = (id: string) =>
    safeListReturnTo(
      "/work-queue?" +
        new URLSearchParams(
          Object.fromEntries(
            Object.entries({ ...search, anchor: id }).filter(([, v]) => typeof v === "string"),
          ) as Record<string, string>,
        ).toString(),
    );
  useEffect(() => {
    if (anchor && !queueQuery.isFetching) {
      document.querySelectorAll<HTMLElement>('[data-work-id="' + anchor + '"]').forEach((row) => {
        if (row.offsetParent) row.scrollIntoView({ block: "center" });
      });
    }
  }, [anchor, queueQuery.isFetching, page]);

  return (
    <>
      <main className="min-w-0 flex-1 p-4 md:p-6">
        <PageHeader
          eyebrow="Operations"
          title="Work queue"
          subtitle="Assignment, capacity, and SLA control"
        />
        <div className="mt-5 grid grid-cols-2 border-y border-border md:grid-cols-4">
          <Counter label="Due today" value={metrics.dueToday} />
          <Counter label="At risk" value={metrics.atRisk} tone="warning" />
          <Counter label="Breached" value={metrics.breached} tone="danger" />
          <Counter label="Unassigned" value={metrics.unassigned} />
        </div>

        <div className="mt-5 flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-center lg:justify-between">
          {anchor &&
          page &&
          !queueQuery.isFetching &&
          !queueQuery.isError &&
          !items.some((item) => item.id === anchor) ? (
            <p role="status">原工作已離開此清單，請重新選擇。</p>
          ) : null}
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
                search={{
                  ...search,
                  view: value,
                  ...(value === "mine" ? { owner: "all" } : {}),
                  cursor: undefined,
                  anchor: undefined,
                }}
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
              onChange={(event) =>
                void navigate({
                  search: {
                    ...search,
                    q: event.target.value,
                    cursor: undefined,
                    anchor: undefined,
                  },
                  replace: true,
                })
              }
              placeholder="Search case or work type"
              className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
            />
          </label>
        </div>

        <div className="grid gap-2 border-b border-border py-3 sm:grid-cols-2 xl:grid-cols-5">
          <QueueFacetSelect
            key={actorScope + view + "owner"}
            actorScope={actorScope}
            view={view}
            kind="owner"
            label="Filter by owner"
            value={owner}
            onChange={(value) => setFilter("owner", value)}
          />
          <QueueFacetSelect
            key={actorScope + view + "workType"}
            actorScope={actorScope}
            view={view}
            kind="workType"
            label="Filter by work type"
            value={workType}
            onChange={(value) => setFilter("workType", value)}
          />
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
        <p aria-live="polite" className="my-3 text-sm">
          已載入{pageItems.length}項／共{page?.total ?? "待載入"}項
        </p>
        {anchor && !queueQuery.isFetching && !items.some((i) => i.id === anchor) ? (
          <p role="status">原工作已更新或移出目前範圍；查詢已保留。</p>
        ) : null}
        <label>
          排序
          <select
            aria-label="工作排序"
            value={sort}
            onChange={(e) => setFilter("sort", e.target.value)}
          >
            <option value="sla">SLA 到期</option>
            <option value="recent">最近更新</option>
          </select>
        </label>
        {dataMode === "production" &&
        actor?.active &&
        (actor.role === "Admin" || actor.role === "Manager") ? (
          <BulkSelectionToolbar
            actorScope={actorScope}
            resource="work_item"
            filters={bulkFilters}
            page={pageItems.map((i) => ({
              id: i.id,
              label: `${i.companyName ?? "Company unavailable"} · ${i.title}`,
            }))}
            total={queueQuery.isError || !page ? null : page.total}
          />
        ) : null}
        {queueQuery.isError ? (
          <QueueMessage>
            工作頁面未能載入；已載入的資料保留。
            <button onClick={() => void queueQuery.refetch()}>重試目前頁面</button>
            <button
              onClick={() =>
                void navigate({ search: { ...search, cursor: undefined, anchor: undefined } })
              }
            >
              返回第一頁
            </button>
          </QueueMessage>
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
                    "業務 blocker",
                    "SLA 到期 / 法定日",
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
                    data-work-id={item.id}
                    role="row"
                    className="grid min-h-20 grid-cols-[1.4fr_110px_110px_110px_140px_90px_100px_110px] items-center gap-3 px-3 py-4 hover:bg-muted/30"
                  >
                    <div role="cell" className="min-w-0">
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
                          search={{ returnTo: returnTo(item.id) }}
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
                    <span role="cell" className="truncate">
                      {/* "Unknown owner" and "Unassigned" are different facts: one
                          is a person we cannot resolve, the other is nobody. */}
                      {item.ownerName ?? (item.ownerId ? "Unknown owner" : "Unassigned")}
                    </span>
                    <span role="cell">
                      {item.slaDueAt ? (
                        <SlaPill state={item.escalationState} />
                      ) : (
                        <span>SLA 待確認</span>
                      )}
                    </span>
                    <span role="cell">
                      <BusinessBlockers item={item} />
                    </span>
                    <span role="cell">
                      SLA: {formatDateTime(item.slaDueAt)}
                      <br />
                      法定日: {item.businessContext?.filingDueDate ?? "待確認"}
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
                    <p className="text-xs text-muted-foreground">
                      {item.companyName ?? "Company no longer on file"}
                    </p>
                    {caseDetailLinkFor(item) ? (
                      <Link
                        to={caseDetailLinkFor(item)!.to}
                        params={caseDetailLinkFor(item)!.params}
                        search={{ returnTo: returnTo(item.id) }}
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
                  <QueueField label="Owner">
                    {item.ownerName ?? (item.ownerId ? "姓名待補" : "Unassigned")}
                  </QueueField>
                  <QueueField label="SLA">
                    {item.slaDueAt ? (
                      <SlaPill state={item.escalationState} />
                    ) : (
                      <span>SLA 待確認</span>
                    )}
                  </QueueField>
                  <QueueField label="業務 blocker">
                    <BusinessBlockers item={item} />
                  </QueueField>
                  <QueueField label="SLA 到期">{formatDateTime(item.slaDueAt)}</QueueField>
                  <QueueField label="法定申報日">
                    {item.businessContext?.filingDueDate ?? "待確認"}
                  </QueueField>
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
      {page?.nextCursor ? (
        <button
          disabled={queueQuery.isFetching}
          className="m-4 min-h-11 rounded border px-3 py-2"
          onClick={() =>
            void navigate({ search: { ...search, cursor: page.nextCursor!, anchor: undefined } })
          }
        >
          下一頁（最多50項）
        </button>
      ) : null}
      {assignmentItem && items.some((i) => i.id === assignmentItem.id) ? (
        <AssignmentDialog
          key={actorScope}
          item={assignmentItem}
          actorScope={actorScope}
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
  actorScope,
  onClose,
  onAssigned,
}: {
  item: PersistedWorkItem;
  actorScope: string;
  onClose: () => void;
  onAssigned: () => void;
}) {
  const [selected, setSelected] = useState("");
  const [reason, setReason] = useState("");
  const [target, setTarget] = useState<"owner" | "reviewer">("owner");
  const recommendations = useQuery({
    queryKey: ["work-item-recommendations", item.id, actorScope, target, item.version],
    queryFn: () =>
      recommendWorkItemAssignees({ data: { workItemId: item.id, assignmentTarget: target } }),
  });
  const assign = useMutation({
    mutationFn: () =>
      assignWorkItem({
        data: {
          workItemId: item.id,
          assigneeId: selected,
          expectedVersion: item.version,
          assignmentTarget: target,
          overrideReason: reason.trim() || undefined,
        },
      }),
    onSuccess: onAssigned,
  });
  const options = activeAssignmentOptions(recommendations.data ?? []);
  const labels = assignmentLabels(options);
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
          <select
            aria-label="Assignment responsibility"
            value={target}
            onChange={(event) => {
              setTarget(event.target.value as "owner" | "reviewer");
              setSelected("");
              setReason("");
            }}
          >
            <option value="owner">Owner</option>
            <option value="reviewer">Reviewer</option>
          </select>
          {recommendations.isError ? <p role="alert">可指派名單未能載入，請重新載入。</p> : null}
          {recommendations.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading recommendations...</p>
          ) : null}
          {options.map((option) => (
            <RecommendationOption
              key={option.userId}
              option={option}
              label={labels.get(option.userId)!}
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
  label,
  selected,
  onSelect,
}: {
  option: AssignmentRecommendation & AssignmentOption;
  label: string;
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
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-1 block text-xs text-muted-foreground">
          Skill {option.factors.skillProficiency}/5 · Load {option.factors.capacityUtilization}%
        </span>
      </span>
      <span className="text-sm font-semibold tabular-nums">{option.score}</span>
    </button>
  );
}

function BusinessBlockers({ item }: { item: PersistedWorkItem }) {
  const context = item.businessContext;
  return (
    <div>
      <p className="text-xs">
        SLA blocker: {item.status === "blocked" ? "工作狀態受阻" : "未記錄"}
      </p>
      {!context ? (
        <p>業務狀態待確認</p>
      ) : context.blockers.length === 0 ? (
        <p>沒有業務 blocker</p>
      ) : (
        <details>
          <summary>業務 blocker（{context.blockers.length}）</summary>
          <ul>
            {context.blockers.map((blocker, index) => (
              <li key={`${blocker.code}:${index}`}>
                <a className="underline" href={blocker.action}>
                  {blocker.message}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function QueueFacetSelect({
  actorScope,
  view,
  kind,
  label,
  value,
  onChange,
}: {
  actorScope: string;
  view: "mine" | "team" | "breached";
  kind: "owner" | "workType";
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [q, setQ] = useState("");
  const [chosen, setChosen] = useState<{ id: string; label: string } | null>(null);
  const choices = useInfiniteQuery({
    queryKey: ["queue-filter-options", actorScope, view, kind, q],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listWorkQueueFilterOptions({ data: { view, kind, q, cursor: pageParam, limit: 50 } }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
  const options = new Map(
    (choices.data?.pages ?? []).flatMap((page) =>
      page.items.map((item) => [item.id, item.label] as const),
    ),
  );
  if (value !== "all" && value !== "unassigned" && !options.has(value))
    options.set(
      value,
      chosen?.id === value ? chosen.label : kind === "workType" ? value : "目前選擇的負責人",
    );
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <input
        aria-label={kind === "owner" ? "搜尋負責人選項" : "搜尋工作類型選項"}
        value={q}
        onChange={(event) => setQ(event.target.value)}
        placeholder={kind === "owner" ? "搜尋負責人" : "搜尋工作類型"}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm"
      />
      <FilterSelect
        label={label}
        value={value}
        onChange={(id) => {
          setChosen({ id, label: options.get(id) ?? id });
          onChange(id);
        }}
      >
        <option value="all">{kind === "owner" ? "All owners" : "All work types"}</option>
        {kind === "owner" ? <option value="unassigned">Unassigned</option> : null}
        {[...options].map(([id, text]) => (
          <option key={id} value={id}>
            {text}
          </option>
        ))}
      </FilterSelect>
      {choices.isPending ? <p role="status">選項載入中</p> : null}
      {choices.isError ? (
        <button
          type="button"
          className="min-h-9 border px-2"
          onClick={() =>
            choices.isFetchNextPageError ? void choices.fetchNextPage() : void choices.refetch()
          }
        >
          重試篩選選項
        </button>
      ) : null}
      {choices.hasNextPage ? (
        <button
          type="button"
          className="min-h-9 border px-2"
          disabled={choices.isFetchingNextPage}
          onClick={() => void choices.fetchNextPage()}
        >
          載入更多{kind === "owner" ? "負責人" : "工作類型"}
        </button>
      ) : null}
    </div>
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
function formatDateTime(value: string | null) {
  if (!value) return "待確認";
  return new Intl.DateTimeFormat("en-HK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Hong_Kong",
  }).format(new Date(value));
}
