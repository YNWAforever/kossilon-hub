import { pageTitle } from "@/lib/page-title";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getWhatsAppIntegrationStatus } from "../features/whatsapp/server-fns";
import { useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
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
  serviceTypeLabel,
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
import { TemplateImpactPreview } from "@/features/checklist-templates/components/template-impact-preview";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: pageTitle("設定") },
      {
        name: "description",
        content: "管理清單模板、所需文件、提醒節奏、風險規則、服務套餐及 WOZTELL WhatsApp 整合。",
      },
    ],
  }),
  component: SettingsPage,
});

type Tab = "documents" | "reminders" | "risks";

// The shape of `useMutation`'s result that the template-editing subcomponents need. Kept narrow
// (rather than the full `UseMutationResult`) so it's easy to pass down through props.
type UpdateTemplateMutation = {
  mutate: (input: { id: string; patch: ChecklistTemplatePatch; expectedRevision?: number }) => void;
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
  const [saved, setSaved] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [editorReload, setEditorReload] = useState(0);
  const [failed, setFailed] = useState<
    | {
        kind: "update";
        input: { id: string; patch: ChecklistTemplatePatch; expectedRevision: number };
      }
    | { kind: "create"; input: ServiceType }
    | { kind: "duplicate" | "delete"; input: string }
    | null
  >(null);
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
    enabled: dataMode === "production" && isCurrentUserAdmin,
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
  function beginSave() {
    setSaved(false);
    setWarning(undefined);
  }
  function finishSave() {
    setSaved(true);
    setFailed(null);
  }

  const createMutation = useMutation({
    onMutate: beginSave,
    mutationFn: (serviceType: ServiceType) => createChecklistTemplate({ data: { serviceType } }),
    onSuccess: async (created) => {
      setWarning(undefined);
      await invalidateTemplates();
      setSelectedId(created.id);
      setTab("documents");
      finishSave();
    },
    onError: (error, input) => {
      setWarning(describeMutationError(error, "未能建立模板。"));
      setFailed({ kind: "create", input });
    },
    onSettled: clearMutationInFlight,
  });
  const updateMutation = useMutation({
    onMutate: beginSave,
    mutationFn: (input: { id: string; patch: ChecklistTemplatePatch; expectedRevision: number }) =>
      updateChecklistTemplate({ data: input }),
    onSuccess: async () => {
      setWarning(undefined);
      await invalidateTemplates();
      setEditorReload((value) => value + 1);
      finishSave();
    },
    onError: (error, input) => {
      setWarning(describeMutationError(error, "未能儲存更改。"));
      setFailed({ kind: "update", input });
    },
    onSettled: clearMutationInFlight,
  });
  const duplicateMutation = useMutation({
    onMutate: beginSave,
    mutationFn: (id: string) => duplicateChecklistTemplate({ data: { id } }),
    onSuccess: async (duplicated) => {
      setWarning(undefined);
      await invalidateTemplates();
      setSelectedId(duplicated.id);
      finishSave();
    },
    onError: (error, input) => {
      setWarning(describeMutationError(error, "未能複製模板。"));
      setFailed({ kind: "duplicate", input });
    },
    onSettled: clearMutationInFlight,
  });
  const deleteMutation = useMutation({
    onMutate: beginSave,
    mutationFn: (id: string) => deleteChecklistTemplate({ data: { id } }),
    onSuccess: async () => {
      setWarning(undefined);
      await invalidateTemplates();
      finishSave();
    },
    onError: (error, input) => {
      setWarning(describeMutationError(error, "未能刪除模板。"));
      setFailed({ kind: "delete", input });
    },
    onSettled: clearMutationInFlight,
  });

  // The `updateMutation` prop threaded down to `TemplateEditor` and its tabs is the *guarded*
  // `mutate`, so every add/remove/edit call site below (23 of them) gets the synchronous
  // protection for free, with no per-call-site change needed.
  const guardedUpdateMutation: UpdateTemplateMutation = {
    mutate: guardMutation(
      mutationInFlightRef,
      (input: { id: string; patch: ChecklistTemplatePatch; expectedRevision?: number }) => {
        const revision = input.expectedRevision;
        if (!revision) {
          clearMutationInFlight();
          setWarning("模板版本未能確認，請重新載入。");
          return;
        }
        updateMutation.mutate({ ...input, expectedRevision: revision });
      },
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
    isReloading ||
    createMutation.isPending ||
    updateMutation.isPending ||
    duplicateMutation.isPending ||
    deleteMutation.isPending;

  const [selectedId, setSelectedId] = useState<string>(templates[0]?.id ?? "");
  const [tab, setTab] = useState<Tab>("documents");
  const [query, setQuery] = useState("");
  const [warning, setWarning] = useState<string | undefined>();
  const retrySave = guardMutation(mutationInFlightRef, () => {
    if (!failed) {
      clearMutationInFlight();
      return;
    }
    if (failed.kind === "update") updateMutation.mutate(failed.input);
    else if (failed.kind === "create") createMutation.mutate(failed.input);
    else if (failed.kind === "duplicate") duplicateMutation.mutate(failed.input);
    else deleteMutation.mutate(failed.input);
  });
  const reloadTemplates = guardMutation(mutationInFlightRef, async () => {
    setIsReloading(true);
    try {
      const result = await productionTemplatesQuery.refetch();
      if (result.isError) {
        setWarning(describeMutationError(result.error, "未能重新載入模板。"));
        return;
      }
      setEditorReload((value) => value + 1);
      setFailed(null);
      setWarning(undefined);
      setSaved(false);
    } finally {
      setIsReloading(false);
      clearMutationInFlight();
    }
  });

  const selected = templates.find((t) => t.id === selectedId) ?? templates[0];
  const filtered = useMemo(
    () =>
      templates.filter(
        (t) =>
          t.name.toLowerCase().includes(query.toLowerCase()) ||
          t.serviceType.toLowerCase().includes(query.toLowerCase()) ||
          serviceTypeLabel(t.serviceType).includes(query),
      ),
    [templates, query],
  );

  if (dataMode === "production" && !isCurrentUserAdmin) {
    return (
      <main className="flex-1 space-y-6 p-6">
        <PageHeader eyebrow="管理" title="設定" subtitle="限制存取" />
        <section className="rounded-xl border border-border bg-card p-6">
          <p className="text-sm leading-6 text-muted-foreground">
            須具備管理員權限。只有管理員可使用設定。
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="settings-page flex-1 space-y-6 p-4 md:p-6">
      <PageHeader
        eyebrow="管理"
        title="設定"
        subtitle={sections.checklistTemplates ? "清單模板、服務套餐及整合" : "整合"}
      />
      {warning ? (
        <div
          role="alert"
          className="rounded-md bg-status-yellow-soft px-3 py-2 text-sm text-status-yellow-text"
        >
          {warning}
          {failed ? (
            <>
              <Button type="button" disabled={isSaving} onClick={retrySave} className="ml-3">
                重試儲存
              </Button>
              <Button
                type="button"
                disabled={isSaving}
                onClick={reloadTemplates}
                className="ml-3 h-auto whitespace-normal py-2"
              >
                重新載入（放棄未儲存輸入）
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
      {dataMode === "production" ? (
        <>
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {isSaving
              ? "儲存中…"
              : warning
                ? "儲存未完成"
                : saved
                  ? "已儲存"
                  : "編輯後自動儲存；現有案件不會自動更新。"}
          </p>
          {productionTemplatesQuery.isPending ? <p>正在載入模板…</p> : null}
          {productionTemplatesQuery.isError ? (
            <div role="alert">
              無法載入最新模板，這不代表沒有模板。
              <Button variant="link" onClick={() => void productionTemplatesQuery.refetch()}>
                重新載入模板
              </Button>
            </div>
          ) : null}
        </>
      ) : null}
      {sections.checklistTemplates ? (
        <section className="rounded-xl border border-border bg-card">
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <div className="flex items-center gap-2">
                <ClipboardList className="h-4 w-4 text-primary" />
                <h2 className="font-display text-base font-semibold text-foreground">清單模板</h2>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                每宗新案件會按其服務類型，從啟用中的模板預載所需文件、提醒節奏及風險規則。
              </p>
            </div>
            {dataMode === "production" && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => guardedCreateTemplate("Annual Return — Private Ltd")}
                disabled={isSaving}
              >
                <Plus /> 新增模板
              </Button>
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
                    placeholder="搜尋模板"
                    aria-label="搜尋模板"
                    className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-2 text-xs outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>
              <ul className="max-h-[520px] overflow-y-auto pb-2">
                {filtered.map((t) => {
                  const active = selected?.id === t.id;
                  const usage =
                    dataMode === "demo"
                      ? cases.filter(
                          () =>
                            t.serviceType.startsWith("Annual Return") &&
                            // simplistic: assume all AR cases use the AR template
                            t.serviceType === "Annual Return — Private Ltd",
                        ).length
                      : 0;
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
                            {t.active ? "啟用中" : "草稿"}
                          </StatusPill>
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {serviceTypeLabel(t.serviceType)}
                          {usage > 0 && ` · ${usage} 宗案件`}
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
                <>
                  {dataMode === "production" ? (
                    <TemplateImpactPreview
                      key={selected.id + ":" + selected.revision}
                      template={selected}
                    />
                  ) : null}
                  <TemplateEditor
                    key={selected.id + ":" + editorReload}
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
                    }}
                  />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">暫未有模板。請新增模板以開始。</p>
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
            title="服務套餐"
            desc="按級別劃分的收費"
          >
            <Row
              label="基本 — HKD 2,800"
              right={<span className="text-xs text-muted-foreground">只限遞交</span>}
            />
            <Row
              label="標準 — HKD 3,800"
              right={<span className="text-xs text-muted-foreground">遞交 + 1 項變更</span>}
            />
            <Row
              label="尊尚 — HKD 5,200"
              right={<span className="text-xs text-muted-foreground">全面服務 + 諮詢</span>}
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
            通訊設定由伺服器環境管理。此頁不儲存憑證；已配置不代表實際收發已驗證。
          </p>
          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <LabeledInput label="API 端點" readOnly placeholder="伺服器管理；不在此頁顯示" />
            <LabeledInput label="頻道 ID" readOnly placeholder="伺服器管理；不在此頁顯示" />
          </div>
          <div className="mt-4 flex items-center justify-between">
            {integrationQuery.isPending ? (
              <StatusPill tone="yellow">檢查中</StatusPill>
            ) : integrationQuery.isError ? (
              <StatusPill tone="yellow">無法使用</StatusPill>
            ) : integrationQuery.data ? (
              <WhatsAppIntegrationStatus status={integrationQuery.data} />
            ) : (
              <StatusPill tone="yellow">無法使用</StatusPill>
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
          ? "已設定"
          : status.deliveryMode === "simulated"
            ? "示範模擬"
            : "受阻"}
      </StatusPill>
      {status.deliveryMode === "simulated" ? (
        <p className="text-xs text-muted-foreground">不會發送任何外部 WhatsApp 或電郵訊息。</p>
      ) : status.deliveryMode === "blocked" && status.missingLiveEnvVars.length ? (
        <p className="text-xs text-muted-foreground">
          缺少綁定：{status.missingLiveEnvVars.join(", ")}
        </p>
      ) : null}
    </div>
  );
}

// ---------- editor ----------

function TemplateEditor({
  t: fetchedTemplate,
  tab,
  setTab,
  dataMode,
  isSaving,
  updateMutation: suppliedMutation,
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
  // Draft values, arrays and revision share one baseline. Background refetches
  // cannot rebase a draft; only a successful own write or explicit reload can.
  const [t] = useState(fetchedTemplate);
  const [name, setName] = useState(t.name);
  const [description, setDescription] = useState(t.description);
  const updateMutation: UpdateTemplateMutation = {
    mutate: (input) => suppliedMutation.mutate({ ...input, expectedRevision: t.revision }),
  };

  return (
    <div className="space-y-5">
      {/* Meta */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex-1 space-y-3">
          <input
            aria-label="模板名稱"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name !== t.name) updateMutation.mutate({ id: t.id, patch: { name } });
            }}
            disabled={dataMode === "demo" || isSaving}
            className="w-full border-b border-transparent bg-transparent font-display text-xl font-semibold text-foreground outline-none focus:border-border disabled:cursor-not-allowed disabled:opacity-70"
          />
          <textarea
            aria-label="模板說明"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => {
              if (description !== t.description)
                updateMutation.mutate({ id: t.id, patch: { description } });
            }}
            placeholder="說明此模板適用的情況…"
            rows={2}
            disabled={dataMode === "demo" || isSaving}
            className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
          />
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-2">
              <span className="text-muted-foreground">服務類型</span>
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
                    {serviceTypeLabel(s)}
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
              <span className="text-muted-foreground">啟用</span>
            </label>
            <span className="text-muted-foreground">更新於 {formatDate(t.updatedAt)}</span>
          </div>
        </div>
        {dataMode === "production" && (
          <div className="flex gap-2">
            <Button size="sm" onClick={onDuplicate} disabled={isSaving}>
              <Copy /> 複製
            </Button>
            <Button variant="destructive" size="sm" onClick={onDelete} disabled={isSaving}>
              <Trash2 /> 刪除
            </Button>
          </div>
        )}
      </div>

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2 text-[11px]">
        <Chip icon={<FileText className="h-3 w-3" />} label={`${t.documents.length} 份文件`} />
        <Chip icon={<Bell className="h-3 w-3" />} label={`${t.reminders.length} 項提醒`} />
        <Chip
          icon={<Shield className="h-3 w-3" />}
          label={`${t.riskRules.filter((r) => r.enabled).length} 條風險規則`}
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(
          [
            ["documents", "文件", FileText],
            ["reminders", "提醒", Bell],
            ["risks", "風險規則", Shield],
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
      label: "新文件",
      required: true,
      daysBeforeDue: 14,
    };
    updateMutation.mutate({ id: t.id, patch: { documents: [...t.documents, newDocument] } });
  }

  return (
    <div className="rounded-lg border border-border">
      <div className="hidden items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:grid sm:grid-cols-[minmax(0,1fr)_170px_110px_80px]">
        <span>文件</span>
        <span>預期提交</span>
        <span>必需</span>
        <span className="text-right">操作</span>
      </div>
      {t.documents.length === 0 && (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">暫未有文件。</p>
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
          <Button size="sm" onClick={addDocument} disabled={isSaving}>
            <Plus /> 新增文件
          </Button>
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
    <li className="grid grid-cols-1 items-center gap-2 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_170px_110px_80px] [&>input]:min-w-0 [&>input]:w-full">
      <input
        aria-label={`文件名稱：${doc.label}`}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => {
          if (label !== doc.label) onUpdate({ label });
        }}
        disabled={dataMode === "demo" || isSaving}
        className="rounded-md border border-transparent bg-transparent px-2 py-1 outline-none hover:border-border focus:border-border focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
      />
      <div className="flex items-center gap-1 text-xs">
        <input
          type="number"
          min={0}
          aria-label={`${doc.label} 的到期前日數`}
          value={daysBeforeDue}
          onChange={(e) => setDaysBeforeDue(Math.max(0, Number(e.target.value) || 0))}
          onBlur={() => {
            if (daysBeforeDue !== doc.daysBeforeDue) onUpdate({ daysBeforeDue });
          }}
          disabled={dataMode === "demo" || isSaving}
          className="w-14 rounded-md border border-border bg-background px-1.5 py-1 text-right tabular-nums outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
        />
        <span className="whitespace-nowrap text-muted-foreground">日（到期前）</span>
      </div>
      <label className="inline-flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={doc.required}
          onChange={(e) => onUpdate({ required: e.target.checked })}
          disabled={dataMode === "demo" || isSaving}
        />
        <span className="text-muted-foreground">必需</span>
      </label>
      <div className="text-right">
        {dataMode === "production" && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onRemove}
            disabled={isSaving}
            className="text-muted-foreground hover:text-destructive"
            aria-label="移除文件"
          >
            <Trash2 />
          </Button>
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
      label: "新提醒",
      daysBeforeDue: 7,
      channel: "WhatsApp",
    };
    updateMutation.mutate({ id: t.id, patch: { reminders: [...t.reminders, newReminder] } });
  }

  return (
    <div className="rounded-lg border border-border">
      <div className="hidden items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:grid sm:grid-cols-[minmax(0,1fr)_170px_130px_80px]">
        <span>提醒</span>
        <span>到期前日數</span>
        <span>渠道</span>
        <span className="text-right">操作</span>
      </div>
      {t.reminders.length === 0 && (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">暫未有提醒。</p>
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
          <Button size="sm" onClick={addReminder} disabled={isSaving}>
            <Plus /> 新增提醒
          </Button>
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
    <li className="grid grid-cols-1 items-center gap-2 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_170px_130px_80px] [&>input]:min-w-0 [&>input]:w-full">
      <input
        aria-label={`提醒名稱：${reminder.label}`}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => {
          if (label !== reminder.label) onUpdate({ label });
        }}
        disabled={dataMode === "demo" || isSaving}
        className="rounded-md border border-transparent bg-transparent px-2 py-1 outline-none hover:border-border focus:border-border focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
      />
      <div className="flex items-center gap-1 text-xs">
        <input
          type="number"
          min={0}
          aria-label={`${reminder.label} 的到期前日數`}
          value={daysBeforeDue}
          onChange={(e) => setDaysBeforeDue(Math.max(0, Number(e.target.value) || 0))}
          onBlur={() => {
            if (daysBeforeDue !== reminder.daysBeforeDue) onUpdate({ daysBeforeDue });
          }}
          disabled={dataMode === "demo" || isSaving}
          className="w-16 rounded-md border border-border bg-background px-1.5 py-1 text-right tabular-nums outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
        />
        <span className="whitespace-nowrap text-muted-foreground">日（到期前）</span>
      </div>
      <select
        aria-label={`${reminder.label} 的渠道`}
        value={reminder.channel}
        onChange={(e) => onUpdate({ channel: e.target.value as ReminderRule["channel"] })}
        disabled={dataMode === "demo" || isSaving}
        className="rounded-md border border-border bg-background px-2 py-1 text-xs outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
      >
        {channels.map((c) => (
          <option key={c} value={c}>
            {c === "Email" ? "電郵" : c}
          </option>
        ))}
      </select>
      <div className="text-right">
        {dataMode === "production" && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onRemove}
            disabled={isSaving}
            className="text-muted-foreground hover:text-destructive"
            aria-label="移除提醒"
          >
            <Trash2 />
          </Button>
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
      label: "新風險規則",
      severity: "Medium",
      trigger: "請描述觸發條件…",
      enabled: true,
    };
    updateMutation.mutate({ id: t.id, patch: { riskRules: [...t.riskRules, newRisk] } });
  }

  return (
    <div className="rounded-lg border border-border">
      <div className="hidden items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_110px_90px_80px]">
        <span>規則</span>
        <span>觸發條件</span>
        <span>嚴重程度</span>
        <span>啟用</span>
        <span className="text-right">操作</span>
      </div>
      {t.riskRules.length === 0 && (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">暫未有風險規則。</p>
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
          <Button size="sm" onClick={addRisk} disabled={isSaving}>
            <Plus /> 新增風險規則
          </Button>
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
    <li className="grid grid-cols-1 items-center gap-2 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_110px_90px_80px] [&>input]:min-w-0 [&>input]:w-full">
      <input
        aria-label={`風險規則名稱：${risk.label}`}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => {
          if (label !== risk.label) onUpdate({ label });
        }}
        disabled={dataMode === "demo" || isSaving}
        className="rounded-md border border-transparent bg-transparent px-2 py-1 outline-none hover:border-border focus:border-border focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
      />
      <input
        aria-label={`${risk.label} 的觸發條件`}
        value={trigger}
        onChange={(e) => setTrigger(e.target.value)}
        onBlur={() => {
          if (trigger !== risk.trigger) onUpdate({ trigger });
        }}
        disabled={dataMode === "demo" || isSaving}
        className="rounded-md border border-transparent bg-transparent px-2 py-1 text-xs text-muted-foreground outline-none hover:border-border focus:border-border focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
      />
      <div className="flex items-center gap-2">
        <StatusPill tone={tone(risk.severity)}>{severityLabel(risk.severity)}</StatusPill>
        <select
          aria-label={`${risk.label} 的嚴重程度`}
          value={risk.severity}
          onChange={(e) => onUpdate({ severity: e.target.value as RiskRule["severity"] })}
          disabled={dataMode === "demo" || isSaving}
          className="rounded-md border border-border bg-background px-1.5 py-0.5 text-[11px] outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-70"
        >
          {severities.map((s) => (
            <option key={s} value={s}>
              {severityLabel(s)}
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
        <span className="text-muted-foreground">開啟</span>
      </label>
      <div className="text-right">
        {dataMode === "production" && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onRemove}
            disabled={isSaving}
            className="text-muted-foreground hover:text-destructive"
            aria-label="移除風險規則"
          >
            <Trash2 />
          </Button>
        )}
      </div>
    </li>
  );
}

// ---------- small helpers ----------

function severityLabel(severity: RiskRule["severity"]): string {
  return { Low: "低", Medium: "中", High: "高" }[severity];
}

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
