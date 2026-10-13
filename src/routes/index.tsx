import { pageTitle } from "@/lib/page-title";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CalendarClock,
  AlertTriangle,
  FileWarning,
  CreditCard,
  UserCheck,
  Flame,
  ListChecks,
  ArrowRight,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/kpi-card";
import { DeadlinePill } from "@/components/deadline-pill";
import { StatusPill } from "@/components/status-pill";
import type { AnnualReturnStatus } from "@/features/annual-return/types";
import { useAuth } from "@/features/auth/auth-context-neon";
import {
  loadDashboardData,
  dashboardActorScopeKey,
  dashboardDataForActor,
  type DashboardData,
} from "@/features/dashboard/dashboard-data";
import { demoDashboardDependencies } from "@/features/dashboard/demo-dashboard-data";
import type { DashboardCase } from "@/features/dashboard/types";
import { annualReturnStatusLabel } from "@/features/annual-return/labels";
import {
  buildDailyDigest,
  DAILY_DIGEST_KIND_LABELS,
  DAILY_DIGEST_SEVERITY_LABELS,
  digestTone,
  type DailyDigestItem,
} from "@/lib/daily-digest";
import type { StatusTone } from "@/lib/status";
import { formatDate } from "@/lib/format-date";

export const Route = createFileRoute("/")({
  loader: async ({ context }) => ({
    ...(await loadDashboardData(
      context.dataMode === "demo" ? demoDashboardDependencies : undefined,
    )),
    actorScopeKey: dashboardActorScopeKey(context.actor),
  }),
  head: () => ({
    meta: [
      { title: pageTitle("總覽") },
      {
        name: "description",
        content: "周年申報到期日、已逾期案件、欠缺文件及付款狀況一覽。",
      },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const { session } = useAuth();
  const {
    metrics: realMetrics,
    upcomingAnnualReturns,
    annualReturnDataAvailable,
    annualReturnDataError,
    annualReturnDataErrorKind,
  } = dashboardDataForActor(Route.useLoaderData() as DashboardData, Route.useRouteContext().actor);
  const m = {
    dueIn7: realMetrics.dueIn7,
    dueIn30: realMetrics.dueIn30,
    overdue: realMetrics.overdueCases,
    missingDocs: realMetrics.missingDocumentCount,
    paymentPending: realMetrics.paymentPending,
    myCases: realMetrics.assignedToMe,
  };
  const upcoming = upcomingAnnualReturns;
  const firstName = session?.name.split(" ")[0];
  const greeting = firstName ? `早晨，${firstName}` : "早晨";
  const digest = buildDailyDigest({
    annualReturnCases: upcoming,
    maxItems: 4,
  });

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader
        eyebrow="今日工作"
        title="總覽"
        subtitle={
          annualReturnDataAvailable
            ? `${greeting}。你有 ${m.myCases} 宗進行中的案件。`
            : `${greeting}。`
        }
      />

      {!annualReturnDataAvailable && (
        <section className="rounded-lg border border-status-yellow/40 bg-status-yellow-soft px-4 py-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-status-orange-text" />
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {annualReturnDataErrorKind === "forbidden"
                  ? "你沒有權限查看周年申報資料"
                  : "周年申報資料暫時無法載入"}
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {annualReturnDataErrorKind === "forbidden"
                  ? "請重新登入，或請管理員開通同事權限。"
                  : "即時查詢恢復前，周年申報數字會暫時隱藏。"}
              </p>
              {annualReturnDataError && (
                <p className="mt-1 text-xs text-muted-foreground/80">{annualReturnDataError}</p>
              )}
            </div>
          </div>
        </section>
      )}

      {/* KPI grid */}
      <section data-testid="kpi-grid" className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard
          label="7 日內到期"
          value={m.dueIn7}
          hint="周年申報"
          icon={CalendarClock}
          tone="orange"
          unavailable={!annualReturnDataAvailable}
        />
        <KpiCard
          label="30 日內到期"
          value={m.dueIn30}
          hint="周年申報"
          icon={CalendarClock}
          tone="yellow"
          unavailable={!annualReturnDataAvailable}
        />
        <KpiCard
          label="已逾期案件"
          value={m.overdue}
          hint="需即時處理"
          icon={Flame}
          tone="red"
          unavailable={!annualReturnDataAvailable}
        />
        <KpiCard
          label="待核對文件（份）"
          value={m.missingDocs}
          hint="目前授權範圍；包括已收但未覆核"
          icon={FileWarning}
          tone="yellow"
          unavailable={!annualReturnDataAvailable}
        />
        <KpiCard
          label="待付款"
          value={m.paymentPending}
          hint="客戶未付款"
          icon={CreditCard}
          tone="orange"
          unavailable={!annualReturnDataAvailable}
        />
        <KpiCard
          label="分配給我"
          value={m.myCases}
          hint="進行中案件"
          icon={UserCheck}
          tone="blue"
          unavailable={!annualReturnDataAvailable}
        />
      </section>

      <section className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
              <ListChecks className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="font-display text-base font-semibold text-foreground">優先處理</h2>
              <p className="text-xs text-muted-foreground">{digest.headline}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                按申報到期日、風險程度及欠缺的必要文件排序；案件資料不經任何 AI 模型處理。
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <StatusPill tone="red" className="!py-0.5 !text-[10px]">
              {digest.counts.critical} 項{DAILY_DIGEST_SEVERITY_LABELS.critical}
            </StatusPill>
            <StatusPill tone="orange" className="!py-0.5 !text-[10px]">
              {digest.counts.high} 項{DAILY_DIGEST_SEVERITY_LABELS.high}
            </StatusPill>
            <StatusPill tone="yellow" className="!py-0.5 !text-[10px]">
              {digest.counts.medium} 項{DAILY_DIGEST_SEVERITY_LABELS.medium}
            </StatusPill>
          </div>
        </div>

        {digest.items.length === 0 ? (
          <div className="px-5 py-4 text-sm text-muted-foreground">
            周年申報暫無需要優先處理的工作。
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {digest.items.map((item) => (
              // Phones put severity and action on one line and give the title the
              // full width below; three columns left about a word per line.
              <li
                key={item.id}
                className="grid grid-cols-[auto_auto] items-start justify-between gap-x-3 gap-y-2 px-5 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]"
              >
                <StatusPill tone={digestTone(item.severity)} className="justify-self-start">
                  {DAILY_DIGEST_SEVERITY_LABELS[item.severity]}
                </StatusPill>
                <div className="col-span-2 row-start-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{item.title}</p>
                    <span className="text-[11px] text-muted-foreground">
                      {DAILY_DIGEST_KIND_LABELS[item.kind]}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p>
                </div>
                <div className="col-start-2 row-start-1 justify-self-end sm:col-start-3">
                  <DigestActionLink item={item} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Upcoming AR table */}
      <section className="grid grid-cols-1 gap-6">
        <div className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="font-display text-base font-semibold text-foreground">
                即將到期的周年申報
              </h2>
              <p className="text-xs text-muted-foreground">按到期日排序</p>
            </div>
            <Button asChild variant="link" className="text-xs">
              <Link to="/annual-returns">開啟案件板 →</Link>
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">公司</th>
                  <th className="px-5 py-3 font-medium">到期日</th>
                  <th className="px-5 py-3 font-medium">狀態</th>
                  <th className="px-5 py-3 font-medium">負責同事</th>
                  <th className="px-5 py-3 font-medium">下一步</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {upcoming.map((c) => (
                  <tr key={c.id} className="hover:bg-muted/30">
                    <td className="px-5 py-3">
                      <Link
                        to="/annual-returns/$id"
                        params={{ id: c.id }}
                        className="font-medium text-foreground hover:text-primary"
                      >
                        {c.companyName}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {formatDate(c.filingDueDate)}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <DeadlinePill dueDate={c.filingDueDate} />
                    </td>
                    <td className="px-5 py-3">
                      <StatusPill tone={annualReturnStatusTone(c.currentStatus)}>
                        {annualReturnStatusLabel(c.currentStatus)}
                      </StatusPill>
                    </td>
                    <td className="px-5 py-3 text-muted-foreground">{c.ownerName}</td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">
                      {nextAnnualReturnAction(c)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* Overdue banner.

          It used to render unconditionally, so with nothing overdue it said, in
          full red alarm styling, "0 annual returns are overdue". A banner that
          shouts on a quiet day teaches people to ignore it on a loud one, which
          costs exactly the Companies Registry penalties it exists to prevent.

          Three states, because "none overdue" and "we could not count" are not
          the same thing and only one of them is good news. */}
      {!annualReturnDataAvailable ? (
        <section>
          <div className="rounded-xl border border-status-yellow/30 bg-status-yellow-soft p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-status-yellow-text" />
              <div>
                <h2 className="font-display text-base font-semibold text-status-yellow-text">
                  已逾期數目無法載入
                </h2>
                <p className="mt-1 text-xs text-status-yellow-text">
                  這不代表沒有逾期案件，請開啟案件板直接核對。
                </p>
                <Button
                  asChild
                  size="sm"
                  className="mt-3 border-status-yellow text-status-yellow-text"
                >
                  <Link to="/annual-returns">開啟案件板</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      ) : m.overdue > 0 ? (
        <section>
          <div className="rounded-xl border border-status-red/30 bg-status-red-soft p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-status-red-text" />
              <div>
                <h2 className="font-display text-base font-semibold text-status-red-text">
                  需即時處理
                </h2>
                <p className="mt-1 text-xs text-status-red-text">
                  {`${m.overdue} 宗周年申報已逾期。請立即分配或升級處理，以免被公司註冊處罰款。`}
                </p>
                <Button asChild variant="destructive" size="sm" className="mt-3">
                  <Link to="/annual-returns">查看已逾期案件</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section>
          <div className="rounded-xl border bg-card p-5">
            <p className="text-sm text-muted-foreground">
              沒有已逾期案件。即將到期的案件可在周年申報案件板查看。
            </p>
          </div>
        </section>
      )}
    </main>
  );
}

function DigestActionLink({ item }: { item: DailyDigestItem }) {
  return (
    <Button asChild size="sm" className="gap-1">
      <Link to={item.route.to} params={item.route.params}>
        {item.actionLabel} <ArrowRight className="h-3 w-3" />
      </Link>
    </Button>
  );
}

function nextAnnualReturnAction(case_: DashboardCase) {
  const missingRequired = case_.checklist.filter(
    (item) => item.required && item.status !== "Verified",
  ).length;

  if (missingRequired > 0) {
    return `${missingRequired} 項證明文件待核對`;
  }

  if (case_.payment?.status !== "Payment received") {
    return "收取付款";
  }

  if (!case_.filingReference || !case_.confirmationDocumentId) {
    return "記錄遞交證明";
  }

  if (case_.currentStatus === "Completed") {
    return "已完成";
  }

  return "可完成結案";
}

function annualReturnStatusTone(status: AnnualReturnStatus): StatusTone {
  switch (status) {
    case "Upcoming":
    case "Filed":
    case "Completed":
      return "blue";
    case "Client reminder sent":
    case "Documents received":
    case "Payment received":
    case "NAR1 prepared":
    case "Ready to file":
      return "green";
    case "Documents pending":
    case "Signature pending":
      return "yellow";
    case "Payment pending":
      return "orange";
    default:
      return "neutral";
  }
}
