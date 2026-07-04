import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { TopBar } from "@/components/top-bar";
import { StatusPill } from "@/components/status-pill";
import { DeadlinePill } from "@/components/deadline-pill";
import { Timeline } from "@/components/timeline";
import { cases, companies, formatDate, formatDateTime, type AnnualReturnCase, type Company, type ChecklistItem } from "@/lib/mock-data";
import { caseStatusTone } from "@/lib/status";
import { templateForService } from "@/lib/templates";
import { evaluateRisk, riskTone, type ScheduledReminder } from "@/lib/risk";
import { useEnquiryIdForCompany } from "@/lib/clients-store";
import { Check, FileText, Bell, Zap, Upload, ClipboardList, Shield, AlertTriangle, Sparkles, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/annual-returns/$id")({
  loader: ({ params }) => {
    const c = cases.find((c) => c.id === params.id);
    if (!c) throw notFound();
    const company = companies.find((co) => co.id === c.companyId);
    return { c, company };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: `${loaderData?.c.companyName ?? "Case"} — Annual Return` },
      { name: "description", content: "Annual return case checklist, required documents, reminders, and next action." },
    ],
  }),
  component: CaseDetailPage,
  notFoundComponent: () => (
    <div className="p-10 text-center text-muted-foreground">Case not found. <Link to="/annual-returns" className="text-primary underline">Back to board</Link></div>
  ),
});

function CaseDetailPage() {
  const { c, company } = Route.useLoaderData() as { c: AnnualReturnCase; company: Company | undefined };
  const missing = c.checklist.filter((i: ChecklistItem) => !i.received).length;
  const received = c.checklist.length - missing;
  const risk = evaluateRisk(c, company, "Annual Return — Private Ltd");
  const nextReminder = risk.reminders.find((r) => r.status === "scheduled");
  const enquiryId = useEnquiryIdForCompany(c.companyId);


  return (
    <>
      <TopBar
        title={c.companyName}
        subtitle={`Case ${c.id.toUpperCase()} · Due ${formatDate(c.dueDate)}`}
        actions={
          <div className="hidden md:flex items-center gap-2">
            <StatusPill tone={caseStatusTone(c.status)}>{c.status}</StatusPill>
            <DeadlinePill dueDate={c.dueDate} />
            <StatusPill tone={riskTone(risk.level)}>
              <Shield className="mr-1 inline h-3 w-3" />
              {risk.level} risk
            </StatusPill>
          </div>
        }
      />
      <main className="grid flex-1 grid-cols-1 gap-6 p-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Next action banner */}
          <div className="rounded-xl border border-primary/20 bg-accent p-5">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Zap className="h-4 w-4" />
              </div>
              <div className="flex-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Next action</p>
                <p className="mt-1 font-display text-lg font-semibold text-foreground">{c.nextAction}</p>
                <p className="mt-1 text-xs text-muted-foreground">Owner: {c.ownerName} · {c.remindersSent} reminders sent</p>
              </div>
              <button className="rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90">Mark done</button>
            </div>
          </div>

          {/* Progress */}
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Documents</p>
              <p className="mt-1 font-display text-2xl font-semibold text-foreground">{received}/{c.checklist.length}</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-status-green" style={{ width: `${(received / c.checklist.length) * 100}%` }} />
              </div>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Reminders sent</p>
              <p className="mt-1 font-display text-2xl font-semibold text-foreground">{c.remindersSent}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {nextReminder
                  ? `Next: ${nextReminder.label} in ${Math.max(0, nextReminder.daysBeforeDue)}d`
                  : "All reminders complete"}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Payment</p>
              <p className="mt-1 font-display text-2xl font-semibold text-foreground">{company?.paymentStatus}</p>
              <p className="mt-2 text-xs text-muted-foreground">HKD {company?.invoiceAmount.toLocaleString()}</p>
            </div>
          </div>

          {/* Risk & schedule */}
          <RiskAndSchedule risk={risk} />


          {/* Checklist */}
          <div className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <h2 className="font-display text-base font-semibold text-foreground">Document checklist</h2>
                {(() => {
                  const tpl = templateForService("Annual Return — Private Ltd");
                  return tpl ? (
                    <Link
                      to="/settings"
                      className="ml-2 inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                      title="Preloaded from template"
                    >
                      <ClipboardList className="h-3 w-3" />
                      Template: {tpl.name}
                    </Link>
                  ) : null;
                })()}
              </div>
              <button className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-accent">
                <Upload className="h-3 w-3" /> Upload
              </button>
            </div>
            <ul className="divide-y divide-border">
              {c.checklist.map((i: ChecklistItem) => (
                <li key={i.id} className="flex items-center justify-between px-5 py-3">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-full",
                      i.received ? "bg-status-green text-white" : "border-2 border-status-yellow bg-status-yellow-soft",
                    )}>
                      {i.received && <Check className="h-3.5 w-3.5" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">{i.label}</p>
                      {i.file && <p className="text-xs text-muted-foreground">{i.file}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {!i.received && i.requiredBy && (
                      <span className="text-xs text-muted-foreground">Due {formatDate(i.requiredBy)}</span>
                    )}
                    <StatusPill tone={i.received ? "green" : "yellow"}>
                      {i.received ? "Received" : "Missing"}
                    </StatusPill>
                    {!i.received && (
                      <button className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-accent">
                        <Bell className="h-3 w-3" /> Chase
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>

          {/* Staff notes */}
          <div className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-5 py-3">
              <h2 className="font-display text-base font-semibold text-foreground">Staff notes</h2>
            </div>
            <ul className="divide-y divide-border">
              {c.notes.map((n: { at: string; author: string; text: string }, i: number) => (
                <li key={i} className="px-5 py-3">
                  <p className="text-sm text-foreground">{n.text}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{n.author} · {formatDateTime(n.at)}</p>
                </li>
              ))}
            </ul>
            <div className="border-t border-border p-3">
              <textarea rows={2} placeholder="Add a note…" className="w-full resize-none rounded-md border border-border bg-background p-2 text-sm outline-none" />
            </div>
          </div>
        </div>

        <div>
          {company && <Timeline events={company.timeline} title="Case timeline" />}
        </div>
      </main>
    </>
  );
}

function RiskAndSchedule({ risk }: { risk: ReturnType<typeof evaluateRisk> }) {
  const tone = riskTone(risk.level);
  const bannerBg =
    tone === "red" ? "bg-status-red-soft border-status-red/30"
      : tone === "orange" ? "bg-status-orange-soft border-status-orange/30"
        : "bg-status-green-soft border-status-green/30";
  const bannerIcon =
    tone === "red" ? "text-status-red"
      : tone === "orange" ? "text-status-orange"
        : "text-status-green";

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className={cn("flex items-start gap-3 border-b border-border p-5", bannerBg)}>
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg bg-background", bannerIcon)}>
          <Shield className="h-4 w-4" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Risk assessment</p>
            <StatusPill tone={tone}>{risk.level}</StatusPill>
            {risk.template && (
              <Link to="/settings" className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                <ClipboardList className="h-3 w-3" /> {risk.template.name}
              </Link>
            )}
          </div>
          <p className="mt-1 font-display text-base font-semibold text-foreground">{risk.summary}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">
        {/* Triggered rules */}
        <div className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-primary" />
            <h3 className="font-display text-sm font-semibold text-foreground">Triggered rules</h3>
            <span className="text-xs text-muted-foreground">
              {risk.triggered.length}/{risk.template?.riskRules.filter((r) => r.enabled).length ?? 0}
            </span>
          </div>
          {risk.triggered.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No risk rules triggered. Monitoring {risk.template?.riskRules.filter((r) => r.enabled).length ?? 0} active rule(s).
            </p>
          ) : (
            <ul className="space-y-2">
              {risk.triggered.map((t) => (
                <li key={t.rule.id} className="rounded-md border border-border bg-background p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-foreground">{t.rule.label}</span>
                    <StatusPill tone={riskTone(t.rule.severity)}>{t.rule.severity}</StatusPill>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{t.reason}</p>
                </li>
              ))}
            </ul>
          )}

          {/* Escalations */}
          <div className="mt-5">
            <div className="mb-2 flex items-center gap-2">
              <ArrowUpRight className="h-4 w-4 text-primary" />
              <h3 className="font-display text-sm font-semibold text-foreground">Escalation path</h3>
            </div>
            <ol className="space-y-1.5">
              {risk.escalations.map((e, i) => (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-muted-foreground">
                    {i + 1}
                  </span>
                  <div>
                    <p className="font-medium text-foreground">{e.actor}</p>
                    <p className="text-muted-foreground">{e.when} · {e.action}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* Reminder schedule */}
        <div className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Bell className="h-4 w-4 text-primary" />
            <h3 className="font-display text-sm font-semibold text-foreground">Reminder cadence</h3>
            <span className="ml-auto text-[11px] text-muted-foreground">
              {risk.reminders.filter((r) => r.source === "risk-boost").length > 0
                ? "Boosted by risk"
                : "Template default"}
            </span>
          </div>
          {risk.reminders.length === 0 ? (
            <p className="text-xs text-muted-foreground">No reminders configured in the template.</p>
          ) : (
            <ul className="space-y-1.5">
              {risk.reminders.map((r) => (
                <ReminderRow key={r.id} r={r} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function ReminderRow({ r }: { r: ScheduledReminder }) {
  const statusTone =
    r.status === "sent" ? "green" : r.status === "overdue" ? "red" : "yellow";
  const whenLabel =
    r.daysBeforeDue > 0
      ? `T-${r.daysBeforeDue}d`
      : r.daysBeforeDue === 0
        ? "Today"
        : `+${Math.abs(r.daysBeforeDue)}d overdue`;
  return (
    <li className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2">
      <div className="flex items-center gap-2">
        {r.source === "risk-boost" ? (
          <Sparkles className="h-3.5 w-3.5 text-status-orange" />
        ) : (
          <Bell className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <div>
          <p className="text-sm font-medium text-foreground">{r.label}</p>
          <p className="text-[11px] text-muted-foreground">
            {r.channel} · {whenLabel}
            {r.source === "risk-boost" && " · auto-added"}
          </p>
        </div>
      </div>
      <StatusPill tone={statusTone}>{r.status}</StatusPill>
    </li>
  );
}

