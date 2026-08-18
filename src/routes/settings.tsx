import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getWhatsAppIntegrationStatus } from "../features/whatsapp/server-fns";
import { useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import { useAuth } from "@/features/auth/auth-context-neon";
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
import { useTemplates as useDemoTemplates } from "@/lib/templates";
import {
  SERVICE_TYPES,
  type ChecklistTemplate,
  type ChecklistTemplatePatch,
  type DocumentItem,
  type ServiceType,
  type RiskRule,
  type ReminderRule,
} from "@/features/checklist-templates/types";
import {
  createChecklistTemplate,
  deleteChecklistTemplate,
  duplicateChecklistTemplate,
  listChecklistTemplates,
  updateChecklistTemplate,
} from "@/features/checklist-templates/server-fns";
import type { DataMode } from "@/features/runtime/data-mode";
import { guardMutation } from "@/lib/guard-mutation";
import { cases } from "@/lib/mock-data";
import { formatDate } from "@/lib/format-date";
import { KnowledgeBaseSection } from "@/components/knowledge-base-section";
import { cn } from "@/lib/utils";
import { settingsSectionsForMode } from "./-settings-sections";

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

// The shape of `useMutation`'s result that the template-editing subcomponents need. Kept narrow
// (rather than the full `UseMutationResult`) so it's easy to pass down through props.
type UpdateTemplateMutation = {
  mutate: (input: { id: string; patch: ChecklistTemplatePatch }) => void;
};

// Stable fallback so `templates` keeps the same array identity across renders while the
// production query has no data yet (an inline `[]` would allocate a new array every render).
const EMPTY_TEMPLATES: ChecklistTemplate[] = [];

function describeMutationError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function SettingsPage() {
  const { dataMode } = Route.useRouteContext();
  const { isCurrentUserAdmin } = useAuth();
  const sections = settingsSectionsForMode(dataMode);
  const integrationQuery = useQuery({
    queryKey: ["whatsapp-integration-status"],
    queryFn: () => getWhatsAppIntegrationStatus(),
  });

  const queryClient = useQueryClient();
  const demoTemplates = useDemoTemplates();
  const productionTemplatesQuery = useQuery({
    queryKey: ["checklist-templates"],
    queryFn: () => listChecklistTemplates(),
    enabled: dataMode === "production",
  });
  const templates =
    dataMode === "demo" ? demoTemplates : (productionTemplatesQuery.data ?? EMPTY_TEMPLATES);

  // Returns the promise so mutation `onSuccess` handlers can `await` it — that keeps
  // TanStack Query's `isPending` true for the mutation's *entire* round trip (server write +
  // refetch + cache update), not just the initial network request. See `isSaving` below: as
  // long as any of the four mutations is pending, every add/remove/duplicate/delete control and
  // every editable field is *rendered* disabled, so in ordinary use a second click never even
  // reaches a handler.
  function invalidateTemplates() {
    return queryClient.invalidateQueries({ queryKey: ["checklist-templates"] });
  }

  // Belt-and-suspenders against the same race, for the (narrow, but real) window before a render
  // driven by `isSaving` has actually committed — see `guardMutation` (`@/lib/guard-mutation`) for
  // why this can't just rely on `isPending`/`isSaving`. Cleared in `onSettled` (below), which
  // TanStack Query runs after `onSuccess`'s `await invalidateTemplates()` has already completed —
  // so the next call this ref allows is always against a freshly-refetched `t`.
  const mutationInFlightRef = useRef(false);

  function clearMutationInFlight() {
    mutationInFlightRef.current = false;
  }

  const createMutation = useMutation({
    mutationFn: (serviceType: ServiceType) => createChecklistTemplate({ data: { serviceType } }),
    onSuccess: async (created) => {
      setWarning(undefined);
      await invalidateTemplates();
      setSelectedId(created.id);
      setTab("documents");
    },
    onError: (error) => setWarning(describeMutationError(error, "Unable to create the template.")),
    onSettled: clearMutationInFlight,
  });
  const updateMutation = useMutation({
    mutationFn: (input: { id: string; patch: ChecklistTemplatePatch }) =>
      updateChecklistTemplate({ data: input }),
    onSuccess: async () => {
      setWarning(undefined);
      await invalidateTemplates();
    },
    onError: (error) => setWarning(describeMutationError(error, "Unable to save the change.")),
    onSettled: clearMutationInFlight,
  });
  const duplicateMutation = useMutation({
    mutationFn: (id: string) => duplicateChecklistTemplate({ data: { id } }),
    onSuccess: async (duplicated) => {
      setWarning(undefined);
      await invalidateTemplates();
      setSelectedId(duplicated.id);
    },
    onError: (error) =>
      setWarning(describeMutationError(error, "Unable to duplicate the template.")),
    onSettled: clearMutationInFlight,
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteChecklistTemplate({ data: { id } }),
    onSuccess: async () => {
      setWarning(undefined);
      await invalidateTemplates();
    },
    onError: (error) => setWarning(describeMutationError(error, "Unable to delete the template.")),
    onSettled: clearMutationInFlight,
  });

  // The `updateMutation` prop threaded down to `TemplateEditor` and its tabs is the *guarded*
  // `mutate`, so every add/remove/edit call site below (23 of them) gets the synchronous
  // protection for free, with no per-call-site change needed.
  const guardedUpdateMutation: UpdateTemplateMutation = {
    mutate: guardMutation(
      mutationInFlightRef,
      (input: { id: string; patch: ChecklistTemplatePatch }) => updateMutation.mutate(input),
    ),
  };
  const guardedCreateTemplate = guardMutation(mutationInFlightRef, (serviceType: ServiceType) =>
    createMutation.mutate(serviceType),
  );
  const guardedDuplicateTemplate = guardMutation(mutationInFlightRef, (id: string) =>
    duplicateMutation.mutate(id),
  );

  // True for the entire round trip of any in-flight template mutation (see the comment on
  // `invalidateTemplates` above). Threaded down alongside `dataMode` so every mutating control
  // and editable field disables itself while a write is outstanding.
  const isSaving =
    createMutation.isPending ||
    updateMutation.isPending ||
    duplicateMutation.isPending ||
    deleteMutation.isPending;

  const [selectedId, setSelectedId] = useState<string>(templates[0]?.id ?? "");
  const [tab, setTab] = useState<Tab>("documents");
  const [query, setQuery] = useState("");
  const [warning, setWarning] = useState<string | undefined>();

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

  if (dataMode === "production" && !isCurrentUserAdmin) {
    return (
      <main className="flex-1 space-y-6 p-6">
        <PageHeader eyebrow="Administration" title="Settings" subtitle="Restricted area" />
        <section className="rounded-xl border border-border bg-card p-6">
          <p className="text-sm leading-6 text-muted-foreground">
            Admin access required. Settings are limited to Admin users.
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader
        eyebrow="Administration"
        title="Settings"
        subtitle={
          sections.checklistTemplates
            ? "Checklist templates, packages, integrations"
            : "Integrations"
        }
      />
      {warning ? (
        <div className="rounded-md bg-status-yellow-soft px-3 py-2 text-sm text-status-yellow">
          {warning}
        </div>
      ) : null}
      {sections.checklistTemplates ? (
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
                Each new case preloads required documents, reminder cadence, and risk rules from the
                active template for its service type.
              </p>
            </div>
            {dataMode === "production" && (
              <button
                onClick={() => guardedCreateTemplate("Annual Return — Private Ltd")}
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <Plus className="h-3.5 w-3.5" /> New template
              </button>
            )}
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
                    () =>
                      t.serviceType.startsWith("Annual Return") &&
                      // simplistic: assume all AR cases use the AR template
                      t.serviceType === "Annual Return — Private Ltd",
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
                  dataMode={dataMode}
                  isSaving={isSaving}
                  updateMutation={guardedUpdateMutation}
                  onDuplicate={() => guardedDuplicateTemplate(selected.id)}
                  onDelete={() => {
                    if (mutationInFlightRef.current) return;
                    mutationInFlightRef.current = true;
                    deleteMutation.mutate(selected.id);
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
      ) : null}

      {sections.knowledgeBase ? <KnowledgeBaseSection /> : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {sections.servicePackages ? (
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
        ) : null}

        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <Plug className="h-4 w-4 text-primary" />
            <h2 className="font-display text-base font-semibold text-foreground">
              WOZTELL WhatsApp API
            </h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Connect your WOZTELL account to enable two-way WhatsApp messaging and automation.
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <LabeledInput label="API endpoint" defaultValue="https://api.woztell.com/v3" />
            <LabeledInput label="Channel ID" placeholder="wa-channel-id" />
          </div>
          <div className="mt-4 flex items-center justify-between">
            {integrationQuery.isPending ? (
              <StatusPill tone="yellow">Checking</StatusPill>
            ) : integrationQuery.isError ? (
              <StatusPill tone="yellow">Unavailable</StatusPill>
            ) : integrationQuery.data ? (
              <WhatsAppIntegrationStatus status={integrationQuery.data} />
            ) : (
              <StatusPill tone="yellow">Unavailable</StatusPill>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

type WhatsAppIntegrationStatusData = {
  deliveryMode: "live" | "simulated" | "blocked";
  missingLiveEnvVars: string[];
};

export function WhatsAppIntegrationStatus({ status }: { status: WhatsAppIntegrationStatusData }) {
  return (
    <div className="flex items-center justify-between">
      <StatusPill tone={status.deliveryMode === "live" ? "green" : "yellow"}>
        {status.deliveryMode === "live"
          ? "Configured"
          : status.deliveryMode === "simulated"
            ? "Demo simulation"
            : "Blocked"}
      </StatusPill>
      {status.deliveryMode === "simulated" ? (
        <p className="text-xs text-muted-foreground">
          No external WhatsApp or email message is sent.
        </p>
      ) : status.deliveryMode === "blocked" && status.missingLiveEnvVars.length ? (
        <p className="text-xs text-muted-foreground">
          Missing bindings: {status.missingLiveEnvVars.join(", ")}
        </p>
      ) : null}
    </div>
  );
}

// ---------- editor ----------

function TemplateEditor({
  t,
  tab,
  setTab,
  dataMode,
  isSaving,
  updateMutation,
  onDuplicate,
  onDelete,
}: {
  t: ChecklistTemplate;
  tab: Tab;
  setTab: (t: Tab) => void;
  dataMode: DataMode;
  isSaving: boolean;
  updateMutation: UpdateTemplateMutation;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(t.name);
  const [description, setDescription] = useState(t.description);

  return (
    <div className="space-y-5">
      {/* Meta */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex-1 space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name !== t.name) updateMutation.mutate({ id: t.id, patch: { name } });
            }}
            disabled={dataMode === "demo" || isSaving}
            className="w-full border-b border-transparent bg-transparent font-display text-xl font-semibold text-foreground outline-none focus:border-border disabled:cursor-not-allowed disabled:opacity-70"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => {
              if (description !== t.description)
                updateMutation.mutate({ id: t.id, patch: { description } });
            }}
            placeholder="Describe when this template applies…"
            rows={2}
            disabled={dataMode === "demo" || isSaving}
            className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
          />
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground">Service type</span>
              <select
                value={t.serviceType}
                onChange={(e) =>
                  updateMutation.mutate({
                    id: t.id,
                    patch: { serviceType: e.target.value as ServiceType },
                  })
                }
                disabled={dataMode === "demo" || isSaving}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
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
                  updateMutation.mutate({ id: t.id, patch: { active: e.target.checked } })
                }
                disabled={dataMode === "demo" || isSaving}
              />
              <span className="text-muted-foreground">Active</span>
            </label>
            <span className="text-muted-foreground">Updated {formatDate(t.updatedAt)}</span>
          </div>
        </div>
        {dataMode === "production" && (
          <div className="flex gap-2">
            <button
              onClick={onDuplicate}
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-70"
            >
              <Copy className="h-3.5 w-3.5" /> Duplicate
            </button>
            <button
              onClick={onDelete}
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          </div>
        )}
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

      {tab === "documents" && (
        <DocumentsTab
          t={t}
          dataMode={dataMode}
          isSaving={isSaving}
          updateMutation={updateMutation}
        />
      )}
      {tab === "reminders" && (
        <RemindersTab
          t={t}
          dataMode={dataMode}
          isSaving={isSaving}
          updateMutation={updateMutation}
        />
      )}
      {tab === "risks" && (
        <RisksTab t={t} dataMode={dataMode} isSaving={isSaving} updateMutation={updateMutation} />
      )}
    </div>
  );
}

export function DocumentsTab({
  t,
  dataMode,
  isSaving,
  updateMutation,
}: {
  t: ChecklistTemplate;
  dataMode: DataMode;
  isSaving: boolean;
  updateMutation: UpdateTemplateMutation;
}) {
  function updateDocument(docId: string, patch: Partial<DocumentItem>) {
    updateMutation.mutate({
      id: t.id,
      patch: {
        documents: t.documents.map((d) => (d.id === docId ? { ...d, ...patch } : d)),
      },
    });
  }
  function removeDocument(docId: string) {
    updateMutation.mutate({
      id: t.id,
      patch: { documents: t.documents.filter((d) => d.id !== docId) },
    });
  }
  function addDocument() {
    const newDocument: DocumentItem = {
      id: crypto.randomUUID(),
      label: "New document",
      required: true,
      daysBeforeDue: 14,
    };
    updateMutation.mutate({ id: t.id, patch: { documents: [...t.documents, newDocument] } });
  }

  return (
    <div className="rounded-lg border border-border">
      <div className="grid grid-cols-[1fr_120px_110px_80px] items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>Document</span>
        <span>Expected</span>
        <span>Required</span>
        <span className="text-right">Actions</span>
      </div>
      {t.documents.length === 0 && (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">No documents yet.</p>
      )}
      <ul className="divide-y divide-border">
        {t.documents.map((d) => (
          <DocumentRow
            key={d.id}
            doc={d}
            dataMode={dataMode}
            isSaving={isSaving}
            onUpdate={(patch) => updateDocument(d.id, patch)}
            onRemove={() => removeDocument(d.id)}
          />
        ))}
      </ul>
      {dataMode === "production" && (
        <div className="border-t border-border p-2">
          <button
            onClick={addDocument}
            disabled={isSaving}
            className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-primary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-70"
          >
            <Plus className="h-3.5 w-3.5" /> Add document
          </button>
        </div>
      )}
    </div>
  );
}

function DocumentRow({
  doc,
  dataMode,
  isSaving,
  onUpdate,
  onRemove,
}: {
  doc: DocumentItem;
  dataMode: DataMode;
  isSaving: boolean;
  onUpdate: (patch: Partial<DocumentItem>) => void;
  onRemove: () => void;
}) {
  const [label, setLabel] = useState(doc.label);
  const [daysBeforeDue, setDaysBeforeDue] = useState(doc.daysBeforeDue);

  return (
    <li className="grid grid-cols-[1fr_120px_110px_80px] items-center gap-2 px-3 py-2 text-sm">
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => {
          if (label !== doc.label) onUpdate({ label });
        }}
        disabled={dataMode === "demo" || isSaving}
        className="rounded-md border border-transparent bg-transparent px-2 py-1 outline-none hover:border-border focus:border-border focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
      />
      <div className="flex items-center gap-1 text-xs">
        <span className="text-muted-foreground">-</span>
        <input
          type="number"
          min={0}
          value={daysBeforeDue}
          onChange={(e) => setDaysBeforeDue(Math.max(0, Number(e.target.value) || 0))}
          onBlur={() => {
            if (daysBeforeDue !== doc.daysBeforeDue) onUpdate({ daysBeforeDue });
          }}
          disabled={dataMode === "demo" || isSaving}
          className="w-14 rounded-md border border-border bg-background px-1.5 py-1 text-right tabular-nums outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
        />
        <span className="text-muted-foreground">days</span>
      </div>
      <label className="inline-flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={doc.required}
          onChange={(e) => onUpdate({ required: e.target.checked })}
          disabled={dataMode === "demo" || isSaving}
        />
        <span className="text-muted-foreground">Required</span>
      </label>
      <div className="text-right">
        {dataMode === "production" && (
          <button
            onClick={onRemove}
            disabled={isSaving}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-70"
            aria-label="Remove document"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </li>
  );
}

function RemindersTab({
  t,
  dataMode,
  isSaving,
  updateMutation,
}: {
  t: ChecklistTemplate;
  dataMode: DataMode;
  isSaving: boolean;
  updateMutation: UpdateTemplateMutation;
}) {
  const channels: ReminderRule["channel"][] = ["WhatsApp", "Email", "SMS"];

  function updateReminder(reminderId: string, patch: Partial<ReminderRule>) {
    updateMutation.mutate({
      id: t.id,
      patch: {
        reminders: t.reminders.map((r) => (r.id === reminderId ? { ...r, ...patch } : r)),
      },
    });
  }
  function removeReminder(reminderId: string) {
    updateMutation.mutate({
      id: t.id,
      patch: { reminders: t.reminders.filter((r) => r.id !== reminderId) },
    });
  }
  function addReminder() {
    const newReminder: ReminderRule = {
      id: crypto.randomUUID(),
      label: "New reminder",
      daysBeforeDue: 7,
      channel: "WhatsApp",
    };
    updateMutation.mutate({ id: t.id, patch: { reminders: [...t.reminders, newReminder] } });
  }

  return (
    <div className="rounded-lg border border-border">
      <div className="grid grid-cols-[1fr_140px_130px_80px] items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>Reminder</span>
        <span>Days before due</span>
        <span>Channel</span>
        <span className="text-right">Actions</span>
      </div>
      {t.reminders.length === 0 && (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">No reminders yet.</p>
      )}
      <ul className="divide-y divide-border">
        {t.reminders.map((r) => (
          <ReminderRow
            key={r.id}
            reminder={r}
            channels={channels}
            dataMode={dataMode}
            isSaving={isSaving}
            onUpdate={(patch) => updateReminder(r.id, patch)}
            onRemove={() => removeReminder(r.id)}
          />
        ))}
      </ul>
      {dataMode === "production" && (
        <div className="border-t border-border p-2">
          <button
            onClick={addReminder}
            disabled={isSaving}
            className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-primary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-70"
          >
            <Plus className="h-3.5 w-3.5" /> Add reminder
          </button>
        </div>
      )}
    </div>
  );
}

function ReminderRow({
  reminder,
  channels,
  dataMode,
  isSaving,
  onUpdate,
  onRemove,
}: {
  reminder: ReminderRule;
  channels: ReminderRule["channel"][];
  dataMode: DataMode;
  isSaving: boolean;
  onUpdate: (patch: Partial<ReminderRule>) => void;
  onRemove: () => void;
}) {
  const [label, setLabel] = useState(reminder.label);
  const [daysBeforeDue, setDaysBeforeDue] = useState(reminder.daysBeforeDue);

  return (
    <li className="grid grid-cols-[1fr_140px_130px_80px] items-center gap-2 px-3 py-2 text-sm">
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => {
          if (label !== reminder.label) onUpdate({ label });
        }}
        disabled={dataMode === "demo" || isSaving}
        className="rounded-md border border-transparent bg-transparent px-2 py-1 outline-none hover:border-border focus:border-border focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
      />
      <div className="flex items-center gap-1 text-xs">
        <span className="text-muted-foreground">-</span>
        <input
          type="number"
          min={0}
          value={daysBeforeDue}
          onChange={(e) => setDaysBeforeDue(Math.max(0, Number(e.target.value) || 0))}
          onBlur={() => {
            if (daysBeforeDue !== reminder.daysBeforeDue) onUpdate({ daysBeforeDue });
          }}
          disabled={dataMode === "demo" || isSaving}
          className="w-16 rounded-md border border-border bg-background px-1.5 py-1 text-right tabular-nums outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
        />
        <span className="text-muted-foreground">days</span>
      </div>
      <select
        value={reminder.channel}
        onChange={(e) => onUpdate({ channel: e.target.value as ReminderRule["channel"] })}
        disabled={dataMode === "demo" || isSaving}
        className="rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
      >
        {channels.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <div className="text-right">
        {dataMode === "production" && (
          <button
            onClick={onRemove}
            disabled={isSaving}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-70"
            aria-label="Remove reminder"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </li>
  );
}

function RisksTab({
  t,
  dataMode,
  isSaving,
  updateMutation,
}: {
  t: ChecklistTemplate;
  dataMode: DataMode;
  isSaving: boolean;
  updateMutation: UpdateTemplateMutation;
}) {
  const severities: RiskRule["severity"][] = ["Low", "Medium", "High"];
  const tone = (s: RiskRule["severity"]) =>
    s === "High" ? "red" : s === "Medium" ? "orange" : "yellow";

  function updateRisk(riskId: string, patch: Partial<RiskRule>) {
    updateMutation.mutate({
      id: t.id,
      patch: {
        riskRules: t.riskRules.map((r) => (r.id === riskId ? { ...r, ...patch } : r)),
      },
    });
  }
  function removeRisk(riskId: string) {
    updateMutation.mutate({
      id: t.id,
      patch: { riskRules: t.riskRules.filter((r) => r.id !== riskId) },
    });
  }
  function addRisk() {
    const newRisk: RiskRule = {
      id: crypto.randomUUID(),
      label: "New risk rule",
      severity: "Medium",
      trigger: "Describe the trigger…",
      enabled: true,
    };
    updateMutation.mutate({ id: t.id, patch: { riskRules: [...t.riskRules, newRisk] } });
  }

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
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">No risk rules yet.</p>
      )}
      <ul className="divide-y divide-border">
        {t.riskRules.map((r) => (
          <RiskRow
            key={r.id}
            risk={r}
            severities={severities}
            tone={tone}
            dataMode={dataMode}
            isSaving={isSaving}
            onUpdate={(patch) => updateRisk(r.id, patch)}
            onRemove={() => removeRisk(r.id)}
          />
        ))}
      </ul>
      {dataMode === "production" && (
        <div className="border-t border-border p-2">
          <button
            onClick={addRisk}
            disabled={isSaving}
            className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-primary hover:text-foreground disabled:cursor-not-allowed disabled:opacity-70"
          >
            <Plus className="h-3.5 w-3.5" /> Add risk rule
          </button>
        </div>
      )}
    </div>
  );
}

function RiskRow({
  risk,
  severities,
  tone,
  dataMode,
  isSaving,
  onUpdate,
  onRemove,
}: {
  risk: RiskRule;
  severities: RiskRule["severity"][];
  tone: (s: RiskRule["severity"]) => "red" | "orange" | "yellow";
  dataMode: DataMode;
  isSaving: boolean;
  onUpdate: (patch: Partial<RiskRule>) => void;
  onRemove: () => void;
}) {
  const [label, setLabel] = useState(risk.label);
  const [trigger, setTrigger] = useState(risk.trigger);

  return (
    <li className="grid grid-cols-[1fr_1.4fr_110px_90px_80px] items-center gap-2 px-3 py-2 text-sm">
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => {
          if (label !== risk.label) onUpdate({ label });
        }}
        disabled={dataMode === "demo" || isSaving}
        className="rounded-md border border-transparent bg-transparent px-2 py-1 outline-none hover:border-border focus:border-border focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
      />
      <input
        value={trigger}
        onChange={(e) => setTrigger(e.target.value)}
        onBlur={() => {
          if (trigger !== risk.trigger) onUpdate({ trigger });
        }}
        disabled={dataMode === "demo" || isSaving}
        className="rounded-md border border-transparent bg-transparent px-2 py-1 text-xs text-muted-foreground outline-none hover:border-border focus:border-border focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
      />
      <div className="flex items-center gap-2">
        <StatusPill tone={tone(risk.severity)}>{risk.severity}</StatusPill>
        <select
          value={risk.severity}
          onChange={(e) => onUpdate({ severity: e.target.value as RiskRule["severity"] })}
          disabled={dataMode === "demo" || isSaving}
          className="rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px] outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
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
          checked={risk.enabled}
          onChange={(e) => onUpdate({ enabled: e.target.checked })}
          disabled={dataMode === "demo" || isSaving}
        />
        <span className="text-muted-foreground">On</span>
      </label>
      <div className="text-right">
        {dataMode === "production" && (
          <button
            onClick={onRemove}
            disabled={isSaving}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:cursor-not-allowed disabled:opacity-70"
            aria-label="Remove risk rule"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </li>
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
