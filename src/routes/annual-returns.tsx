import { type ReactNode, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";

import {
  getBlockers,
  getCaseMetrics,
  getFollowUpDrafts,
  getNextAction,
  getPacketReadiness,
  getPacketStatus,
  getReadinessScore,
  getRiskLevel,
  useAnnualReturnCases,
  type AnnualReturnCase,
  type AnnualReturnPacketStatus,
  type AnnualReturnRiskLevel,
} from "../lib/annual-return-store";
import { daysUntil } from "../lib/app-data";
import { PageHeader } from "@/components/page-header";
import { listWorkQueue } from "../features/work-items/server-fns";
import { ProductionAnnualReturnCommandCenter } from "../features/annual-return/components/production-command-center";
import { boardSearchFromUrl } from "../features/annual-return/board-filters";
import type { PersistedWorkItem } from "../features/work-items/repository";

export const Route = createFileRoute("/annual-returns")({
  // Board filters live in the URL so they survive a reload and a return from a
  // detail screen. The sanitiser is in board-filters.ts so it can be unit-tested;
  // a route file cannot export a non-component without tripping react-refresh.
  validateSearch: boardSearchFromUrl,
  component: AnnualReturnsRoute,
});

function AnnualReturnsRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { dataMode } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();

  // Hoisted above both the branch and every hook. /annual-returns/$id is a child
  // route and renders only through this outlet, so a branch placed before it
  // would silently stop the detail screen from rendering. Keeping it above the
  // hooks also stops the board's queries and filter pipeline running while the
  // detail screen is on screen, which is what happened before.
  if (pathname !== "/annual-returns") {
    return <Outlet />;
  }

  return dataMode === "demo" ? (
    <DemoAnnualReturnCommandCenter />
  ) : (
    <ProductionAnnualReturnCommandCenter
      search={search}
      onSearchChange={(next) => void navigate({ search: next, replace: true })}
    />
  );
}

function DemoAnnualReturnCommandCenter() {
  const cases = useAnnualReturnCases();
  const workItemsQuery = useQuery({
    queryKey: ["work-queue", "annual-return-list"],
    queryFn: () => listWorkQueue({ data: { view: "team" } }),
  });
  const workItemsByCase = useMemo(() => {
    const map = new Map<string, PersistedWorkItem>();
    for (const item of workItemsQuery.data ?? []) {
      if (!map.has(item.caseId)) map.set(item.caseId, item);
    }
    return map;
  }, [workItemsQuery.data]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<
    "all" | "urgent" | "blocked" | "ready" | "packet-ready" | "needs-follow-up" | "filed"
  >("all");
  const [owner, setOwner] = useState("all");

  const metrics = getCaseMetrics(cases);
  const owners = Array.from(new Set(cases.map((caseItem) => caseItem.owner))).sort();

  const visibleCases = useMemo(() => {
    return cases
      .filter((caseItem) => {
        const risk = getRiskLevel(caseItem);
        const followUps = getFollowUpDrafts(caseItem);
        const matchesQuery = `${caseItem.companyName} ${caseItem.contactName}`
          .toLowerCase()
          .includes(query.toLowerCase());
        const matchesOwner = owner === "all" || caseItem.owner === owner;
        const matchesFilter =
          filter === "all" ||
          (filter === "urgent" && (risk === "overdue" || risk === "due-soon")) ||
          (filter === "blocked" && getBlockers(caseItem).length > 0 && risk !== "filed") ||
          (filter === "ready" && risk === "ready-to-file") ||
          (filter === "packet-ready" &&
            getPacketStatus(caseItem) === "approved" &&
            risk !== "filed") ||
          (filter === "needs-follow-up" && followUps.some((draft) => draft.status === "draft")) ||
          (filter === "filed" && risk === "filed");
        return matchesQuery && matchesOwner && matchesFilter;
      })
      .sort((a, b) => riskSortValue(getRiskLevel(a)) - riskSortValue(getRiskLevel(b)));
  }, [cases, filter, owner, query]);

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader
        eyebrow="Operations"
        title="Annual returns"
        actions={
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
        }
      />

      <div className="grid gap-3 md:grid-cols-5">
        <Metric label="Overdue" value={metrics.overdue} tone="red" />
        <Metric label="Due soon" value={metrics.dueSoon} tone="orange" />
        <Metric label="Blocked" value={metrics.blocked} tone="yellow" />
        <Metric label="Ready to file" value={metrics.readyToFile} tone="green" />
        <Metric label="Filed" value={metrics.filed} tone="blue" />
      </div>

      <section className="rounded-lg border bg-card">
        <div className="grid gap-3 border-b p-4 lg:grid-cols-[1fr_auto_auto]">
          <input
            className="rounded-md border bg-background px-3 py-2 text-sm"
            aria-label="Search company or contact"
            placeholder="Search company or contact"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {(
              [
                "all",
                "urgent",
                "blocked",
                "ready",
                "packet-ready",
                "needs-follow-up",
                "filed",
              ] as const
            ).map((value) => (
              <button
                key={value}
                className={`rounded-md border px-3 py-2 text-sm ${
                  filter === value ? "bg-primary text-primary-foreground" : "bg-background"
                }`}
                onClick={() => setFilter(value)}
                type="button"
              >
                {filterLabel(value)}
              </button>
            ))}
          </div>
          <select
            className="rounded-md border bg-background px-3 py-2 text-sm"
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
            aria-label="Filter by owner"
          >
            <option value="all">All owners</option>
            {owners.map((ownerName) => (
              <option key={ownerName} value={ownerName}>
                {ownerName}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto">
          <div className={CASE_GRID_MIN_WIDTH}>
            <div
              className={`hidden gap-3 border-b px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:grid ${CASE_GRID_COLUMNS}`}
            >
              <span>Company</span>
              <span>Owner</span>
              <span>Risk</span>
              <span>Due</span>
              <span>Case</span>
              <span>Blockers</span>
              <span>Packet</span>
              <span>Follow-ups</span>
              <span>Next action</span>
              <span>Payment</span>
              <span className="text-right">Open</span>
            </div>

            <div className="divide-y">
              {visibleCases.map((caseItem) => (
                <CaseRow
                  key={caseItem.id}
                  caseItem={caseItem}
                  workItem={workItemsByCase.get(caseItem.id)}
                  workItemQueryState={
                    workItemsQuery.isPending
                      ? "loading"
                      : workItemsQuery.isError
                        ? "error"
                        : "ready"
                  }
                />
              ))}
              {visibleCases.length === 0 ? (
                <div className="px-4 py-8 text-sm text-muted-foreground">
                  No annual return cases match the current filters.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

// One template shared by the header row and every data row — maintained as two
// separate literals they drifted, and the columns stopped lining up.
//
// The nine fixed tracks (886px) plus ten 12px gaps plus the two minmax floors
// come to ~1356px, which is wider than the content area on a 1280-1440px
// laptop once the 300px sidebar and the p-6 padding are taken out. That is why
// the rows live inside an `overflow-x-auto` container: the board scrolls
// sideways rather than overflowing and drawing its cells on top of each other.
//
// The floors matter as much as the fixed widths. With `minmax(0, 1.4fr)` the
// company and next-action columns could be squeezed to nothing, which is what
// let their text escape the grid in the first place.
const CASE_GRID_COLUMNS =
  "lg:grid-cols-[minmax(220px,1.4fr)_110px_96px_130px_64px_140px_110px_80px_minmax(130px,1fr)_84px_72px]";
const CASE_GRID_MIN_WIDTH = "lg:min-w-[1356px]";

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "red" | "orange" | "yellow" | "green" | "blue";
}) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{label}</p>
        <span className={`h-2.5 w-2.5 rounded-full ${metricToneClass(tone)}`} />
      </div>
      <p className="mt-3 text-3xl font-semibold">{value}</p>
    </section>
  );
}

function CaseRow({
  caseItem,
  workItem,
  workItemQueryState,
}: {
  caseItem: AnnualReturnCase;
  workItem?: PersistedWorkItem;
  workItemQueryState: "loading" | "error" | "ready";
}) {
  const risk = getRiskLevel(caseItem);
  const readiness = getReadinessScore(caseItem);
  const nextAction = getNextAction(caseItem);
  const dueInDays = daysUntil(caseItem.dueDate);
  const packetReadiness = getPacketReadiness(caseItem);
  const packetStatus = getPacketStatus(caseItem);
  const followUps = getFollowUpDrafts(caseItem);
  const openFollowUps = followUps.filter((draft) => draft.status === "draft").length;
  const blockers = getBlockers(caseItem);
  const blockerSummary =
    blockers.length === 0
      ? "None"
      : blockers.length === 1
        ? blockers[0].label
        : `${blockers[0].label} +${blockers.length - 1}`;

  return (
    <div className={`grid gap-3 px-4 py-4 lg:items-center ${CASE_GRID_COLUMNS}`}>
      <div className="min-w-0">
        <p className="truncate font-medium">{caseItem.companyName}</p>
        <p className="truncate text-sm text-muted-foreground">{caseItem.contactName}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Work owner:{" "}
          {workItemQueryState === "loading"
            ? "Loading"
            : workItemQueryState === "error"
              ? "Unavailable"
              : workItem?.ownerId
                ? `Staff ${workItem.ownerId.slice(0, 8)}`
                : workItem
                  ? "Unassigned"
                  : "No work item"}
        </p>
        <p className="text-xs text-muted-foreground">
          SLA state:{" "}
          {workItemQueryState === "loading"
            ? "Loading"
            : workItemQueryState === "error"
              ? "Unavailable"
              : workItem
                ? workItem.escalationState
                : "No work item"}
        </p>
      </div>

      <Field label="Owner" value={caseItem.owner} />
      <Field label="Risk" value={<RiskPill risk={risk} />} />
      <Field label="Due" value={formatDue(caseItem.dueDate, dueInDays)} />
      <Field label="Case" value={`${readiness}%`} />
      <Field label="Blockers" value={blockerSummary} />
      <Field label="Packet" value={`${packetLabel(packetStatus)} / ${packetReadiness}%`} />
      <Field label="Follow-ups" value={openFollowUps === 0 ? "None" : `${openFollowUps} open`} />
      <Field label="Next action" value={nextAction} />
      <Field label="Payment" value={paymentLabel(caseItem.paymentStatus)} />

      <div className="flex justify-start lg:justify-end">
        <Link
          className="rounded-md border px-3 py-2 text-center text-sm"
          to="/annual-returns/$id"
          params={{ id: caseItem.id }}
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

function RiskPill({ risk }: { risk: AnnualReturnRiskLevel }) {
  return (
    <span className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${riskToneClass(risk)}`}>
      {riskLabel(risk)}
    </span>
  );
}

function riskSortValue(risk: AnnualReturnRiskLevel): number {
  return { overdue: 0, "due-soon": 1, blocked: 2, "ready-to-file": 3, healthy: 4, filed: 5 }[risk];
}

function riskLabel(risk: AnnualReturnRiskLevel): string {
  return {
    overdue: "Overdue",
    "due-soon": "Due soon",
    blocked: "Blocked",
    healthy: "Healthy",
    "ready-to-file": "Ready",
    filed: "Filed",
  }[risk];
}

function filterLabel(
  filter: "all" | "urgent" | "blocked" | "ready" | "packet-ready" | "needs-follow-up" | "filed",
): string {
  return {
    all: "All",
    urgent: "Urgent",
    blocked: "Blocked",
    ready: "Ready",
    "packet-ready": "Packet ready",
    "needs-follow-up": "Needs follow-up",
    filed: "Filed",
  }[filter];
}

function packetLabel(status: AnnualReturnPacketStatus): string {
  return {
    "not-started": "Not started",
    building: "Building",
    "ready-for-review": "Review",
    approved: "Approved",
    submitted: "Submitted",
    accepted: "Accepted",
  }[status];
}

function metricToneClass(tone: "red" | "orange" | "yellow" | "green" | "blue"): string {
  return {
    red: "bg-red-500",
    orange: "bg-orange-500",
    yellow: "bg-yellow-500",
    green: "bg-green-500",
    blue: "bg-blue-500",
  }[tone];
}

function riskToneClass(risk: AnnualReturnRiskLevel): string {
  return {
    overdue: "bg-red-100 text-red-700",
    "due-soon": "bg-orange-100 text-orange-700",
    blocked: "bg-yellow-100 text-yellow-800",
    healthy: "bg-slate-100 text-slate-700",
    "ready-to-file": "bg-green-100 text-green-700",
    filed: "bg-blue-100 text-blue-700",
  }[risk];
}

function paymentLabel(paymentStatus: AnnualReturnCase["paymentStatus"]): string {
  return {
    overdue: "Overdue",
    paid: "Paid",
    pending: "Pending",
  }[paymentStatus];
}

function formatDue(dueDate: string, dueInDays: number): string {
  if (dueInDays < 0) {
    return `${dueDate} (${Math.abs(dueInDays)}d overdue)`;
  }

  return `${dueDate} (${dueInDays}d)`;
}
