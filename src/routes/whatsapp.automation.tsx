import { createFileRoute } from "@tanstack/react-router";
import { TopBar } from "@/components/top-bar";
import { StatusPill } from "@/components/status-pill";
import { Bell, Zap, MessageSquare, Play, Pause } from "lucide-react";

const templates = [
  {
    id: "t1",
    name: "AR reminder — 30 days",
    trigger: "30 days before deadline",
    channel: "WhatsApp",
    status: "Active",
  },
  {
    id: "t2",
    name: "AR reminder — 14 days",
    trigger: "14 days before deadline",
    channel: "WhatsApp",
    status: "Active",
  },
  {
    id: "t3",
    name: "AR reminder — 7 days",
    trigger: "7 days before deadline",
    channel: "WhatsApp",
    status: "Active",
  },
  {
    id: "t4",
    name: "AR overdue escalation",
    trigger: "Manager alert on overdue",
    channel: "WhatsApp + Email",
    status: "Active",
  },
  {
    id: "t5",
    name: "Payment reminder",
    trigger: "3 days after invoice",
    channel: "WhatsApp",
    status: "Active",
  },
  {
    id: "t6",
    name: "Payment overdue",
    trigger: "10 days after invoice",
    channel: "WhatsApp + Email",
    status: "Active",
  },
  { id: "t7", name: "Document request", trigger: "Manual", channel: "WhatsApp", status: "Draft" },
  {
    id: "t8",
    name: "Signature reminder",
    trigger: "48h after NAR1 sent",
    channel: "WhatsApp",
    status: "Paused",
  },
];

const escalationRules = [
  { id: "r1", label: "3 unanswered reminders → notify assigned staff" },
  { id: "r2", label: "5 unanswered reminders → escalate to team manager" },
  { id: "r3", label: "Deadline < 3 days & documents pending → mark High Risk" },
  { id: "r4", label: "Payment overdue > 14 days → pause new work" },
];

const logs = [
  { at: "09:12", to: "Harbour Trading Ltd", template: "AR reminder — 7 days", result: "Delivered" },
  { at: "09:03", to: "Kowloon Textiles Ltd", template: "Payment reminder", result: "Read" },
  { at: "08:55", to: "Wanchai Foods Ltd", template: "Signature reminder", result: "Delivered" },
  { at: "08:41", to: "Nathan Road Retail Ltd", template: "Payment overdue", result: "Failed" },
  { at: "08:22", to: "Central Fintech Ltd", template: "Document request", result: "Read" },
];

export const Route = createFileRoute("/whatsapp/automation")({
  head: () => ({
    meta: [
      { title: "WhatsApp Automation — Kossilon CoSec OS" },
      {
        name: "description",
        content: "Templates, reminder schedules, escalation rules, and message logs.",
      },
    ],
  }),
  component: AutomationPage,
});

function AutomationPage() {
  return (
    <>
      <TopBar
        title="WhatsApp Automation"
        subtitle="Templates, cadence, escalations, and delivery logs"
      />
      <main className="grid flex-1 grid-cols-1 gap-6 p-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-primary" />
                <h2 className="font-display text-base font-semibold text-foreground">Templates</h2>
              </div>
              <button className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90">
                New template
              </button>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Name</th>
                  <th className="px-5 py-3 font-medium">Trigger</th>
                  <th className="px-5 py-3 font-medium">Channel</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {templates.map((t) => (
                  <tr key={t.id} className="hover:bg-muted/30">
                    <td className="px-5 py-3 font-medium text-foreground">{t.name}</td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">{t.trigger}</td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">{t.channel}</td>
                    <td className="px-5 py-3">
                      <StatusPill
                        tone={
                          t.status === "Active"
                            ? "green"
                            : t.status === "Paused"
                              ? "yellow"
                              : "neutral"
                        }
                      >
                        {t.status}
                      </StatusPill>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent">
                        {t.status === "Active" ? (
                          <Pause className="h-3 w-3" />
                        ) : (
                          <Play className="h-3 w-3" />
                        )}
                        {t.status === "Active" ? "Pause" : "Enable"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border border-border bg-card">
            <div className="flex items-center gap-2 border-b border-border px-5 py-3">
              <Bell className="h-4 w-4 text-primary" />
              <h2 className="font-display text-base font-semibold text-foreground">
                Recent message log
              </h2>
            </div>
            <ul className="divide-y divide-border">
              {logs.map((l, i) => (
                <li key={i} className="flex items-center justify-between px-5 py-3 text-sm">
                  <div>
                    <p className="font-medium text-foreground">{l.to}</p>
                    <p className="text-xs text-muted-foreground">
                      {l.template} · {l.at}
                    </p>
                  </div>
                  <StatusPill
                    tone={l.result === "Failed" ? "red" : l.result === "Read" ? "green" : "blue"}
                  >
                    {l.result}
                  </StatusPill>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              <h2 className="font-display text-base font-semibold text-foreground">
                Escalation rules
              </h2>
            </div>
            <ul className="mt-3 space-y-2">
              {escalationRules.map((r) => (
                <li
                  key={r.id}
                  className="rounded-md border border-border bg-background p-3 text-sm text-foreground"
                >
                  {r.label}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <h2 className="font-display text-base font-semibold text-foreground">
              Reminder cadence
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Default schedule for annual return cases
            </p>
            <ol className="mt-4 space-y-3 text-sm">
              <li className="flex items-center justify-between">
                <span>First reminder</span>
                <span className="tabular-nums text-muted-foreground">-30 days</span>
              </li>
              <li className="flex items-center justify-between">
                <span>Second reminder</span>
                <span className="tabular-nums text-muted-foreground">-14 days</span>
              </li>
              <li className="flex items-center justify-between">
                <span>Third reminder</span>
                <span className="tabular-nums text-muted-foreground">-7 days</span>
              </li>
              <li className="flex items-center justify-between">
                <span>Final reminder</span>
                <span className="tabular-nums text-muted-foreground">-2 days</span>
              </li>
              <li className="flex items-center justify-between text-status-red">
                <span>Overdue escalation</span>
                <span className="tabular-nums">+1 day</span>
              </li>
            </ol>
          </div>
        </div>
      </main>
    </>
  );
}
