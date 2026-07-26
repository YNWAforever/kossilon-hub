import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CalendarClock,
  AlertTriangle,
  FileWarning,
  CreditCard,
  UserCheck,
  Flame,
  Sparkles,
  ArrowRight,
} from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { KpiCard } from "@/components/kpi-card";
import { DeadlinePill } from "@/components/deadline-pill";
import { StatusPill } from "@/components/status-pill";
import type { AnnualReturnCase, AnnualReturnStatus } from "@/features/annual-return/types";
import { useAuth } from "@/features/auth/auth-context-neon";
import { loadDashboardData, type DashboardData } from "@/features/dashboard/dashboard-data";
import { buildDailyDigest, digestTone, type DailyDigestItem } from "@/lib/daily-digest";
import type { StatusTone } from "@/lib/status";
import { formatDate } from "@/lib/mock-data";

export const Route = createFileRoute("/")({
  loader: () => loadDashboardData(),
  head: () => ({
    meta: [
      { title: "Dashboard — Kossilon CoSec OS" },
      {
        name: "description",
        content:
          "Annual return deadlines, overdue cases, missing documents, and payments at a glance.",
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
  } = Route.useLoaderData() as DashboardData;
  const m = {
    dueIn7: realMetrics.dueIn7,
    dueIn30: realMetrics.dueIn30,
    overdue: realMetrics.overdue,
    missingDocs: realMetrics.missingDocuments,
    paymentPending: realMetrics.paymentPending,
    myCases: realMetrics.assignedToMe,
  };
  const upcoming = upcomingAnnualReturns;
  // Enquiries and tasks still come from lib/mock-data, so they are withheld from the
  // digest: invented priority items on the landing page are worse than fewer real
  // ones, and their action links pointed at screens no longer in the navigation.
  // Restore these inputs once both read live data.
  const digest = buildDailyDigest({
    annualReturnCases: upcoming,
    enquiries: [],
    tasks: [],
    maxItems: 4,
  });

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader
        eyebrow="Operations"
        title="Dashboard"
        subtitle={`Good morning, ${session?.name.split(" ")[0] ?? "there"} — you have ${m.myCases} active cases.`}
      />

      {!annualReturnDataAvailable && (
        <section className="rounded-lg border border-status-yellow/40 bg-status-yellow-soft px-4 py-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 text-status-orange" />
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Annual return data is temporarily unavailable
              </h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Showing fallback annual-return KPI totals until the live query recovers.
              </p>
            </div>
          </div>
        </section>
      )}

      {/* KPI grid */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <KpiCard
          label="Due in 7 days"
          value={m.dueIn7}
          hint="Annual returns"
          icon={CalendarClock}
          tone="orange"
        />
        <KpiCard
          label="Due in 30 days"
          value={m.dueIn30}
          hint="Annual returns"
          icon={CalendarClock}
          tone="yellow"
        />
        <KpiCard
          label="Overdue cases"
          value={m.overdue}
          hint="Immediate action"
          icon={Flame}
          tone="red"
        />
        <KpiCard
          label="Missing documents"
          value={m.missingDocs}
          hint="Across all cases"
          icon={FileWarning}
          tone="yellow"
        />
        <KpiCard
          label="Payment pending"
          value={m.paymentPending}
          hint="Clients unpaid"
          icon={CreditCard}
          tone="orange"
        />
        <KpiCard
          label="Assigned to me"
          value={m.myCases}
          hint="Open cases"
          icon={UserCheck}
          tone="blue"
        />
      </section>

      <section className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="font-display text-base font-semibold text-foreground">
                AI daily digest
              </h2>
              <p className="text-xs text-muted-foreground">{digest.headline}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <StatusPill tone="red" className="!py-0.5 !text-[10px]">
              {digest.counts.critical} critical
            </StatusPill>
            <StatusPill tone="orange" className="!py-0.5 !text-[10px]">
              {digest.counts.high} high
            </StatusPill>
            <StatusPill tone="yellow" className="!py-0.5 !text-[10px]">
              {digest.counts.medium} medium
            </StatusPill>
          </div>
        </div>

        {digest.items.length === 0 ? (
          <div className="px-5 py-4 text-sm text-muted-foreground">
            No priority work detected from annual returns.
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {digest.items.map((item) => (
              <li key={item.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                <StatusPill tone={digestTone(item.severity)} className="capitalize">
                  {item.severity}
                </StatusPill>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-foreground">{item.title}</p>
                    <span className="text-[11px] capitalize text-muted-foreground">
                      {item.kind.replace("-", " ")}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p>
                </div>
                <DigestActionLink item={item} />
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
                Upcoming annual returns
              </h2>
              <p className="text-xs text-muted-foreground">Sorted by deadline</p>
            </div>
            <Link to="/annual-returns" className="text-xs font-medium text-primary hover:underline">
              View board →
            </Link>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Company</th>
                  <th className="px-5 py-3 font-medium">Deadline</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Owner</th>
                  <th className="px-5 py-3 font-medium">Next action</th>
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
                        {c.currentStatus}
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

      {/* Overdue banner */}
      <section>
        <div className="rounded-xl border border-status-red/30 bg-status-red-soft p-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-status-red" />
            <div>
              <h2 className="font-display text-base font-semibold text-status-red">
                Requires immediate attention
              </h2>
              <p className="mt-1 text-xs text-status-red/80">
                {m.overdue} annual returns are overdue. Assign or escalate now to avoid Companies
                Registry penalties.
              </p>
              <Link
                to="/annual-returns"
                className="mt-3 inline-flex items-center rounded-md bg-status-red px-3 py-1.5 text-xs font-medium text-white hover:bg-status-red/90"
              >
                Review overdue cases
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function DigestActionLink({ item }: { item: DailyDigestItem }) {
  const className =
    "inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent";

  switch (item.route.to) {
    case "/annual-returns/$id":
      return (
        <Link to="/annual-returns/$id" params={item.route.params} className={className}>
          {item.actionLabel} <ArrowRight className="h-3 w-3" />
        </Link>
      );
    case "/enquiries":
      return (
        <Link to="/enquiries" search={item.route.search} className={className}>
          {item.actionLabel} <ArrowRight className="h-3 w-3" />
        </Link>
      );
    case "/tasks":
    default:
      return (
        <Link to="/tasks" className={className}>
          {item.actionLabel} <ArrowRight className="h-3 w-3" />
        </Link>
      );
  }
}

function nextAnnualReturnAction(case_: AnnualReturnCase) {
  const missingRequired = case_.checklist.filter(
    (item) => item.required && item.status !== "Verified",
  ).length;

  if (missingRequired > 0) {
    return `${missingRequired} evidence ${missingRequired === 1 ? "item" : "items"} to verify`;
  }

  if (case_.payment?.status !== "Payment received") {
    return "Collect payment";
  }

  if (!case_.filingReference || !case_.confirmationDocumentId) {
    return "Record filing proof";
  }

  if (case_.currentStatus === "Completed") {
    return "Completed";
  }

  return "Ready to complete";
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
