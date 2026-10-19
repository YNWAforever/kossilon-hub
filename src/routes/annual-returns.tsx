import { RiskPill } from "@/features/annual-return/components/risk-pill";
import { Input, Select } from "@/components/ui/field";
import { pageTitle } from "@/lib/page-title";
import { type ReactNode, useMemo, useState } from "react";
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
import { formatDate, formatDueDate } from "../lib/format-date";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ProductionAnnualReturnCommandCenter } from "../features/annual-return/components/production-command-center";
import { boardSearchFromUrl } from "../features/annual-return/board-filters";

export const Route = createFileRoute("/annual-returns")({
  head: () => ({ meta: [{ title: pageTitle("周年申報") }] }),
  // Board filters live in the URL so they survive a reload and a return from a
  // detail screen. The sanitiser is in board-filters.ts so it can be unit-tested;
  // a route file cannot export a non-component without tripping react-refresh.
  validateSearch: boardSearchFromUrl,
  component: AnnualReturnsRoute,
});

function AnnualReturnsRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { dataMode, actor } = Route.useRouteContext();
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
      actorScope={actor}
      allowFixtureDiagnostics={actor?.active === true && actor.role === "Admin"}
      search={search}
      onSearchChange={(next) => void navigate({ search: next, replace: true })}
    />
  );
}

function DemoAnnualReturnCommandCenter() {
  const cases = useAnnualReturnCases();
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
        eyebrow="案件與客戶"
        title="周年申報"
        actions={
          <Button asChild>
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
            >
              開啟工作隊列
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        <Metric label="已逾期" value={metrics.overdue} tone="red" />
        <Metric label="即將到期" value={metrics.dueSoon} tone="orange" />
        <Metric label="受阻" value={metrics.blocked} tone="yellow" />
        <Metric label="可遞交" value={metrics.readyToFile} tone="green" />
        <Metric label="已遞交" value={metrics.filed} tone="blue" />
      </div>

      <section className="rounded-lg border bg-card">
        <div className="grid gap-3 border-b p-4 lg:grid-cols-[1fr_auto_auto]">
          <Input
            className="w-full"
            aria-label="搜尋公司或聯絡人"
            placeholder="搜尋公司或聯絡人"
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
              <Button
                key={value}
                variant={filter === value ? "primary" : "outline"}
                size="sm"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {filterLabel(value)}
              </Button>
            ))}
          </div>
          <Select
            className="w-full"
            value={owner}
            onChange={(event) => setOwner(event.target.value)}
            aria-label="按負責同事篩選"
          >
            <option value="all">全部負責同事</option>
            {owners.map((ownerName) => (
              <option key={ownerName} value={ownerName}>
                {ownerName}
              </option>
            ))}
          </Select>
        </div>

        <div className="overflow-x-auto">
          <div className={CASE_GRID_MIN_WIDTH}>
            <div
              className={`hidden gap-3 border-b px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:grid ${CASE_GRID_COLUMNS}`}
            >
              <span>公司</span>
              <span>負責同事</span>
              <span>到期日</span>
              <span>進度</span>
              <span>未完成事項</span>
              <span>下一步</span>
              <span className="text-right">開啟</span>
            </div>

            <div className="divide-y">
              {visibleCases.map((caseItem) => (
                <CaseRow key={caseItem.id} caseItem={caseItem} />
              ))}
              {visibleCases.length === 0 ? (
                <div className="px-4 py-8 text-sm text-muted-foreground">
                  沒有符合篩選條件的周年申報案件。
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
// Related facts share a column (risk over due date, case over packet, blockers
// over follow-ups, next action over payment) so the tracks, six 12px gaps and
// row padding fit the ~960px content area of a 1280px laptop beside the
// sidebar. Narrower `lg` widths still get an `overflow-x-auto` container, so
// the board scrolls sideways rather than drawing cells on top of each other.
//
// The floors matter as much as the fixed widths. With `minmax(0, 1.4fr)` the
// company and next-action columns could be squeezed to nothing, which is what
// let their text escape the grid in the first place.
const CASE_GRID_COLUMNS =
  "lg:grid-cols-[minmax(180px,1.6fr)_96px_136px_116px_minmax(140px,1fr)_minmax(140px,1.2fr)_72px]";
const CASE_GRID_MIN_WIDTH = "lg:min-w-[952px]";

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

function CaseRow({ caseItem }: { caseItem: AnnualReturnCase }) {
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
      ? null
      : blockers.length === 1
        ? blockers[0].label
        : `${blockers[0].label} +${blockers.length - 1}`;

  return (
    <div className={`grid grid-cols-2 gap-3 px-4 py-4 lg:items-center ${CASE_GRID_COLUMNS}`}>
      <div className="col-span-2 min-w-0 lg:col-span-1">
        <p className="font-medium leading-5 [overflow-wrap:anywhere]">{caseItem.companyName}</p>
        <p className="truncate text-sm text-muted-foreground">{caseItem.contactName}</p>
      </div>

      <Field label="負責同事" value={caseItem.owner} />
      <Field
        label="到期日"
        value={
          <div className="space-y-1">
            <RiskPill risk={risk} />
            <p className="text-xs text-muted-foreground">
              {risk === "filed"
                ? `${formatDate(caseItem.dueDate)} · 已遞交`
                : formatDueDate(caseItem.dueDate, dueInDays)}
            </p>
          </div>
        }
      />
      <Field
        label="進度"
        value={
          <div>
            <p>案件 {readiness}%</p>
            <p className="text-xs text-muted-foreground">
              交件套件：{packetLabel(packetStatus)}
              {packetReadiness > 0 && packetReadiness < 100 ? ` · ${packetReadiness}%` : ""}
            </p>
          </div>
        }
      />
      <Field
        label="未完成事項"
        value={
          <div className="min-w-0">
            <p className="truncate" title={blockerSummary ?? "沒有阻礙事項"}>
              {blockerSummary ?? "沒有阻礙事項"}
            </p>
            <p className="text-xs text-muted-foreground">
              {openFollowUps === 0 ? "沒有待跟進" : `${openFollowUps} 項待跟進`}
            </p>
          </div>
        }
      />
      <Field
        label="下一步"
        className="col-span-2 lg:col-span-1"
        value={
          <div>
            <p>{nextAction}</p>
            <p
              className={`text-xs ${caseItem.paymentStatus === "overdue" ? "font-medium text-red-700" : "text-muted-foreground"}`}
            >
              付款：{paymentLabel(caseItem.paymentStatus)}
            </p>
          </div>
        }
      />

      <div className="col-span-2 flex justify-start lg:col-span-1 lg:justify-end">
        <Button asChild>
          <Link
            aria-label={`開啟 ${caseItem.companyName}`}
            to="/annual-returns/$id"
            params={{ id: caseItem.id }}
          >
            開啟
          </Link>
        </Button>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  className,
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={className ? `min-w-0 ${className}` : "min-w-0"}>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:hidden">
        {label}
      </p>
      <div className="text-sm leading-5">{value}</div>
    </div>
  );
}

function riskSortValue(risk: AnnualReturnRiskLevel): number {
  return { overdue: 0, "due-soon": 1, blocked: 2, "ready-to-file": 3, healthy: 4, filed: 5 }[risk];
}

function filterLabel(
  filter: "all" | "urgent" | "blocked" | "ready" | "packet-ready" | "needs-follow-up" | "filed",
): string {
  return {
    all: "全部",
    urgent: "緊急",
    blocked: "受阻",
    ready: "可遞交",
    "packet-ready": "交件套件就緒",
    "needs-follow-up": "需要跟進",
    filed: "已遞交",
  }[filter];
}

function packetLabel(status: AnnualReturnPacketStatus): string {
  return {
    "not-started": "未開始",
    building: "準備中",
    "ready-for-review": "待覆核",
    approved: "已批准",
    submitted: "已提交",
    accepted: "已接納",
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

function paymentLabel(paymentStatus: AnnualReturnCase["paymentStatus"]): string {
  return {
    overdue: "逾期未付",
    paid: "已付款",
    pending: "待付款",
  }[paymentStatus];
}
