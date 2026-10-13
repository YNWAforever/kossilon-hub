import { formatDate, formatDateTime, formatDueDate } from "@/lib/format-date";
import { Link } from "@tanstack/react-router";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { daysUntil, findEnquiryForClient } from "@/lib/app-data";
import {
  type AnnualReturnCase,
  type AnnualReturnFollowUpDraft,
  type AnnualReturnPacketStatus,
  type AnnualReturnRiskLevel,
  type AnnualReturnStatus,
  canSendFollowUp,
  getBlockers,
  getFollowUpDrafts,
  getNextAction,
  getPacketReadiness,
  getPacketStatus,
  getReadinessScore,
  getRiskLevel,
  useAnnualReturnCase,
} from "@/lib/annual-return-store";
import {
  getClientPortalActivity,
  getClientPortalRequiredActions,
  getDocumentArchiveRows,
  useClientPortalSnapshot,
} from "@/lib/client-portal-store";

const ownerOptions = ["Iris Wong", "Calvin Ho", "Mandy Lee", "Operations"] as const;
type MetricTone = "red" | "orange" | "yellow" | "green" | "blue";

const statusLabels: Record<AnnualReturnStatus, string> = {
  preparing: "準備中",
  "waiting-documents": "等待文件",
  "payment-pending": "待付款",
  "internal-review": "內部覆核",
  "ready-to-file": "可遞交",
  filed: "已遞交",
};

const riskLabels: Record<AnnualReturnRiskLevel, string> = {
  overdue: "已逾期",
  "due-soon": "即將到期",
  blocked: "受阻",
  healthy: "正常",
  "ready-to-file": "可遞交",
  filed: "已遞交",
};

const metricToneClasses: Record<MetricTone, string> = {
  red: "bg-red-500",
  orange: "bg-orange-500",
  yellow: "bg-yellow-500",
  green: "bg-green-500",
  blue: "bg-blue-500",
};

const riskToneClasses: Record<AnnualReturnRiskLevel, string> = {
  overdue: "bg-red-100 text-red-700",
  "due-soon": "bg-orange-100 text-orange-700",
  blocked: "bg-yellow-100 text-yellow-800",
  healthy: "bg-slate-100 text-slate-700",
  "ready-to-file": "bg-green-100 text-green-700",
  filed: "bg-blue-100 text-blue-700",
};

export function DemoAnnualReturnCaseDetail({ caseId }: { caseId: string }) {
  const id = caseId;
  const caseItem = useAnnualReturnCase(id);
  const portalSnapshot = useClientPortalSnapshot();

  if (!caseItem) {
    return (
      <main className="flex-1 space-y-4 p-6">
        <PageHeader eyebrow="案件與客戶" title="找不到案件" />
        <p className="text-sm text-muted-foreground">示範工作區內沒有這宗周年申報案件。</p>
        <Button asChild>
          <Link to="/annual-returns">返回周年申報</Link>
        </Button>
      </main>
    );
  }

  const enquiry = findEnquiryForClient(caseItem.clientId);
  const risk = getRiskLevel(caseItem);
  const readiness = getReadinessScore(caseItem);
  const blockers = getBlockers(caseItem);
  const nextAction = getNextAction(caseItem);
  const dueInDays = daysUntil(caseItem.dueDate);
  const packetReadiness = getPacketReadiness(caseItem);
  const packetStatus = getPacketStatus(caseItem);
  const followUps = getFollowUpDrafts(caseItem);
  const portalActions = getClientPortalRequiredActions(caseItem, portalSnapshot);
  const portalActivity = getClientPortalActivity(caseItem.id, portalSnapshot);
  const archiveRows = getDocumentArchiveRows([caseItem], portalSnapshot);
  const latestPortalActivity = portalActivity[0];

  return (
    <main className="flex-1 space-y-4 p-6">
      <PageHeader
        eyebrow="案件與客戶"
        title={caseItem.companyName}
        subtitle={`${caseItem.contactName} · ${caseItem.phone} · 申報基準日 ${formatDate(caseItem.basisDate)}`}
        actions={
          <>
            <Button asChild>
              <Link to="/annual-returns">返回</Link>
            </Button>
            <Button asChild>
              <Link
                to="/work-queue"
                search={{
                  view: "team",
                  owner: "all",
                  workType: "all",
                  sla: "all",
                  priority: "all",
                  status: "all",
                }}
              >
                分配及 SLA
              </Link>
            </Button>
            {enquiry ? (
              <Button asChild>
                <Link to="/whatsapp" search={{ enquiry: enquiry.id }}>
                  詢問 AI
                </Link>
              </Button>
            ) : null}
          </>
        }
      />

      {/* Every control below is disabled on purpose. The demo stores expose no
          write path at all (docs/adr/0001-demo-mode-is-read-only.md), so saying
          so once here is more honest than letting each control look live and
          then explaining itself after the click. */}
      <p
        className="rounded-md bg-status-yellow-soft px-3 py-2 text-sm text-status-yellow-text"
        role="status"
      >
        唯讀示範。案件狀態只可在正式環境經周年申報伺服器操作更改。
      </p>

      <section className="rounded-lg border bg-card p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 space-y-3">
            <div>
              {/* Company name, contact and basis date are in the page header. */}
              <div className="flex flex-wrap items-center gap-2">
                <RiskPill risk={risk} />
                <span className="inline-flex rounded-md bg-muted px-2 py-1 text-xs font-medium">
                  {statusLabel(caseItem.status)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <DenseStat
                label="到期日"
                value={formatDueDate(caseItem.dueDate, dueInDays)}
                tone={dueInDays < 0 ? "red" : dueInDays <= 14 ? "orange" : "blue"}
              />
              <DenseStat
                label="完成度"
                value={`${readiness}%`}
                tone={readiness === 100 ? "green" : readiness >= 60 ? "blue" : "yellow"}
              />
              <DenseStat
                label="下一步"
                value={nextAction}
                tone={
                  blockers.length > 0 ? "yellow" : caseItem.status === "filed" ? "blue" : "green"
                }
              />
              <DenseStat
                label="阻礙事項"
                value={blockers.length === 0 ? "沒有" : `${blockers.length} 項未解決`}
                tone={blockers.length === 0 ? "green" : "yellow"}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:min-w-72">
            <label className="space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                負責同事
              </span>
              <select
                aria-label="分配負責同事"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                disabled
                value={caseItem.owner}
              >
                {ownerOptions.map((owner) => (
                  <option key={owner} value={owner}>
                    {owner}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="space-y-4">
          <section className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">阻礙事項</h2>
                <p className="text-sm text-muted-foreground">
                  拖低完成度的文件、付款、簽署及覆核阻礙事項。
                </p>
              </div>
              <span className="shrink-0 whitespace-nowrap text-sm text-muted-foreground">
                {blockers.length} 項未解決
              </span>
            </div>

            <div className="mt-4 divide-y">
              {caseItem.documents.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between gap-3 border-b py-3 last:border-b-0"
                >
                  <div>
                    <p className="font-medium">{doc.label}</p>
                    <p className="text-sm text-muted-foreground">
                      {doc.received ? "已收到" : "缺少"}
                    </p>
                  </div>
                  <Button
                    className="h-auto whitespace-normal py-2 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                    disabled
                  >
                    {doc.received ? "標記為缺少" : "標記為已收到"}
                  </Button>
                </div>
              ))}
            </div>

            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <label className="space-y-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  付款
                </span>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                  disabled
                  value={caseItem.paymentStatus}
                >
                  <option value="pending">待付款</option>
                  <option value="paid">已付款</option>
                  <option value="overdue">逾期未付</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  簽署
                </span>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                  disabled
                  value={caseItem.signatureStatus}
                >
                  <option value="missing">缺少</option>
                  <option value="requested">已要求</option>
                  <option value="received">已收到</option>
                </select>
              </label>

              <label className="space-y-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  覆核
                </span>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                  disabled
                  value={caseItem.reviewStatus}
                >
                  <option value="not-started">未開始</option>
                  <option value="in-review">覆核中</option>
                  <option value="approved">已批准</option>
                </select>
              </label>
            </div>
          </section>

          <section className="rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">交件套件</h2>
                <p className="text-sm text-muted-foreground">示範 NAR1 交件套件於遞交前的現況。</p>
              </div>
              <div className="text-right">
                <span
                  className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${packetToneClass(packetStatus)}`}
                >
                  {packetStatusLabel(packetStatus)}
                </span>
                <p className="mt-1 text-sm text-muted-foreground">
                  交件套件完成度 {packetReadiness}%
                </p>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {caseItem.packetRequirements.map((requirement) => (
                <button
                  key={requirement.id}
                  className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                  disabled
                  type="button"
                >
                  <span>{requirement.label}</span>
                  <span>{requirement.complete ? "已完成" : "未完成"}</span>
                </button>
              ))}
            </div>

            {caseItem.submission ? (
              <div className="mt-4 rounded-md border bg-background px-3 py-3 text-sm">
                <p className="font-medium">遞交編號</p>
                <p className="text-muted-foreground">{caseItem.submission.reference}</p>
              </div>
            ) : null}

            {caseItem.receipt ? (
              <div className="mt-3 rounded-md border bg-background px-3 py-3 text-sm">
                <p className="font-medium">回條已接納</p>
                <p className="text-muted-foreground">{caseItem.receipt.receiptNumber}</p>
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button
                className="disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                disabled
              >
                遞交交件套件
              </Button>
              <Button
                variant="primary"
                className="disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                disabled
              >
                接納回條
              </Button>
            </div>
          </section>

          <section className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">跟進</h2>
                <p className="text-sm text-muted-foreground">
                  按目前阻礙事項產生的示範 WhatsApp 提醒。
                </p>
              </div>
              <span className="shrink-0 whitespace-nowrap text-sm text-muted-foreground">
                {followUps.filter((draft) => draft.status === "draft").length} 項待跟進
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {followUps.length === 0 ? (
                <p className="text-sm text-muted-foreground">毋須跟進。</p>
              ) : (
                followUps.map((draft) => (
                  <FollowUpCard key={draft.id} caseItem={caseItem} draft={draft} />
                ))
              )}
            </div>
          </section>

          <section className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">清單</h2>
                <p className="text-sm text-muted-foreground">
                  同事工作項目，隨工作推進或重開而更新。
                </p>
              </div>
              <span className="text-sm text-muted-foreground">
                {caseItem.checklist.filter((item) => item.complete).length}/
                {caseItem.checklist.length}
              </span>
            </div>

            <div className="mt-4 space-y-2">
              {caseItem.checklist.map((item) => (
                <button
                  key={item.id}
                  className="flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                  disabled
                  type="button"
                >
                  <span>{item.label}</span>
                  <span>{item.complete ? "已完成" : "未完成"}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">備註</h2>
                <p className="text-sm text-muted-foreground">同事就此案件記錄的背景資料。</p>
              </div>
              <span className="text-sm text-muted-foreground">{caseItem.notes.length} 則備註</span>
            </div>

            <div className="mt-4 space-y-3">
              <textarea
                aria-label="新增備註"
                aria-readonly
                className="min-h-28 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm read-only:cursor-not-allowed read-only:bg-muted read-only:text-muted-foreground"
                readOnly
                value=""
              />
              <div className="flex justify-end">
                <Button
                  className="disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                  disabled
                >
                  加入備註
                </Button>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {caseItem.notes.length === 0 ? (
                <p className="text-sm text-muted-foreground">暫時沒有備註。</p>
              ) : (
                caseItem.notes.map((entry) => (
                  <div key={entry.id} className="rounded-md border px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium">{entry.author}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(entry.createdAt)}
                      </p>
                    </div>
                    <p className="mt-2 text-sm">{entry.body}</p>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <section className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">客戶入口活動</h2>
                <p className="text-sm text-muted-foreground">此案件的客戶操作及存檔記錄。</p>
              </div>
              <span className="shrink-0 whitespace-nowrap text-sm text-muted-foreground">
                {portalActions.filter((action) => action.status === "open").length} 項待處理
              </span>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <DenseStat
                label="待處理"
                value={`${portalActions.filter((action) => action.status === "open").length}`}
                tone={portalActions.some((action) => action.status === "open") ? "yellow" : "green"}
              />
              <DenseStat label="存檔" value={`${archiveRows.length}`} tone="blue" />
              <DenseStat
                label="最近活動"
                value={
                  latestPortalActivity ? formatDateTime(latestPortalActivity.createdAt) : "沒有"
                }
                tone={latestPortalActivity ? "green" : "blue"}
              />
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button asChild>
                <Link to="/documents" search={{ caseId: caseItem.id }}>
                  開啟存檔
                </Link>
              </Button>
              <Button asChild variant="primary">
                <Link to="/portal" search={{ caseId: caseItem.id }}>
                  開啟客戶入口
                </Link>
              </Button>
            </div>
          </section>

          <section className="rounded-lg border bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">時間線</h2>
                <p className="text-sm text-muted-foreground">最新的案件活動排在最前。</p>
              </div>
              <span className="shrink-0 whitespace-nowrap text-sm text-muted-foreground">
                {caseItem.timeline.length} 項事件
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {caseItem.timeline.map((event) => (
                <div key={event.id} className="rounded-md border px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-medium">{event.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDateTime(event.createdAt)}
                    </p>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">{event.detail}</p>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function DenseStat({ label, value, tone }: { label: string; value: string; tone: MetricTone }) {
  return (
    <div className="rounded-md border bg-background px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <span className={`h-2.5 w-2.5 rounded-full ${metricToneClass(tone)}`} />
      </div>
      <p className="mt-2 text-sm font-medium">{value}</p>
    </div>
  );
}

function RiskPill({ risk }: { risk: AnnualReturnRiskLevel }) {
  return (
    <span className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${riskToneClass(risk)}`}>
      {riskLabel(risk)}
    </span>
  );
}

function statusLabel(status: AnnualReturnStatus): string {
  return statusLabels[status];
}

function riskLabel(risk: AnnualReturnRiskLevel): string {
  return riskLabels[risk];
}

function metricToneClass(tone: MetricTone): string {
  return metricToneClasses[tone];
}

function riskToneClass(risk: AnnualReturnRiskLevel): string {
  return riskToneClasses[risk];
}

function FollowUpCard({
  caseItem,
  draft,
}: {
  caseItem: AnnualReturnCase;
  draft: AnnualReturnFollowUpDraft;
}) {
  // The send button is disabled either way; the eligibility reason still earns
  // its place, because "filed cases cannot send follow-ups" is domain truth
  // rather than a demo limitation.
  const eligibility = canSendFollowUp(caseItem, draft);

  return (
    <div className="rounded-md border px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{followUpTypeLabel(draft.type)}</p>
          <p className="text-sm text-muted-foreground">
            {draft.recipientName} / {draft.phone} / {draft.suggestedTiming}
          </p>
        </div>
        <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
          {followUpStatusLabel(draft.status)}
        </span>
      </div>
      <p className="mt-3 text-sm">{draft.messagePreview}</p>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {eligibility.ok ? "按目前阻礙事項草擬" : eligibility.reason}
        </p>
        <Button
          className="disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
          disabled
        >
          立即發送
        </Button>
      </div>
    </div>
  );
}

function followUpTypeLabel(type: AnnualReturnFollowUpDraft["type"]): string {
  return {
    "missing-document": "索取缺少文件",
    "payment-reminder": "付款提醒",
    "signature-nudge": "簽署提醒",
    "review-escalation": "覆核升級處理",
    "packet-reminder": "交件套件提醒",
  }[type];
}

function followUpStatusLabel(status: AnnualReturnFollowUpDraft["status"]): string {
  return { draft: "草稿", sent: "已發送", blocked: "受阻" }[status];
}

function packetStatusLabel(status: AnnualReturnPacketStatus): string {
  return {
    "not-started": "未開始",
    building: "準備中",
    "ready-for-review": "待覆核",
    approved: "已批准",
    submitted: "已提交",
    accepted: "已接納",
  }[status];
}

function packetToneClass(status: AnnualReturnPacketStatus): string {
  return {
    "not-started": "bg-slate-100 text-slate-700",
    building: "bg-yellow-100 text-yellow-800",
    "ready-for-review": "bg-orange-100 text-orange-700",
    approved: "bg-green-100 text-green-700",
    submitted: "bg-blue-100 text-blue-700",
    accepted: "bg-blue-100 text-blue-700",
  }[status];
}
