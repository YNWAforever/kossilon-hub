import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { PageHeader } from "@/components/page-header";
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
import { dataOriginLabel } from "@/features/clients/data-origin";

const BOARD_PAGE_SIZE = 200;

// One template, defined once, with real floors on both flexible tracks. A track
// of minmax(0, …) collapses to zero and lets its text draw over the neighbouring
// column, which is what happened on the demo board.
const BOARD_GRID_COLUMNS =
  "lg:grid-cols-[minmax(220px,1.6fr)_140px_150px_96px_minmax(130px,1fr)_110px_120px_90px_72px]";
const BOARD_GRID_MIN_WIDTH = "lg:min-w-[1200px]";

const riskToneClasses: Record<RiskLevel, string> = {
  red: "bg-red-100 text-red-700",
  orange: "bg-orange-100 text-orange-700",
  yellow: "bg-yellow-100 text-yellow-800",
  green: "bg-green-100 text-green-700",
};

export function ProductionAnnualReturnCommandCenter({
  search,
  onSearchChange,
  allowFixtureDiagnostics = false,
}: {
  search: AnnualReturnBoardSearch;
  onSearchChange?: (next: AnnualReturnBoardSearch) => void;
  allowFixtureDiagnostics?: boolean;
}) {
  const today = hongKongBusinessDate();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [includeFixtures, setIncludeFixtures] = useState(false);

  const filters = { ...boardFiltersFromSearch(search, BOARD_PAGE_SIZE), includeFixtures };
  // Pages already loaded beyond the first. Reset whenever the filters change,
  // because a cursor is only meaningful within the query that produced it.
  const [extraPages, setExtraPages] = useState<AnnualReturnCase[][]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const filtersKey = JSON.stringify(filters);
  useEffect(() => {
    setExtraPages([]);
    setCursor(undefined);
  }, [filtersKey]);

  const casesQuery = useQuery({
    queryKey: annualReturnQueryKeys.list(filters),
    queryFn: () => listAnnualReturnCasePage({ data: filters }),
    retry: false,
  });

  // Counted in SQL across the actor's whole scope, not over the page on screen.
  const totalsQuery = useQuery({
    queryKey: [...annualReturnQueryKeys.list(filters), "totals"],
    queryFn: () => getAnnualReturnBoardTotals({ data: filters }),
    retry: false,
  });

  const nextPageMutation = useMutation({
    mutationFn: (from: string) => listAnnualReturnCasePage({ data: { ...filters, cursor: from } }),
    onSuccess: (page) => {
      setExtraPages((current) => [...current, page.cases]);
      setCursor(page.nextCursor ?? undefined);
    },
  });

  // Only fetched once the dialog is actually open — these are cheap reads, but
  // there is no reason to fire them on every board load when most visits never
  // open the dialog at all.
  const eligibleCompaniesQuery = useQuery({
    queryKey: ["annual-returns", "eligible-companies", { includeFixtures }],
    queryFn: () => listCompaniesEligibleForCase({ data: { includeFixtures } }),
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

  const cases = useMemo(
    () => [...(casesQuery.data?.cases ?? []), ...extraPages.flat()],
    [casesQuery.data, extraPages],
  );
  const nextCursor = cursor ?? casesQuery.data?.nextCursor ?? undefined;

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
              New case
            </button>
            <Link
              to="/work-queue"
              search={{
                view: "team",
                owner: "all",
                workType: "all",
                sla: "all",
                priority: "all",
                status: "all",
              }}
              className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
            >
              Open work queue
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
      {casesQuery.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Annual return data is unavailable. Try again shortly.
        </p>
      ) : null}

      {workItemsQuery.isError ? (
        <p role="status" className="text-sm text-status-yellow">
          Assignment and SLA data is unavailable. Case details below are unaffected.
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

      <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Metric label="Due in 7 days" value={totals?.dueIn7 ?? 0} />
        <Metric label="Due in 30 days" value={totals?.dueIn30 ?? 0} />
        <Metric label="Overdue" value={totals?.overdue ?? 0} />
        <Metric label="High risk (loaded)" value={pageMetrics.highRisk} />
        <Metric label="Missing documents" value={totals?.missingDocuments ?? 0} />
        <Metric label="Payment pending" value={totals?.paymentPending ?? 0} />
        <Metric label="Cases in scope" value={totals?.total ?? 0} />
      </div>
      <p className="text-sm text-muted-foreground">
        {includeFixtures
          ? "診斷範圍：包含測試資料；測試與歷史資料不會外發。"
          : "正式範圍：排除測試資料；歷史資料只供查閱。"}
      </p>
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

      <section className="rounded-lg border bg-card">
        <div className="grid gap-3 border-b p-4 lg:grid-cols-[1fr_auto_auto_auto]">
          <input
            aria-label="Search company"
            className="rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="Search company"
            value={search.q ?? ""}
            onChange={(event) => update({ q: event.target.value })}
          />
          <select
            aria-label="Filter by owner"
            className="rounded-md border bg-background px-3 py-2 text-sm"
            value={search.ownerId ?? ""}
            onChange={(event) => update({ ownerId: event.target.value || undefined })}
          >
            <option value="">All owners</option>
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by status"
            className="rounded-md border bg-background px-3 py-2 text-sm"
            value={search.status ?? ""}
            onChange={(event) =>
              update({ status: (event.target.value as AnnualReturnStatus) || undefined })
            }
          >
            <option value="">All statuses</option>
            {ANNUAL_RETURN_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by risk"
            className="rounded-md border bg-background px-3 py-2 text-sm"
            value={search.risk ?? ""}
            onChange={(event) => update({ risk: (event.target.value as RiskLevel) || undefined })}
          >
            <option value="">All risk levels</option>
            <option value="red">Red</option>
            <option value="orange">Orange</option>
            <option value="yellow">Yellow</option>
            <option value="green">Green</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <div className={BOARD_GRID_MIN_WIDTH}>
            <div
              className={`hidden gap-3 border-b px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:grid ${BOARD_GRID_COLUMNS}`}
            >
              <span>Company</span>
              <span>Due</span>
              <span>Status</span>
              <span>Risk</span>
              <span>Owner</span>
              <span>Checklist</span>
              <span>Payment</span>
              <span>Reminders</span>
              <span className="text-right">Open</span>
            </div>

            <div className="divide-y">
              {visibleCases.map((case_) => (
                <BoardRow
                  key={case_.id}
                  caseItem={case_}
                  today={today}
                  workItem={workItemsByCase.get(case_.id)}
                  workItemsUnavailable={workItemsQuery.isError}
                />
              ))}
            </div>
          </div>
        </div>

        {casesQuery.isPending ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Loading annual return cases...</p>
        ) : null}

        {/* Gated on isError as well as isPending. payments.tsx omits the isError
            half and so renders "unavailable" and "nothing to review" together. */}
        {nextCursor ? (
          <div className="border-t p-4">
            <button
              className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
              disabled={nextPageMutation.isPending}
              onClick={() => nextPageMutation.mutate(nextCursor)}
              type="button"
            >
              {nextPageMutation.isPending ? "載入中…" : "載入更多"}
            </button>
          </div>
        ) : null}
        {!casesQuery.isPending && !casesQuery.isError && visibleCases.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            No annual return cases match these filters.
          </p>
        ) : null}
      </section>
    </main>
  );
}

function BoardRow({
  caseItem,
  today,
  workItem,
  workItemsUnavailable,
}: {
  caseItem: AnnualReturnCase;
  today: string;
  workItem: PersistedWorkItem | undefined;
  workItemsUnavailable: boolean;
}) {
  const daysRemaining = daysBetween(today, caseItem.filingDueDate);
  const required = caseItem.checklist.filter((item) => item.required);
  const verified = required.filter((item) => item.status === "Verified");

  return (
    <div className={`grid gap-3 px-4 py-3 text-sm lg:grid ${BOARD_GRID_COLUMNS}`}>
      <div className="min-w-0">
        <p className="truncate font-medium">{caseItem.companyName}</p>
        <span className="text-xs text-muted-foreground">
          {dataOriginLabel(caseItem.dataOrigin)}
        </span>
        <p className="truncate text-sm text-muted-foreground">
          {caseItem.returnYear} · made up {caseItem.madeUpDate}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          SLA:{" "}
          {workItemsUnavailable
            ? "Unavailable"
            : workItem
              ? workItem.escalationState
              : "No work item"}
        </p>
      </div>
      <Field label="Due" value={formatDue(caseItem.filingDueDate, daysRemaining)} />
      <Field label="Status" value={caseItem.currentStatus} />
      <Field
        label="Risk"
        value={
          <span
            className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${riskToneClasses[caseItem.riskLevel]}`}
          >
            {caseItem.riskLevel}
          </span>
        }
      />
      <Field label="Owner" value={caseItem.ownerName} />
      <Field label="Checklist" value={`${verified.length}/${required.length} verified`} />
      <Field label="Payment" value={caseItem.payment?.status ?? "Not invoiced"} />
      <Field label="Reminders" value={`${caseItem.remindersSent}`} />
      <div className="flex justify-start lg:justify-end">
        <Link
          className="rounded-md border px-3 py-1.5 text-sm"
          to="/annual-returns/$id"
          params={{ id: caseItem.id }}
        >
          Open
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
  if (daysRemaining < 0) return `${dueDate} (${Math.abs(daysRemaining)}d overdue)`;
  return `${dueDate} (${daysRemaining}d)`;
}
