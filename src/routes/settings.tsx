import { createFileRoute } from "@tanstack/react-router";
import { TopBar } from "@/components/top-bar";
import { StatusPill } from "@/components/status-pill";
import { ClipboardList, Package, Shield, Bell, Plug } from "lucide-react";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Kossilon CoSec OS" },
      { name: "description", content: "Checklist templates, service packages, risk rules, reminder cadence, and WOZTELL integration." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <>
      <TopBar title="Settings" subtitle="Firm-wide configuration" />
      <main className="flex-1 space-y-6 p-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card icon={<ClipboardList className="h-4 w-4 text-primary" />} title="Checklist templates" desc="Required documents per service type">
            {["Annual return — Private Ltd", "Annual return — Public Ltd", "Incorporation — HK Ltd", "Change of director", "Deregistration"].map((t) => (
              <Row key={t} label={t} right={<StatusPill tone="green">Active</StatusPill>} />
            ))}
          </Card>

          <Card icon={<Package className="h-4 w-4 text-primary" />} title="Service packages" desc="Fee structure by tier">
            <Row label="Basic — HKD 2,800" right={<span className="text-xs text-muted-foreground">Filing only</span>} />
            <Row label="Standard — HKD 3,800" right={<span className="text-xs text-muted-foreground">Filing + 1 change</span>} />
            <Row label="Premium — HKD 5,200" right={<span className="text-xs text-muted-foreground">Full-service + advisory</span>} />
          </Card>

          <Card icon={<Shield className="h-4 w-4 text-primary" />} title="Risk rules" desc="Auto-flag high-risk cases">
            <Row label="Deadline < 3 days & docs incomplete" right={<StatusPill tone="red">High</StatusPill>} />
            <Row label="Payment overdue > 14 days" right={<StatusPill tone="orange">Medium</StatusPill>} />
            <Row label="Client unresponsive > 3 reminders" right={<StatusPill tone="yellow">Watch</StatusPill>} />
          </Card>

          <Card icon={<Bell className="h-4 w-4 text-primary" />} title="Reminder cadence" desc="Global default schedule">
            <Row label="First reminder" right={<span className="tabular-nums text-muted-foreground">-30 days</span>} />
            <Row label="Second reminder" right={<span className="tabular-nums text-muted-foreground">-14 days</span>} />
            <Row label="Third reminder" right={<span className="tabular-nums text-muted-foreground">-7 days</span>} />
            <Row label="Final reminder" right={<span className="tabular-nums text-muted-foreground">-2 days</span>} />
          </Card>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <Plug className="h-4 w-4 text-primary" />
            <h2 className="font-display text-base font-semibold text-foreground">WOZTELL WhatsApp API</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Connect your WOZTELL account to enable two-way WhatsApp messaging and automation.</p>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium text-foreground">API endpoint</span>
              <input defaultValue="https://api.woztell.com/v3" className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring" />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-foreground">Channel ID</span>
              <input placeholder="wa-channel-id" className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none" />
            </label>
            <label className="block md:col-span-2">
              <span className="text-xs font-medium text-foreground">API key</span>
              <input type="password" placeholder="••••••••••••••••" className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none" />
            </label>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <StatusPill tone="yellow">Not connected</StatusPill>
            <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">Test & save</button>
          </div>
        </div>
      </main>
    </>
  );
}

function Card({ icon, title, desc, children }: { icon: React.ReactNode; title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="font-display text-base font-semibold text-foreground">{title}</h2>
        </div>
        <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
      </div>
      <ul className="divide-y divide-border">{children}</ul>
    </div>
  );
}

function Row({ label, right }: { label: string; right: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between px-5 py-3 text-sm">
      <span className="font-medium text-foreground">{label}</span>
      {right}
    </li>
  );
}
