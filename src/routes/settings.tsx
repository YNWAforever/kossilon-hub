import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { TopBar } from "@/components/top-bar";
import { StatusPill } from "@/components/status-pill";
import {
  ClipboardList,
  Package,
  Plug,
  Plus,
  Copy,
  Trash2,
  FileText,
  Bell,
  Shield,
  Search,
} from "lucide-react";
import {
  useTemplates,
  templatesStore,
  SERVICE_TYPES,
  type ChecklistTemplate,
  type ServiceType,
  type RiskRule,
  type ReminderRule,
} from "@/lib/templates";
import { cases, formatDate } from "@/lib/mock-data";
import { KnowledgeBaseSection } from "@/components/knowledge-base-section";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Kossilon CoSec OS" },
      {
        name: "description",
        content:
          "Manage checklist templates, required documents, reminder cadence, risk rules, service packages, and WOZTELL WhatsApp integration.",
      },
    ],
  }),
  component: SettingsPage,
});

type Tab = "documents" | "reminders" | "risks";

function SettingsPage() {
  const templates = useTemplates();
  const [selectedId, setSelectedId] = useState<string>(templates[0]?.id ?? "");
  const [tab, setTab] = useState<Tab>("documents");
  const [query, setQuery] = useState("");

  const selected = templates.find((t) => t.id === selectedId) ?? templates[0];
  const filtered = useMemo(
    () =>
      templates.filter(
        (t) =>
          t.name.toLowerCase().includes(query.toLowerCase()) ||
          t.serviceType.toLowerCase().includes(query.toLowerCase()),
      ),
    [templates, query],
  );

  return (
    <>
      <TopBar
        title="Settings"
        subtitle="Checklist templates, packages, integrations"
      />
      <main className="flex-1 space-y-6 p-6">
        {/* Checklist templates section */}
        <section className="rounded-xl border border-border bg-card">
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <div className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-primary" />
                <h2 className="font-display text-base font-semibold text-foreground">
                  Checklist templates
                </h2>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Each new case preloads required documents, reminder cadence,
                and risk rules from the active template for its service type.
              </p>
            </div>
            <button
              onClick={() => {
                const id = templatesStore.create();
                setSelectedId(id);
                setTab("documents");
              }}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" /> New template
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr]">
            {/* Left: template list */}
            <aside className="border-b border-border lg:border-b-0 lg:border-r">
              <div className="p-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search templates"
                    className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2 text-xs outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
              <ul className="max-h-[520px] overflow-y-auto pb-2">
                {filtered.map((t) => {
                  const active = selected?.id === t.id;
                  const usage = cases.filter(
                    (c) =>
                      t.serviceType.startsWith("Annual Return") &&
                      // simplistic: assume all AR cases use the AR template
                      (t.serviceType === "Annual Return — Private Ltd"),
                  ).length;
                  return (
                    <li key={t.id}>
                      <button
                        onClick={() => setSelectedId(t.id)}
                        className={cn(
                          "w-full border-l-2 px-4 py-2.5 text-left transition-colors",
                          active
                            ? "border-primary bg-accent"
                            : "border-transparent hover:bg-muted/50",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-foreground">
                            {t.name}
                          </span>
                          <StatusPill tone={t.active ? "green" : "yellow"}>
                            {t.active ? "Active" : "Draft"}
                          </StatusPill>
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {t.serviceType}
                          {usage > 0 && ` · ${usage} cases`}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>

            {/* Right: editor */}
            <div className="p-5">
              {selected ? (
                <TemplateEditor
                  key={selected.id}
                  t={selected}
                  tab={tab}
                  setTab={setTab}
                  onDuplicate={() => {
                    const id = templatesStore.duplicate(selected.id);
                    if (id) setSelectedId(id);
                  }}
                  onDelete={() => {
                    templatesStore.remove(selected.id);
                    const next = templates.find((t) => t.id !== selected.id);
                    if (next) setSelectedId(next.id);
                  }}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  No templates yet. Create one to get started.
                </p>
              )}
            </div>
          </div>
        </section>


        {/* Knowledge base for the AI assistant */}
        <KnowledgeBaseSection />

        {/* Secondary settings */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <SimpleCard
            icon={<Package className="h-4 w-4 text-primary" />}
            title="Service packages"
            desc="Fee structure by tier"
          >
            <Row
              label="Basic — HKD 2,800"
              right={<span className="text-xs text-muted-foreground">Filing only</span>}
            />
            <Row
              label="Standard — HKD 3,800"
              right={<span className="text-xs text-muted-foreground">Filing + 1 change</span>}
            />
            <Row
              label="Premium — HKD 5,200"
              right={<span className="text-xs text-muted-foreground">Full-service + advisory</span>}
            />
          </SimpleCard>

          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2">
              <Plug className="h-4 w-4 text-primary" />
              <h2 className="font-display text-base font-semibold text-foreground">
                WOZTELL WhatsApp API
              </h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Connect your WOZTELL account to enable two-way WhatsApp messaging
              and automation.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <LabeledInput label="API endpoint" defaultValue="https://api.woztell.com/v3" />
              <LabeledInput label="Channel ID" placeholder="wa-channel-id" />
              <LabeledInput
                label="API key"
                type="password"
                placeholder="••••••••••••••••"
                className="md:col-span-2"
              />
            </div>
            <div className="mt-4 flex items-center justify-between">
              <StatusPill tone="yellow">Not connected</StatusPill>
              <button className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                Test & save
              </button>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}

// ---------- editor ----------

function TemplateEditor({
  t,
  tab,
  setTab,
  onDuplicate,
  onDelete,
}: {
  t: ChecklistTemplate;
  tab: Tab;
  setTab: (t: Tab) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="space-y-5">
      {/* Meta */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex-1 space-y-3">
          <input
            value={t.name}
            onChange={(e) => templatesStore.update(t.id, { name: e.target.value })}
            className="w-full border-b border-transparent bg-transparent font-display text-xl font-semibold text-foreground outline-none focus:border-border"
          />
          <textarea
            value={t.description}
            onChange={(e) =>
              templatesStore.update(t.id, { description: e.target.value })
            }
            placeholder="Describe when this template applies…"
            rows={2}
            className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground">Service type</span>
              <select
                value={t.serviceType}
                onChange={(e) =>
                  templatesStore.update(t.id, {
                    serviceType: e.target.value as ServiceType,
                  })
                }
                className="rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring"
              >
                {SERVICE_TYPES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={t.active}
                onChange={(e) =>
                  templatesStore.update(t.id, { active: e.target.checked })
                }
              />
              <span className="text-muted-foreground">Active</span>
            </label>
            <span className="text-muted-foreground">
              Updated {formatDate(t.updatedAt)}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onDuplicate}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted"
          >
            <Copy className="h-3.5 w-3.5" /> Duplicate
          </button>
          <button
            onClick={onDelete}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2 text-[11px]">
        <Chip icon={<FileText className="h-3 w-3" />} label={`${t.documents.length} documents`} />
        <Chip icon={<Bell className="h-3 w-3" />} label={`${t.reminders.length} reminders`} />
        <Chip
          icon={<Shield className="h-3 w-3" />}
          label={`${t.riskRules.filter((r) => r.enabled).length} risk rules`}
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(
          [
            ["documents", "Documents", FileText],
            ["reminders", "Reminders", Bell],
            ["risks", "Risk rules", Shield],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium",
              tab === key
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {tab === "documents" && <DocumentsTab t={t} />}
      {tab === "reminders" && <RemindersTab t={t} />}
      {tab === "risks" && <RisksTab t={t} />}
    </div>
  );
}

function DocumentsTab({ t }: { t: ChecklistTemplate }) {
  return (
    <div className="rounded-lg border border-border">
      <div className="grid grid-cols-[1fr_120px_110px_80px] items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>Document</span>
        <span>Expected</span>
        <span>Required</span>
        <span className="text-right">Actions</span>
      </div>
      {t.documents.length === 0 && (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">
          No documents yet.
        </p>
      )}
      <ul className="divide-y divide-border">
        {t.documents.map((d) => (
          <li
            key={d.id}
            className="grid grid-cols-[1fr_120px_110px_80px] items-center gap-2 px-3 py-2 text-sm"
          >
            <input
              value={d.label}
              onChange={(e) =>
                templatesStore.updateDocument(t.id, d.id, { label: e.target.value })
              }
              className="rounded-md border border-transparent bg-transparent px-2 py-1 outline-none hover:border-border focus:border-border focus:ring-2 focus:ring-ring"
            />
            <div className="flex items-center gap-1 text-xs">
              <span className="text-muted-foreground">-</span>
              <input
                type="number"
                min={0}
                value={d.daysBeforeDue}
                onChange={(e) =>
                  templatesStore.updateDocument(t.id, d.id, {
                    daysBeforeDue: Math.max(0, Number(e.target.value) || 0),
                  })
                }
                className="w-14 rounded-md border border-border bg-background px-1.5 py-1 text-right tabular-nums outline-none focus:ring-2 focus:ring-ring"
              />
              <span className="text-muted-foreground">days</span>
            </div>
            <label className="inline-flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={d.required}
                onChange={(e) =>
                  templatesStore.updateDocument(t.id, d.id, {
                    required: e.target.checked,
                  })
                }
              />
              <span className="text-muted-foreground">Required</span>
            </label>
            <div className="text-right">
              <button
                onClick={() => templatesStore.removeDocument(t.id, d.id)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label="Remove document"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="border-t border-border p-2">
        <button
          onClick={() => templatesStore.addDocument(t.id)}
          className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-primary hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" /> Add document
        </button>
      </div>
    </div>
  );
}

function RemindersTab({ t }: { t: ChecklistTemplate }) {
  const channels: ReminderRule["channel"][] = ["WhatsApp", "Email", "SMS"];
  return (
    <div className="rounded-lg border border-border">
      <div className="grid grid-cols-[1fr_140px_130px_80px] items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>Reminder</span>
        <span>Days before due</span>
        <span>Channel</span>
        <span className="text-right">Actions</span>
      </div>
      {t.reminders.length === 0 && (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">
          No reminders yet.
        </p>
      )}
      <ul className="divide-y divide-border">
        {t.reminders.map((r) => (
          <li
            key={r.id}
            className="grid grid-cols-[1fr_140px_130px_80px] items-center gap-2 px-3 py-2 text-sm"
          >
            <input
              value={r.label}
              onChange={(e) =>
                templatesStore.updateReminder(t.id, r.id, { label: e.target.value })
              }
              className="rounded-md border border-transparent bg-transparent px-2 py-1 outline-none hover:border-border focus:border-border focus:ring-2 focus:ring-ring"
            />
            <div className="flex items-center gap-1 text-xs">
              <span className="text-muted-foreground">-</span>
              <input
                type="number"
                min={0}
                value={r.daysBeforeDue}
                onChange={(e) =>
                  templatesStore.updateReminder(t.id, r.id, {
                    daysBeforeDue: Math.max(0, Number(e.target.value) || 0),
                  })
                }
                className="w-16 rounded-md border border-border bg-background px-1.5 py-1 text-right tabular-nums outline-none focus:ring-2 focus:ring-ring"
              />
              <span className="text-muted-foreground">days</span>
            </div>
            <select
              value={r.channel}
              onChange={(e) =>
                templatesStore.updateReminder(t.id, r.id, {
                  channel: e.target.value as ReminderRule["channel"],
                })
              }
              className="rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring"
            >
              {channels.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <div className="text-right">
              <button
                onClick={() => templatesStore.removeReminder(t.id, r.id)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label="Remove reminder"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="border-t border-border p-2">
        <button
          onClick={() => templatesStore.addReminder(t.id)}
          className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-primary hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" /> Add reminder
        </button>
      </div>
    </div>
  );
}

function RisksTab({ t }: { t: ChecklistTemplate }) {
  const severities: RiskRule["severity"][] = ["Low", "Medium", "High"];
  const tone = (s: RiskRule["severity"]) =>
    s === "High" ? "red" : s === "Medium" ? "orange" : "yellow";
  return (
    <div className="rounded-lg border border-border">
      <div className="grid grid-cols-[1fr_1.4fr_110px_90px_80px] items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>Rule</span>
        <span>Trigger</span>
        <span>Severity</span>
        <span>Enabled</span>
        <span className="text-right">Actions</span>
      </div>
      {t.riskRules.length === 0 && (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">
          No risk rules yet.
        </p>
      )}
      <ul className="divide-y divide-border">
        {t.riskRules.map((r) => (
          <li
            key={r.id}
            className="grid grid-cols-[1fr_1.4fr_110px_90px_80px] items-center gap-2 px-3 py-2 text-sm"
          >
            <input
              value={r.label}
              onChange={(e) =>
                templatesStore.updateRisk(t.id, r.id, { label: e.target.value })
              }
              className="rounded-md border border-transparent bg-transparent px-2 py-1 outline-none hover:border-border focus:border-border focus:ring-2 focus:ring-ring"
            />
            <input
              value={r.trigger}
              onChange={(e) =>
                templatesStore.updateRisk(t.id, r.id, { trigger: e.target.value })
              }
              className="rounded-md border border-transparent bg-transparent px-2 py-1 text-xs text-muted-foreground outline-none hover:border-border focus:border-border focus:ring-2 focus:ring-ring"
            />
            <div className="flex items-center gap-2">
              <StatusPill tone={tone(r.severity)}>{r.severity}</StatusPill>
              <select
                value={r.severity}
                onChange={(e) =>
                  templatesStore.updateRisk(t.id, r.id, {
                    severity: e.target.value as RiskRule["severity"],
                  })
                }
                className="rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px] outline-none focus:ring-2 focus:ring-ring"
              >
                {severities.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <label className="inline-flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={r.enabled}
                onChange={(e) =>
                  templatesStore.updateRisk(t.id, r.id, { enabled: e.target.checked })
                }
              />
              <span className="text-muted-foreground">On</span>
            </label>
            <div className="text-right">
              <button
                onClick={() => templatesStore.removeRisk(t.id, r.id)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                aria-label="Remove risk rule"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="border-t border-border p-2">
        <button
          onClick={() => templatesStore.addRisk(t.id)}
          className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-primary hover:text-foreground"
        >
          <Plus className="h-3.5 w-3.5" /> Add risk rule
        </button>
      </div>
    </div>
  );
}

// ---------- small helpers ----------

function SimpleCard({
  icon,
  title,
  desc,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          {icon}
          <h2 className="font-display text-base font-semibold text-foreground">
            {title}
          </h2>
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

function Chip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-muted-foreground">
      {icon}
      {label}
    </span>
  );
}

function LabeledInput({
  label,
  className,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="text-xs font-medium text-foreground">{label}</span>
      <input
        {...rest}
        className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
      />
    </label>
  );
}
