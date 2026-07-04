import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CalendarClock,
  AlertTriangle,
  FileWarning,
  CreditCard,
  MessageCircle,
  UserCheck,
  Flame,
  Users,
} from "lucide-react";
import { TopBar } from "@/components/top-bar";
import { KpiCard } from "@/components/kpi-card";
import { DeadlinePill } from "@/components/deadline-pill";
import { StatusPill } from "@/components/status-pill";
import { caseStatusTone } from "@/lib/status";
import {
  dashboardMetrics,
  upcomingCases,
  teamWorkloadRows,
  enquiries,
  currentUser,
  formatDate,
} from "@/lib/mock-data";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — Kossilon CoSec OS" },
      { name: "description", content: "Deadlines, overdue cases, pending documents, payments, WhatsApp enquiries, and team workload at a glance." },
    ],
  }),
  component: DashboardPage,
});

function DashboardPage() {
  const m = dashboardMetrics();
  const upcoming = upcomingCases();
  const workload = teamWorkloadRows();
  const todaysEnquiries = enquiries.slice(0, 5);

  return (
    <>
      <TopBar title="Dashboard" subtitle={`Good morning, ${currentUser.name.split(" ")[0]} — you have ${m.myCases} active cases.`} />

      <main className="flex-1 space-y-6 p-6">
        {/* KPI grid */}
        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <KpiCard label="Due in 7 days" value={m.dueIn7} hint="Annual returns" icon={CalendarClock} tone="orange" />
          <KpiCard label="Due in 30 days" value={m.dueIn30} hint="Annual returns" icon={CalendarClock} tone="yellow" />
          <KpiCard label="Overdue cases" value={m.overdue} hint="Immediate action" icon={Flame} tone="red" />
          <KpiCard label="Missing documents" value={m.missingDocs} hint="Across all cases" icon={FileWarning} tone="yellow" />
          <KpiCard label="Payment pending" value={m.paymentPending} hint="Clients unpaid" icon={CreditCard} tone="orange" />
          <KpiCard label="WhatsApp today" value={m.whatsappToday} hint="Enquiries + replies" icon={MessageCircle} tone="green" />
          <KpiCard label="Assigned to me" value={m.myCases} hint="Open cases" icon={UserCheck} tone="blue" />
          <KpiCard label="Team workload" value={m.teamWorkload} hint="Clients across team" icon={Users} tone="neutral" />
        </section>

        {/* Upcoming AR table */}
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="font-display text-base font-semibold text-foreground">Upcoming annual returns</h2>
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
                        <Link to="/annual-returns/$id" params={{ id: c.id }} className="font-medium text-foreground hover:text-primary">
                          {c.companyName}
                        </Link>
                        <div className="text-xs text-muted-foreground">{formatDate(c.dueDate)}</div>
                      </td>
                      <td className="px-5 py-3"><DeadlinePill dueDate={c.dueDate} /></td>
                      <td className="px-5 py-3"><StatusPill tone={caseStatusTone(c.status)}>{c.status}</StatusPill></td>
                      <td className="px-5 py-3 text-muted-foreground">{c.ownerName}</td>
                      <td className="px-5 py-3 text-xs text-muted-foreground">{c.nextAction}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Team workload panel */}
          <div className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-5 py-4">
              <h2 className="font-display text-base font-semibold text-foreground">Team workload</h2>
              <p className="text-xs text-muted-foreground">Active cases & overdue</p>
            </div>
            <ul className="divide-y divide-border">
              {workload.map((m) => {
                const pct = Math.min(100, (m.activeCases / 6) * 100);
                return (
                  <li key={m.id} className="px-5 py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sand text-xs font-semibold text-white">
                          {m.initials}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{m.name}</p>
                          <p className="text-[11px] text-muted-foreground">{m.role} · {m.team}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold tabular-nums text-foreground">{m.activeCases}</p>
                        {m.overdue > 0 && (
                          <p className="text-[11px] font-medium text-status-red">{m.overdue} overdue</p>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-taupe" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </section>

        {/* Today's enquiries + overdue banner */}
        <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="font-display text-base font-semibold text-foreground">WhatsApp enquiries today</h2>
                <p className="text-xs text-muted-foreground">AI-classified intent</p>
              </div>
              <Link to="/whatsapp" className="text-xs font-medium text-primary hover:underline">Open inbox →</Link>
            </div>
            <ul className="divide-y divide-border">
              {todaysEnquiries.map((e) => (
                <li key={e.id} className="flex items-start gap-3 px-5 py-3 hover:bg-muted/30">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-status-green-soft text-xs font-semibold text-status-green">
                    {e.contactName.split(" ").map((n) => n[0]).join("")}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{e.contactName}</p>
                      <StatusPill tone="blue" className="!py-0.5 !text-[10px]">{e.intent}</StatusPill>
                      {e.unread > 0 && (
                        <span className="rounded-full bg-status-green px-1.5 text-[10px] font-semibold text-white">{e.unread}</span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{e.lastMessage}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-status-red/30 bg-status-red-soft p-5">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-status-red" />
              <div>
                <h2 className="font-display text-base font-semibold text-status-red">Requires immediate attention</h2>
                <p className="mt-1 text-xs text-status-red/80">{m.overdue} annual returns are overdue. Assign or escalate now to avoid Companies Registry penalties.</p>
                <Link to="/annual-returns" className="mt-3 inline-flex items-center rounded-md bg-status-red px-3 py-1.5 text-xs font-medium text-white hover:bg-status-red/90">
                  Review overdue cases
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    </>
  );
}
