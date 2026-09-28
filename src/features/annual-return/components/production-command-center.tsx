import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { PageHeader } from "@/components/page-header";
import {
  annualReturnStatusLabel,
  paymentStatusLabel,
  riskLevelLabel,
} from "@/features/runtime/operational-copy";
import { BulkSelectionToolbar } from "@/components/bulk-selection-toolbar";
import { CaseBulkAssignmentDialog } from "@/features/bulk-operations/case-bulk-controls";
import { ResourceTagDialog } from "@/features/bulk-operations/resource-tag-dialog";
import { WorkQueueBulkOperationStatus } from "@/features/bulk-operations/work-queue-bulk-controls";
import {
  addPageToSelection,
  changeSelectionFilter,
  clearBulkSelection,
  newBulkSelection,
  removeFromSelection,
  retryFailedSelection,
} from "@/features/bulk-operations/selection";
import { listActiveAnnualReturnTemplates } from "@/features/checklist-templates/server-fns";
import { listClientAssignmentOptions } from "@/features/clients/server-fns";
import { listWorkQueue } from "@/features/work-items/server-fns";
import type { PersistedWorkItem } from "@/features/work-items/repository";
import { boardFiltersFromSearch, type AnnualReturnBoardSearch } from "../board-filters";
import { boardMetrics } from "../board-metrics";
import { annualReturnQueryKeys } from "../query-keys";
import {
  getAnnualReturnBoardTotals,
  listAnnualReturnCasePage,
  listAssignableStaff,
  listCompaniesEligibleForCase,
} from "../server-fns";
import {
  ANNUAL_RETURN_STATUSES,
  type AnnualReturnCase,
  type AnnualReturnStatus,
  type RiskLevel,
} from "../types";
import { daysBetween, hongKongBusinessDate } from "../workflow";
import { CreateCaseDialog } from "./create-case-dialog";

const BOARD_PAGE_SIZE = 50;

// One template, defined once, with real floors on both flexible tracks. A track
// of minmax(0, …) collapses to zero and lets its text draw over the neighbouring
// column, which is what happened on the demo board.
const BOARD_GRID_COLUMNS =
  "lg:grid-cols-[32px_minmax(220px,1.6fr)_140px_150px_96px_minmax(130px,1fr)_110px_120px_90px_72px]";
const BOARD_GRID_MIN_WIDTH = "lg:min-w-[1240px]";

const riskToneClasses: Record<RiskLevel, string> = {
  red: "bg-red-100 text-red-700",
  orange: "bg-orange-100 text-orange-700",
  yellow: "bg-yellow-100 text-yellow-800",
  green: "bg-green-100 text-green-700",
};

export function ProductionAnnualReturnCommandCenter({
  search,
  onSearchChange,
  canManage = false,
}: {
  search: AnnualReturnBoardSearch;
  onSearchChange?: (next: AnnualReturnBoardSearch) => void;
  canManage?: boolean;
}) {
  const today = hongKongBusinessDate();
  const queryClient = useQueryClient();
  const filterKey = JSON.stringify([
    search.q ?? "",
    search.status ?? "",
    search.risk ?? "",
    search.ownerId ?? "",
    search.overdueOnly ?? false,
  ]);
  const [selection, setSelection] = useState(() => newBulkSelection(filterKey));
  const [selectionMode, setSelectionMode] = useState<"ids" | "filter">("ids");
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const currentSelection =
    selection.filterKey === filterKey ? selection : changeSelectionFilter(selection, filterKey);
  const selectedIds = useMemo(() => new Set(currentSelection.ids), [currentSelection.ids]);
  useEffect(() => {
    setSelection((previous) => changeSelectionFilter(previous, filterKey));
    setSelectionMode("ids");
    setBulkDialogOpen(false);
    setTagDialogOpen(false);
    setSelectionError(null);
  }, [filterKey]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [queryInput, setQueryInput] = useState(search.q ?? "");
  const searchRef = useRef(search);
  const queryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    searchRef.current = search;
  }, [search]);
  useEffect(() => {
    setQueryInput(search.q ?? "");
  }, [search.q]);
  useEffect(
    () => () => {
      if (queryTimerRef.current) clearTimeout(queryTimerRef.current);
    },
    [],
  );

  const filters = boardFiltersFromSearch(search, BOARD_PAGE_SIZE);
  // These SQL totals intentionally describe the owner/status scope, rather
  // than q, risk or cursor from the currently displayed result page.
  const totalsFilters = {
    ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
  };

  const casesQuery = useInfiniteQuery({
    queryKey: annualReturnQueryKeys.boardPages(filters),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) =>
      listAnnualReturnCasePage({
        data: pageParam ? { ...filters, cursor: pageParam } : filters,
      }),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    retry: false,
  });

  const totalsQuery = useQuery({
    queryKey: annualReturnQueryKeys.boardTotals(totalsFilters),
    queryFn: () => getAnnualReturnBoardTotals({ data: totalsFilters }),
    retry: false,
  });
  // Only fetched once the dialog is actually open — these are cheap reads, but
  // there is no reason to fire them on every board load when most visits never
  // open the dialog at all.
  const eligibleCompaniesQuery = useQuery({
    queryKey: ["annual-returns", "eligible-companies"],
    queryFn: () => listCompaniesEligibleForCase(),
    enabled: isCreateOpen,
    retry: false,
  });

  const activeTemplatesQuery = useQuery({
    queryKey: ["checklist-templates", "active-annual-return"],
    queryFn: () => listActiveAnnualReturnTemplates(),
    enabled: isCreateOpen,
    retry: false,
  });

  const assignmentOptionsQuery = useQuery({
    queryKey: ["clients", "assignment-options"],
    queryFn: () => listClientAssignmentOptions(),
    enabled: isCreateOpen,
    retry: false,
  });

  const workItemsQuery = useQuery({
    queryKey: ["work-queue", "annual-return-board"],
    queryFn: () => listWorkQueue({ data: { view: "team" } }),
    retry: false,
  });

  const cases = useMemo(() => {
    const seen = new Set<string>();
    return (casesQuery.data?.pages ?? []).flatMap((page) =>
      page.cases.filter((case_) => {
        if (seen.has(case_.id)) return false;
        seen.add(case_.id);
        return true;
      }),
    );
  }, [casesQuery.data]);
  const nextCursor = casesQuery.hasNextPage ? casesQuery.data?.pages.at(-1)?.nextCursor : null;

  const workItemsByCase = useMemo(() => {
    const map = new Map<string, PersistedWorkItem>();
    for (const item of workItemsQuery.data ?? []) {
      if (item.annualReturnCaseId && !map.has(item.annualReturnCaseId)) {
        map.set(item.annualReturnCaseId, item);
      }
    }
    return map;
  }, [workItemsQuery.data]);

  // No client-side re-filter: `q` is a SQL predicate over company name and CR
  // number now, so the server has already applied it. Filtering again here is
  // what used to make a case at row 201 unfindable.
  const visibleCases = cases;

  // From the staff directory rather than from the loaded rows. Building it from
  // the page meant the one control that could have narrowed the query enough to
  // surface a late case was itself limited to the cases already on screen.
  const ownersQuery = useQuery({
    queryKey: ["annual-return", "assignable-staff"],
    queryFn: () => listAssignableStaff(),
    retry: false,
    staleTime: 60_000,
  });
  const owners = useMemo(
    () => (ownersQuery.data ?? []).map((member) => ({ id: member.id, name: member.name })),
    [ownersQuery.data],
  );

  const totals = totalsQuery.data;
  // highRisk stays derived from the loaded rows and is labelled as such:
  // riskForCase computes it from checklist, payment and filing state, and
  // reproducing that in SQL is exactly the drift the repository warns about.
  const pageMetrics = boardMetrics(cases, today);

  function update(patch: Partial<AnnualReturnBoardSearch>) {
    onSearchChange?.({ ...search, ...patch });
  }

  function toggleCase(id: string) {
    try {
      setSelection(
        selectedIds.has(id)
          ? removeFromSelection(currentSelection, id)
          : addPageToSelection(currentSelection, [id]),
      );
      setSelectionError(null);
    } catch (error) {
      setSelectionError(error instanceof Error ? error.message : "Selection unavailable.");
    }
  }

  const selectionInput =
    selectionMode === "filter"
      ? {
          kind: "filter" as const,
          resource: "annual-return-cases" as const,
          filters: {
            ...(search.q ? { q: search.q } : {}),
            ...(search.status ? { status: search.status } : {}),
            ...(search.risk ? { risk: search.risk } : {}),
            ...(search.ownerId ? { ownerId: search.ownerId } : {}),
            ...(search.overdueOnly ? { overdueOnly: true } : {}),
          },
          excludedIds: currentSelection.ids,
        }
      : { kind: "ids" as const, ids: currentSelection.ids };
  const searchPending = queryInput !== (search.q ?? "");

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader
        eyebrow="Operations"
        title="Annual returns"
        actions={
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setIsCreateOpen(true)}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              建立案件
            </button>
            <Link
              to="/work-queue"
              search={{
                view: "team",
                owner: "all",
                q: "",
                page: 1,
                workType: "all",
                sla: "all",
                priority: "all",
                status: "all",
              }}
              className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
            >
              開啟工作佇列
            </Link>
          </div>
        }
      />

      <CreateCaseDialog
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        companies={eligibleCompaniesQuery.data ?? []}
        templates={activeTemplatesQuery.data ?? []}
        owners={assignmentOptionsQuery.data?.owners ?? []}
        isLoading={
          eligibleCompaniesQuery.isPending ||
          activeTemplatesQuery.isPending ||
          assignmentOptionsQuery.isPending
        }
        hasError={
          eligibleCompaniesQuery.isError ||
          activeTemplatesQuery.isError ||
          assignmentOptionsQuery.isError
        }
        onCreated={() => {
          void queryClient.invalidateQueries({ queryKey: annualReturnQueryKeys.all });
        }}
      />

      {/* A fixed string, never query.error.message: the client rehydrates and
          rethrows the verbatim server error, which is a postgres ECONNREFUSED
          with host and port, or the DATABASE_URL message. */}
      {casesQuery.isError && !casesQuery.data ? (
        <p role="alert" className="text-sm text-destructive">
          無法讀取周年申報案件。請由負責同事重試；這不代表沒有案件。
        </p>
      ) : null}

      {workItemsQuery.isError ? (
        <p role="status" className="text-sm text-status-yellow">
          暫時無法讀取分工及服務時限；請由負責同事直接查看案件詳情。
        </p>
      ) : null}

      {/* Was `cases.length === BOARD_PAGE_SIZE`, an exact-equality guess that
          could be absent while truncation had happened. The server says whether
          another page exists. */}
      {nextCursor ? (
        <p role="status" className="text-sm text-muted-foreground">
          顯示 {visibleCases.length} 筆，還有更多。
        </p>
      ) : null}

      {casesQuery.isPending || totalsQuery.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          載入案件統計中…
        </p>
      ) : totalsQuery.isError ? (
        <div role="alert" className="text-sm text-status-yellow">
          無法載入案件統計，暫不顯示數字。
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => void totalsQuery.refetch()}
          >
            重試
          </button>
        </div>
      ) : casesQuery.isError ? null : (
        <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-8">
          <Metric label="七日內到期" value={totals?.dueIn7 ?? 0} />
          <Metric label="三十日內到期" value={totals?.dueIn30 ?? 0} />
          <Metric label="逾期案件" value={totals?.overdue ?? 0} />
          <Metric label="已載入高風險" value={pageMetrics.highRisk} />
          <Metric label="欠文件案件" value={totals?.missingDocuments ?? 0} />
          <Metric label="欠文件項目" value={totals?.missingEvidenceItems ?? 0} />
          <Metric label="待付款" value={totals?.paymentPending ?? 0} />
          <Metric label="範圍內案件" value={totals?.total ?? 0} />
        </div>
      )}
      {canManage ? (
        <>
          <BulkSelectionToolbar
            selectedCount={currentSelection.ids.length}
            visibleCount={visibleCases.length}
            notice={currentSelection.notice}
            selectionLabel={
              selectionMode === "filter"
                ? "All matching filter, excluding " + currentSelection.ids.length
                : undefined
            }
            previewEnabled={
              !searchPending && (selectionMode === "filter" || currentSelection.ids.length > 0)
            }
            onSelectVisible={() => {
              try {
                setSelectionMode("ids");
                setSelection(
                  addPageToSelection(
                    selectionMode === "filter" ? newBulkSelection(filterKey) : currentSelection,
                    visibleCases.map((case_) => case_.id),
                  ),
                );
                setSelectionError(null);
              } catch (error) {
                setSelectionError(
                  error instanceof Error ? error.message : "Selection unavailable.",
                );
              }
            }}
            onSelectMatching={() => {
              setSelectionMode("filter");
              setSelection(newBulkSelection(filterKey));
              setSelectionError(null);
            }}
            onClear={() => {
              setSelectionMode("ids");
              setSelection(clearBulkSelection(currentSelection));
              setSelectionError(null);
            }}
            onPreview={() => setBulkDialogOpen(true)}
            onTag={() => setTagDialogOpen(true)}
            tagEnabled={
              !searchPending && (selectionMode === "filter" || currentSelection.ids.length > 0)
            }
            exportSelection={
              selectionInput.kind === "ids"
                ? { ...selectionInput, resource: "annual-return-cases" }
                : selectionInput
            }
            exportEnabled={
              !searchPending && (selectionMode === "filter" || currentSelection.ids.length > 0)
            }
          />
          {searchPending ? (
            <p role="status" className="text-xs text-muted-foreground">
              Wait for the company search to apply before previewing this selection.
            </p>
          ) : null}
          {selectionError ? (
            <p role="alert" className="text-xs text-destructive">
              {selectionError}
            </p>
          ) : null}
          {search.bulkOperation ? (
            <WorkQueueBulkOperationStatus
              id={search.bulkOperation}
              onRetryFailed={(items) => {
                try {
                  setSelectionMode("ids");
                  setSelection(retryFailedSelection(filterKey, items));
                  setSelectionError(null);
                } catch (error) {
                  setSelectionError(error instanceof Error ? error.message : "Retry unavailable.");
                }
              }}
            />
          ) : null}
        </>
      ) : null}
      <section className="rounded-lg border bg-card">
        <div className="grid gap-3 border-b p-4 lg:grid-cols-[1fr_auto_auto_auto]">
          <input
            aria-label="搜尋公司"
            className="rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="搜尋公司"
            value={queryInput}
            onChange={(event) => {
              const next = event.target.value;
              setQueryInput(next);
              if (queryTimerRef.current) clearTimeout(queryTimerRef.current);
              queryTimerRef.current = setTimeout(() => {
                onSearchChange?.({
                  ...searchRef.current,
                  q: next.trim() ? next : undefined,
                });
                queryTimerRef.current = null;
              }, 300);
            }}
          />
          <select
            aria-label="按負責人篩選"
            className="rounded-md border bg-background px-3 py-2 text-sm"
            value={search.ownerId ?? ""}
            onChange={(event) => update({ ownerId: event.target.value || undefined })}
          >
            <option value="">所有負責人</option>
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </select>
          <select
            aria-label="按狀態篩選"
            className="rounded-md border bg-background px-3 py-2 text-sm"
            value={search.status ?? ""}
            onChange={(event) =>
              update({ status: (event.target.value as AnnualReturnStatus) || undefined })
            }
          >
            <option value="">所有狀態</option>
            {ANNUAL_RETURN_STATUSES.map((status) => (
              <option key={status} value={status}>
                {annualReturnStatusLabel(status)}
              </option>
            ))}
          </select>
          <select
            aria-label="按風險篩選"
            className="rounded-md border bg-background px-3 py-2 text-sm"
            value={search.risk ?? ""}
            onChange={(event) => update({ risk: (event.target.value as RiskLevel) || undefined })}
          >
            <option value="">所有風險級別</option>
            <option value="red">高風險</option>
            <option value="orange">較高風險</option>
            <option value="yellow">需留意</option>
            <option value="green">低風險</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <div className={BOARD_GRID_MIN_WIDTH}>
            <div
              className={`hidden gap-3 border-b px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:grid ${BOARD_GRID_COLUMNS}`}
            >
              <span>選取</span>
              <span className="sticky left-[60px] z-10 bg-card">公司</span>
              <span>到期日</span>
              <span>狀態</span>
              <span>風險</span>
              <span>負責人</span>
              <span>文件</span>
              <span>付款</span>
              <span>追件</span>
              <span className="sticky right-0 z-10 bg-card text-right">操作</span>
            </div>

            <div className="divide-y">
              {visibleCases.map((case_) => (
                <BoardRow
                  key={case_.id}
                  caseItem={case_}
                  today={today}
                  workItem={workItemsByCase.get(case_.id)}
                  workItemsUnavailable={workItemsQuery.isError}
                  canSelect={canManage}
                  selected={
                    selectionMode === "filter"
                      ? !selectedIds.has(case_.id)
                      : selectedIds.has(case_.id)
                  }
                  onToggle={() => toggleCase(case_.id)}
                />
              ))}
            </div>
          </div>
        </div>

        {casesQuery.isPending ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">正在載入周年申報案件…</p>
        ) : null}

        {/* Gated on isError as well as isPending. payments.tsx omits the isError
            half and so renders "unavailable" and "nothing to review" together. */}
        {casesQuery.isFetchNextPageError ? (
          <p role="alert" className="border-t px-4 py-2 text-sm text-status-yellow">
            下一頁載入失敗；已載入的案件仍可使用。請重試。
          </p>
        ) : null}
        {nextCursor ? (
          <div className="border-t p-4">
            <button
              className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
              disabled={casesQuery.isFetchingNextPage}
              onClick={() => {
                if (!casesQuery.isFetchingNextPage) {
                  void casesQuery.fetchNextPage({ cancelRefetch: false });
                }
              }}
              type="button"
            >
              {casesQuery.isFetchingNextPage
                ? "載入中…"
                : casesQuery.isFetchNextPageError
                  ? "重試載入更多"
                  : "載入更多"}
            </button>
          </div>
        ) : null}
        {!casesQuery.isPending && !casesQuery.isError && visibleCases.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            目前沒有符合篩選條件的案件。請由負責同事核對篩選條件。
          </p>
        ) : null}
      </section>
      {canManage && bulkDialogOpen ? (
        <CaseBulkAssignmentDialog
          selection={selectionInput}
          owners={ownersQuery.data ?? []}
          onClose={() => setBulkDialogOpen(false)}
          onCommitted={(operationId) => {
            setBulkDialogOpen(false);
            setSelectionMode("ids");
            setSelection(newBulkSelection(filterKey));
            update({ bulkOperation: operationId });
            void queryClient.invalidateQueries({ queryKey: annualReturnQueryKeys.all });
          }}
        />
      ) : null}
      {canManage && tagDialogOpen ? (
        <ResourceTagDialog
          selection={
            selectionInput.kind === "ids"
              ? { ...selectionInput, resource: "annual-return-cases" }
              : selectionInput
          }
          onClose={() => setTagDialogOpen(false)}
          onCommitted={(operationId) => {
            setTagDialogOpen(false);
            setSelectionMode("ids");
            setSelection(newBulkSelection(filterKey));
            update({ bulkOperation: operationId });
            void queryClient.invalidateQueries({ queryKey: annualReturnQueryKeys.all });
          }}
        />
      ) : null}
    </main>
  );
}

function BoardRow({
  caseItem,
  today,
  workItem,
  workItemsUnavailable,
  canSelect,
  selected,
  onToggle,
}: {
  caseItem: AnnualReturnCase;
  today: string;
  workItem: PersistedWorkItem | undefined;
  workItemsUnavailable: boolean;
  canSelect: boolean;
  selected: boolean;
  onToggle: () => void;
}) {
  const daysRemaining = daysBetween(today, caseItem.filingDueDate);
  const required = caseItem.checklist.filter((item) => item.required);
  const verified = required.filter((item) => item.status === "Verified");

  return (
    <div className={`grid gap-3 px-4 py-3 text-sm lg:grid ${BOARD_GRID_COLUMNS}`}>
      <label className="flex items-start">
        <input
          type="checkbox"
          aria-label={"選取 " + caseItem.companyName}
          checked={canSelect && selected}
          disabled={!canSelect}
          onChange={onToggle}
        />
      </label>
      <div className="min-w-0 lg:sticky lg:left-[60px] lg:z-10 lg:bg-card">
        <Link
          className="block truncate font-medium underline-offset-2 hover:underline focus-visible:underline"
          to="/annual-returns/$id"
          params={{ id: caseItem.id }}
        >
          {caseItem.companyName}
        </Link>
        <p className="truncate text-sm text-muted-foreground">
          {caseItem.returnYear} 年 · 結算日 {caseItem.madeUpDate}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          工作期限：{" "}
          {workItemsUnavailable
            ? "暫時無法讀取，請由負責同事核對"
            : workItem
              ? workItem.escalationState
              : "未有工作項目"}
        </p>
      </div>
      <Field label="到期日" value={formatDue(caseItem.filingDueDate, daysRemaining)} />
      <Field label="狀態" value={annualReturnStatusLabel(caseItem.currentStatus)} />
      <Field
        label="風險"
        value={
          <span
            className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${riskToneClasses[caseItem.riskLevel]}`}
          >
            {riskLevelLabel(caseItem.riskLevel)}
          </span>
        }
      />
      <Field label="負責人" value={caseItem.ownerName} />
      <Field label="文件" value={`${verified.length}/${required.length} 已核實`} />
      <Field label="付款" value={paymentStatusLabel(caseItem.payment?.status ?? "Not invoiced")} />
      <Field label="追件" value={`${caseItem.remindersSent}`} />
      <div className="flex justify-start lg:sticky lg:right-0 lg:z-10 lg:justify-end lg:bg-card">
        <Link
          className="inline-flex min-h-10 items-center rounded-md border px-3 py-1.5 text-sm"
          to="/annual-returns/$id"
          params={{ id: caseItem.id }}
          aria-label={`開啟案件：${caseItem.companyName}（${caseItem.returnYear}）`}
        >
          開啟
        </Link>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-xs uppercase tracking-wide text-muted-foreground lg:hidden">{label}</p>
      <div className="truncate">{value}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border bg-background px-3 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-lg font-semibold">{value}</p>
    </div>
  );
}

function formatDue(dueDate: string, daysRemaining: number): string {
  if (daysRemaining < 0) return `${dueDate}（逾期 ${Math.abs(daysRemaining)} 天）`;
  return `${dueDate}（尚餘 ${daysRemaining} 天）`;
}
