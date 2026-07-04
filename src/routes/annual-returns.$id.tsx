import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { TopBar } from "@/components/top-bar";
import { StatusPill } from "@/components/status-pill";
import { DeadlinePill } from "@/components/deadline-pill";
import { Timeline } from "@/components/timeline";
import { cases, companies, formatDate, formatDateTime, type AnnualReturnCase, type Company, type ChecklistItem } from "@/lib/mock-data";
import { caseStatusTone } from "@/lib/status";
import { templateForService } from "@/lib/templates";
import { Check, FileText, Bell, Zap, Upload, ClipboardList } from "lucide-react";
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

  return (
    <>
      <TopBar
        title={c.companyName}
        subtitle={`Case ${c.id.toUpperCase()} · Due ${formatDate(c.dueDate)}`}
        actions={
          <div className="hidden md:flex items-center gap-2">
            <StatusPill tone={caseStatusTone(c.status)}>{c.status}</StatusPill>
            <DeadlinePill dueDate={c.dueDate} />
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
              <p className="mt-2 text-xs text-muted-foreground">Next auto-reminder in 2 days</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Payment</p>
              <p className="mt-1 font-display text-2xl font-semibold text-foreground">{company?.paymentStatus}</p>
              <p className="mt-2 text-xs text-muted-foreground">HKD {company?.invoiceAmount.toLocaleString()}</p>
            </div>
          </div>

          {/* Checklist */}
          <div className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                <h2 className="font-display text-base font-semibold text-foreground">Document checklist</h2>
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
