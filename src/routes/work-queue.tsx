import { pageTitle } from "@/lib/page-title";
import { formatDateTime } from "@/lib/format-date";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, Check, Clock3, Search, UserRoundPlus } from "lucide-react";
import { DemoUnavailable } from "@/components/demo-unavailable";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
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
import {
  ESCALATION_STATE_LABELS,
  WORK_ITEM_STATUS_LABELS,
  workTypeLabel,
} from "@/features/work-items/labels";
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
  head: () => ({ meta: [{ title: pageTitle("工作隊列") }] }),
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

export function WorkQueueRoute() {
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const { actor, dataMode } = Route.useRouteContext();
  const actorScope = JSON.stringify(
    actor ? [actor.authUserId, actor.userId, actor.role, actor.teamId, actor.active] : null,
  );
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
    queryKey: ["work-queue", view, actorScope],
    queryFn: () => listWorkQueue({ data: filters }),
    enabled: dataMode === "production",
  });
  const items = useMemo(() => queueQuery.data ?? [], [queueQuery.data]);
  const owners = useMemo(
    () =>
      assignmentLabels(
        items.flatMap((item) =>
          item.ownerId
            ? [
                {
                  userId: item.ownerId,
                  displayName: item.ownerName ?? "",
                  teamName: item.ownerTeamName ?? null,
                  active: true,
                  workload: 0,
                },
              ]
            : [],
        ),
      ),
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
        `${item.title} ${item.workType} ${workTypeLabel(item.workType)} ${item.companyName ?? ""}`
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
  const presentationScope = JSON.stringify([actorScope, bulkFilters]);
  const [loadedScope, setLoadedScope] = useState({ scope: presentationScope, limit: 50 });
  const visibleLimit = loadedScope.scope === presentationScope ? loadedScope.limit : 50;
  const pageItems = visibleItems.slice(0, visibleLimit);

  const setFilter = (key: "owner" | "workType" | "sla" | "priority" | "status", value: string) =>
    void navigate({ search: { ...search, [key]: value }, replace: true });

  const metrics = {
    dueToday: items.filter((item) => hongKongDateKey(item.slaDueAt) === hongKongDateKey(new Date()))
      .length,
    atRisk: items.filter((item) => item.escalationState === "warning").length,
    breached: items.filter((item) => item.escalationState === "breach").length,
    unassigned: items.filter((item) => !item.ownerId).length,
  };

  if (dataMode !== "production") {
    // Work items, SLA clocks and assignments exist only in Postgres; demo mode
    // has no server data to read (docs/adr/0001-demo-mode-is-read-only.md).
    return (
      <main className="min-w-0 flex-1 space-y-4 p-4 md:p-6">
        <PageHeader eyebrow="今日工作" title="工作隊列" subtitle="分配、工作量及 SLA 管控" />
        <DemoUnavailable message="工作隊列讀取正式分配與 SLA 資料，示範模式沒有可讀取的工作項目。" />
      </main>
    );
  }

  return (
    <>
      <main className="min-w-0 flex-1 p-4 md:p-6">
        <PageHeader eyebrow="今日工作" title="工作隊列" subtitle="分配、工作量及 SLA 管控" />
        <div className="mt-5 grid grid-cols-2 border-y border-border md:grid-cols-4">
          <Counter label="今日到期" value={metrics.dueToday} />
          <Counter label="有風險" value={metrics.atRisk} tone="warning" />
          <Counter label="已逾時" value={metrics.breached} tone="danger" />
          <Counter label="未分配" value={metrics.unassigned} />
        </div>

        <div className="mt-5 flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-center lg:justify-between">
          <nav aria-label="工作隊列檢視" className="flex min-w-0 gap-1">
            {(
              [
                ["mine", "我的工作"],
                ["team", "團隊隊列"],
                ["breached", "已逾時"],
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
            <span className="sr-only">搜尋工作隊列</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜尋案件或工作類型"
              className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm"
            />
          </label>
        </div>

        <div className="grid gap-2 border-b border-border py-3 sm:grid-cols-2 xl:grid-cols-5">
          <FilterSelect
            label="按負責同事篩選"
            value={owner}
            onChange={(value) => setFilter("owner", value)}
          >
            <option value="all">全部負責同事</option>
            <option value="unassigned">未分配</option>
            {[...owners].map(([ownerId, label]) => (
              <option key={ownerId} value={ownerId}>
                {label}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="按工作類型篩選"
            value={workType}
            onChange={(value) => setFilter("workType", value)}
          >
            <option value="all">全部工作類型</option>
            {workTypes.map((value) => (
              <option key={value} value={value}>
                {workTypeLabel(value)}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="按 SLA 狀態篩選"
            value={sla}
            onChange={(value) => setFilter("sla", value)}
          >
            <option value="all">全部 SLA 狀態</option>
            <option value="none">{ESCALATION_STATE_LABELS.none}</option>
            <option value="warning">{ESCALATION_STATE_LABELS.warning}</option>
            <option value="breach">{ESCALATION_STATE_LABELS.breach}</option>
            <option value="acknowledged">{ESCALATION_STATE_LABELS.acknowledged}</option>
          </FilterSelect>
          <FilterSelect
            label="按優先次序篩選"
            value={priority}
            onChange={(value) => setFilter("priority", value)}
          >
            <option value="all">全部優先次序</option>
            <option value="high">高（70 或以上）</option>
            <option value="normal">一般</option>
          </FilterSelect>
          <FilterSelect
            label="按狀態篩選"
            value={status}
            onChange={(value) => setFilter("status", value)}
          >
            <option value="all">全部狀態</option>
            <option value="open">{WORK_ITEM_STATUS_LABELS.open}</option>
            <option value="in_progress">{WORK_ITEM_STATUS_LABELS.in_progress}</option>
            <option value="blocked">{WORK_ITEM_STATUS_LABELS.blocked}</option>
          </FilterSelect>
        </div>

        {queueQuery.isLoading ? <QueueMessage>工作隊列載入中…</QueueMessage> : null}
        {dataMode === "production" &&
        actor?.active &&
        (actor.role === "Admin" || actor.role === "Manager") ? (
          <BulkSelectionToolbar
            actorScope={actorScope}
            resource="work_item"
            filters={bulkFilters}
            page={pageItems.map((i) => ({
              id: i.id,
              label: `${i.companyName ?? "公司資料不詳"} · ${i.title}`,
            }))}
            total={queueQuery.isError || !queueQuery.data ? null : visibleItems.length}
          />
        ) : null}
        {queueQuery.isError ? (
          <QueueMessage>無法載入工作隊列，請重新整理再試。</QueueMessage>
        ) : null}
        {!queueQuery.isLoading && !queueQuery.isError && visibleItems.length === 0 ? (
          <QueueMessage>此檢視沒有符合的工作項目。</QueueMessage>
        ) : null}

        {visibleItems.length > 0 ? (
          <section aria-label="工作項目" className="mt-1">
            <div role="table" aria-label="工作隊列" className="hidden lg:block">
              <div role="rowgroup">
                <div
                  role="row"
                  className="grid grid-cols-[1.4fr_110px_110px_110px_140px_90px_100px_110px] gap-3 border-b border-border px-3 py-3 text-xs font-medium uppercase text-muted-foreground"
                >
                  {[
                    "公司／工作項目",
                    "負責同事",
                    "SLA",
                    "業務阻礙事項",
                    "SLA 到期／法定日",
                    "優先次序",
                    "狀態",
                    "操作",
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
                      {/* Was `Company {item.companyId.slice(0, 8)}` -- a raw uuid
                          prefix where the company name belongs, on the screen
                          staff are supposed to work from. */}
                      <p className="truncate text-xs text-muted-foreground">
                        {item.companyName ?? "公司已不在記錄中"}
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
                        {workTypeLabel(item.workType)}
                        {item.annualReturnCaseId
                          ? ` · 案件 ${item.annualReturnCaseId.slice(0, 8)}`
                          : ""}
                      </p>
                    </div>
                    <span role="cell" className="truncate">
                      {/* 「姓名待補」and「未分配」are different facts: one is a
                          person we cannot resolve, the other is nobody. */}
                      {item.ownerName ?? (item.ownerId ? "姓名待補" : "未分配")}
                    </span>
                    <span role="cell">
                      <SlaPill state={item.escalationState} />
                    </span>
                    <span role="cell">
                      <BusinessBlockers item={item} />
                    </span>
                    <span role="cell">
                      SLA：{formatDateTime(item.slaDueAt)}
                      <br />
                      法定日：{item.businessContext?.filingDueDate ?? "待確認"}
                    </span>
                    <span role="cell" className="tabular-nums">
                      {item.priority}
                    </span>
                    <span role="cell">{WORK_ITEM_STATUS_LABELS[item.status]}</span>
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
                      {item.companyName ?? "公司已不在記錄中"}
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
                      {workTypeLabel(item.workType)}
                      {item.annualReturnCaseId
                        ? ` · 案件 ${item.annualReturnCaseId.slice(0, 8)}`
                        : ""}
                    </p>
                  </div>
                  <QueueField label="負責同事">
                    {item.ownerName ?? (item.ownerId ? "姓名待補" : "未分配")}
                  </QueueField>
                  <QueueField label="SLA">
                    <SlaPill state={item.escalationState} />
                  </QueueField>
                  <QueueField label="業務阻礙事項">
                    <BusinessBlockers item={item} />
                  </QueueField>
                  <QueueField label="SLA 到期">{formatDateTime(item.slaDueAt)}</QueueField>
                  <QueueField label="法定申報日">
                    {item.businessContext?.filingDueDate ?? "待確認"}
                  </QueueField>
                  <QueueField label="優先次序">{item.priority}</QueueField>
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
      {visibleItems.length > pageItems.length ? (
        <Button
          className="m-4"
          onClick={() => setLoadedScope({ scope: presentationScope, limit: visibleLimit + 50 })}
        >
          載入更多工作（每次 50 項）
        </Button>
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
            <DialogTitle>分配工作項目</DialogTitle>
            <DialogDescription>{item.title}</DialogDescription>
          </DialogHeader>
        </div>
        <div className="max-h-[55vh] space-y-2 overflow-y-auto p-5">
          <select
            aria-label="分配角色"
            value={target}
            onChange={(event) => {
              setTarget(event.target.value as "owner" | "reviewer");
              setSelected("");
              setReason("");
            }}
          >
            <option value="owner">負責同事</option>
            <option value="reviewer">覆核人</option>
          </select>
          {recommendations.isError ? <p role="alert">可分配名單未能載入，請重新載入。</p> : null}
          {recommendations.isLoading ? (
            <p className="text-sm text-muted-foreground">建議人選載入中…</p>
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
              aria-label="例外理由"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="不選首選人選或超出工作量的理由"
              className="mt-3 min-h-20 w-full rounded-md border border-input bg-background p-3 text-sm"
            />
          ) : null}
          {assign.isError ? (
            <p className="text-sm text-destructive">未能儲存分配，請重新整理再試。</p>
          ) : null}
        </div>
        <DialogFooter className="border-t border-border px-5 py-4">
          <Button onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            disabled={!selected || (requiresReason && !reason.trim()) || assign.isPending}
            onClick={() => assign.mutate()}
          >
            確認分配
          </Button>
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
          <DialogTitle>確認知悉升級</DialogTitle>
          <DialogDescription>記錄已覆核的內容，以及「{item.title}」的下一步。</DialogDescription>
        </DialogHeader>
        <textarea
          autoFocus
          aria-label="確認知悉備註"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="覆核結果及下一步"
          className="min-h-24 w-full rounded-md border border-input bg-background p-3 text-sm"
        />
        {acknowledge.isError ? (
          <p className="text-sm text-destructive">未能儲存確認知悉記錄。</p>
        ) : null}
        <DialogFooter>
          <Button onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            disabled={!note.trim() || acknowledge.isPending}
            onClick={() => acknowledge.mutate()}
          >
            確認知悉
          </Button>
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
          技能 {option.factors.skillProficiency}/5 · 工作量 {option.factors.capacityUtilization}%
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
        SLA 阻礙事項：{item.status === "blocked" ? "工作狀態受阻" : "未記錄"}
      </p>
      {!context ? (
        <p>業務狀態待確認</p>
      ) : context.blockers.length === 0 ? (
        <p>沒有業務阻礙事項</p>
      ) : (
        <details>
          <summary>業務阻礙事項（{context.blockers.length}）</summary>
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
        <Button size="icon" title="分配工作項目" onClick={() => onAssign(item)}>
          <UserRoundPlus className="h-4 w-4" />
        </Button>
      ) : null}
      {canManage && (item.escalationState === "warning" || item.escalationState === "breach") ? (
        <Button size="icon" title="確認知悉升級" onClick={() => onAcknowledge(item)}>
          <Check className="h-4 w-4" />
        </Button>
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
        "inline-flex min-h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium",
        state === "breach" && "border-destructive/40 bg-destructive/10 text-destructive",
        state === "warning" && "border-amber-300 bg-amber-50 text-amber-800",
      )}
    >
      {icon}
      {ESCALATION_STATE_LABELS[state]}
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
