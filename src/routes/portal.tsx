import { pageTitle } from "@/lib/page-title";
import { annualReturnQueryKeys } from "../features/annual-return/query-keys";
import {
  getAnnualReturnCase,
  listAnnualReturnCasePage,
} from "../features/annual-return/server-fns";
import { parseEntityId } from "@/lib/entity-id";
import type { AnnualReturnCase as ProductionAnnualReturnCase } from "../features/annual-return/types";
import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Download, ReceiptText } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { StatusPill } from "@/components/status-pill";
import type { StatusTone } from "@/lib/status";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { labelValue } from "@/lib/format-label";
import { annualReturnStatusLabel, paymentStatusLabel } from "../features/annual-return/labels";
import {
  getClientPortalCase,
  listClientPortalCases,
  type ClientPortalCaseDetail,
} from "../features/annual-return/client-portal-server-fns";
import {
  createDocumentUploadIntent,
  downloadDocument,
  finalizeDocumentUpload,
  listDocumentPage,
} from "../features/documents/server-fns";
import { DOCUMENT_CATEGORIES, type DocumentCategory } from "../features/documents/types";

import {
  type AnnualReturnCase,
  getPacketStatus,
  useAnnualReturnCases,
} from "../lib/annual-return-store";
import {
  awaitingInternalReview,
  outstandingForClient,
} from "../features/annual-return/outstanding";
import {
  getClientPortalActivity,
  getClientPortalProgress,
  getClientPortalRequiredActions,
  getDocumentArchiveRows,
  getPaymentProofsForCase,
  useClientPortalSnapshot,
  type ClientPortalArchiveRow,
  type ClientPortalPaymentProof,
  type ClientPortalRequiredAction,
} from "../lib/client-portal-store";

type PortalSearch = {
  caseId?: unknown;
};

export const Route = createFileRoute("/portal")({
  head: () => ({ meta: [{ title: pageTitle("客戶入口") }] }),
  validateSearch: (search): PortalSearch => ({
    caseId: search.caseId,
  }),
  component: PortalRoute,
});

function PortalRoute() {
  const { dataMode, actor } = Route.useRouteContext();
  const [caseSearch, setCaseSearch] = useState("");
  const cases = useAnnualReturnCases();
  const snapshot = useClientPortalSnapshot();
  const { caseId } = Route.useSearch();
  const navigate = useNavigate({ from: "/portal" });
  const productionCaseId = parseEntityId(caseId) ?? undefined;
  const invalidCaseId = caseId !== undefined && !productionCaseId;
  const pickerQuery = useQuery({
    queryKey: [
      ...annualReturnQueryKeys.all,
      "portal-picker",
      actor?.authUserId,
      actor?.teamId,
      actor?.role,
      caseSearch,
    ],
    queryFn: () => listAnnualReturnCasePage({ data: { limit: 200, q: caseSearch } }),
    enabled:
      dataMode === "production" && actor?.role !== "Client" && !productionCaseId && !invalidCaseId,
    retry: false,
  });
  const productionCaseQuery = useQuery({
    queryKey: [
      ...annualReturnQueryKeys.detail(productionCaseId ?? "portal"),
      JSON.stringify(actor),
    ],
    queryFn: () => getAnnualReturnCase({ data: { id: productionCaseId! } }),
    // getAnnualReturnCase resolves a staff actor, so firing it for a Client is a
    // guaranteed Forbidden. The client branch below has its own scoped read.
    enabled: Boolean(productionCaseId) && actor?.role !== "Client",
    retry: false,
  });
  const [warning, setWarning] = useState<string | undefined>();

  const matchedCase = caseId ? cases.find((caseItem) => caseItem.id === caseId) : undefined;
  const selectedCase = caseId ? matchedCase : cases[0];

  useEffect(() => {
    if (dataMode !== "demo" || !selectedCase || caseId || caseId === selectedCase.id) return;

    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, caseId: selectedCase.id }),
    });
  }, [caseId, dataMode, navigate, selectedCase]);

  if (dataMode !== "demo") {
    if (invalidCaseId)
      return (
        <main className="flex-1 space-y-3 p-6">
          <PageHeader eyebrow="客戶入口" title="客戶入口" />
          <p role="alert" className="text-sm text-destructive">
            案件 ID 格式無效。請重新選擇案件。
          </p>
          <Button asChild>
            <Link to="/portal" search={{}}>
              重新選擇案件
            </Link>
          </Button>
          <Button asChild>
            <Link to="/today">返回今日工作</Link>
          </Button>
        </main>
      );
    // A Client sign-in gets its own companies' cases. Every other read in this
    // feature resolves a staff actor, so before this a client landed on the
    // "unavailable" branch below and had no route anywhere.
    if (actor?.role === "Client") {
      return <ClientPortalView caseId={productionCaseId} />;
    }

    if (!productionCaseId) {
      return (
        <main className="flex-1 space-y-3 p-6">
          <PageHeader eyebrow="客戶入口" title="客戶入口" />
          {/* The sidebar links here with no caseId, so this is the screen staff
              actually land on. It used to stop at a sentence, leaving the only
              route onward as editing the URL by hand. */}
          <p className="text-sm text-muted-foreground">
            請選擇案件，或從周年申報列表開啟案件，以查看該案件的客戶入口。
          </p>
          <label className="block text-sm">
            搜尋全範圍案件
            <Input
              className="min-h-11 ml-2"
              value={caseSearch}
              onChange={(event) => setCaseSearch(event.target.value)}
            />
            <span className="block text-xs text-muted-foreground">
              最多顯示200項；搜尋在授權範圍執行。
            </span>
          </label>
          <label className="block text-sm">
            選擇案件
            <Select
              aria-label="選擇案件"
              className="ml-2"
              value=""
              onChange={(event) => {
                const id = parseEntityId(event.target.value);
                if (id) void navigate({ search: (previous) => ({ ...previous, caseId: id }) });
              }}
            >
              <option value="">請選擇</option>
              {(pickerQuery.data?.cases ?? []).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.companyName} · {item.returnYear}
                </option>
              ))}
            </Select>
          </label>
          {pickerQuery.isError ? (
            <p role="alert" className="text-sm text-destructive">
              無法載入授權案件，請稍後再試。
            </p>
          ) : null}
          <Button asChild>
            <Link to="/annual-returns">瀏覽周年申報</Link>
          </Button>
          <Button asChild>
            <Link to="/today">返回今日工作</Link>
          </Button>
        </main>
      );
    }
    if (productionCaseQuery.isLoading) {
      return <div className="p-6 text-sm text-muted-foreground">客戶入口載入中…</div>;
    }
    if (productionCaseQuery.data) {
      return <ProductionPortalCaseView caseItem={productionCaseQuery.data} />;
    }
    return (
      <main className="flex-1 space-y-3 p-6">
        <PageHeader eyebrow="客戶入口" title="無法載入案件" />
        <p className="text-sm text-destructive">無法載入此周年申報案件。</p>
      </main>
    );
  }

  if (!selectedCase) {
    return (
      <main className="flex-1 space-y-4 p-6">
        <PageHeader eyebrow="客戶入口" title="找不到案件" />
        <Button asChild>
          <Link to="/annual-returns">返回周年申報</Link>
        </Button>
      </main>
    );
  }

  const progress = getClientPortalProgress(selectedCase, snapshot);
  const requiredActions = getClientPortalRequiredActions(selectedCase, snapshot);
  const activity = getClientPortalActivity(selectedCase.id, snapshot);
  const archiveRows = getDocumentArchiveRows([selectedCase], snapshot);
  const paymentProofs = getPaymentProofsForCase(selectedCase.id, snapshot);
  const packetStatus = getPacketStatus(selectedCase);
  const isReadOnly = progress.isReadOnly;

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader
        eyebrow="客戶入口"
        title={selectedCase.companyName}
        subtitle={`周年申報到期日 ${formatDate(selectedCase.dueDate)} · 交件套件：${labelValue(packetStatus)}`}
        actions={
          <Select
            aria-label="選擇客戶入口案件"
            value={selectedCase.id}
            onChange={(event) => {
              setWarning(undefined);
              void navigate({
                search: (previous) => ({ ...previous, caseId: event.target.value }),
              });
            }}
          >
            {cases.map((caseItem) => (
              <option key={caseItem.id} value={caseItem.id}>
                {caseItem.companyName}
              </option>
            ))}
          </Select>
        }
      />

      {warning ? (
        <div className="rounded-md bg-status-yellow-soft px-3 py-2 text-sm text-status-yellow-text">
          {warning}
        </div>
      ) : null}

      <section className="rounded-lg border bg-card p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_220px] md:items-center">
          <div>
            <h2 className="text-lg font-semibold">客戶下一步</h2>
            <p className="mt-1 text-sm text-muted-foreground">{progress.nextAction}</p>
          </div>
          <div>
            <div className="h-2 rounded-full bg-muted">
              <div
                className="h-2 rounded-full bg-primary"
                style={{ width: `${progress.percentage}%` }}
              />
            </div>
            <p className="mt-2 text-right text-sm text-muted-foreground">
              已完成 {progress.completed}/{progress.total}
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">待辦事項</h2>
              <p className="text-sm text-muted-foreground">
                示範客戶操作會更新同事的文件庫及案件時間線。
              </p>
            </div>
            <CheckCircle2 className="h-5 w-5 text-primary" />
          </div>
          <div className="mt-4 space-y-3">
            {requiredActions.map((action) => (
              <PortalActionRow
                key={action.id}
                action={action}
                caseItem={selectedCase}
                isReadOnly={isReadOnly}
                onWarning={setWarning}
              />
            ))}
            {requiredActions.length === 0 ? (
              <p className="text-sm text-muted-foreground">客戶毋須採取任何行動。</p>
            ) : null}
          </div>
        </section>

        <section className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">客戶入口活動</h2>
              <p className="text-sm text-muted-foreground">最新的客戶操作排在最前。</p>
            </div>
            <ReceiptText className="h-5 w-5 text-primary" />
          </div>
          <div className="mt-4 space-y-3">
            {activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">暫未有客戶入口活動。</p>
            ) : (
              activity.map((item) => (
                <div key={item.id} className="rounded-md border px-3 py-3 text-sm">
                  <p className="font-medium">{item.summary}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDateTime(item.createdAt)}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <PaymentProofHistory proofs={paymentProofs} />

      <ArchivePreview rows={archiveRows} selectedCase={selectedCase} />

      <ProductionDocumentPanel
        companyId={selectedCase.clientId}
        caseId={selectedCase.id}
        onWarning={setWarning}
      />
    </main>
  );
}

function PortalActionRow({
  action,
  caseItem,
  isReadOnly,
  onWarning,
}: {
  action: ClientPortalRequiredAction;
  caseItem: AnnualReturnCase;
  isReadOnly: boolean;
  onWarning: (warning: string | undefined) => void;
}) {
  const primaryDisabled = action.status !== "open" || (action.kind !== "receipt" && isReadOnly);
  const documentPrimaryLabel =
    action.kind === "document"
      ? action.documentAction === "replace"
        ? "更換"
        : "上載"
      : undefined;
  const showPrimaryAction =
    action.kind === "document"
      ? action.status === "open" && Boolean(action.documentAction)
      : action.kind === "payment-proof"
        ? action.status === "open" && Boolean(action.paymentProofAction)
        : true;

  function handlePrimaryAction() {
    onWarning(undefined);

    if (action.kind === "document") {
      onWarning("請使用下方的正式文件上載功能提交此檔案。");
      return;
    }

    if (action.kind === "payment-proof" && action.paymentProofAction) {
      onWarning("請使用正式文件上載功能提交私人證明檔案。");
      return;
    }

    if (action.kind === "payment") {
      onWarning("正式環境的付款確認由周年申報流程處理。");
      return;
    }

    if (action.kind === "packet") {
      onWarning("正式環境的交件套件批核由周年申報流程處理。");
      return;
    }

    if (action.kind === "receipt") {
      onWarning("正式環境的收據查閱由周年申報流程處理。");
    }
  }

  return (
    <div className="rounded-md border px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{action.label}</p>
          <p className="mt-1 text-sm text-muted-foreground">{action.detail}</p>
        </div>
        <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">
          {labelValue(action.status)}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {showPrimaryAction ? (
          <Button
            variant="primary"
            disabled={primaryDisabled}
            onClick={handlePrimaryAction}
            type="button"
            aria-label={
              action.kind === "payment-proof"
                ? `為 ${caseItem.companyName} ${primaryActionLabel(action)}`
                : documentPrimaryLabel
                  ? `${documentPrimaryLabel}「${action.label}」`
                  : undefined
            }
          >
            {primaryActionLabel(action)}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function PaymentProofHistory({ proofs }: { proofs: ClientPortalPaymentProof[] }) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <div>
        <h2 className="text-lg font-semibold">付款證明記錄</h2>
        <p className="text-sm text-muted-foreground">已上載的證明及同事覆核結果。</p>
      </div>
      <div className="mt-4 divide-y">
        {proofs.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">暫未上載付款證明。</p>
        ) : (
          proofs.map((proof) => (
            <div
              key={proof.id}
              className="grid gap-2 py-3 text-sm md:grid-cols-[minmax(0,1fr)_140px_120px]"
            >
              <div className="min-w-0">
                <p className="font-medium">{proof.filename}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {proof.uploadedBy} 於 {formatDateTime(proof.uploadedAt)} 上載
                </p>
                {proof.reviewedBy && proof.reviewedAt ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {proof.reviewedBy} 於 {formatDateTime(proof.reviewedAt)} 覆核
                  </p>
                ) : null}
                {proof.reviewReasonLabel ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    原因：{proof.reviewReasonLabel}
                    {proof.reviewNote ? ` — ${proof.reviewNote}` : ""}
                  </p>
                ) : null}
              </div>
              <span>{labelValue(proof.origin)}</span>
              <span>{labelValue(proof.status)}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function ArchivePreview({
  rows,
  selectedCase,
}: {
  rows: ClientPortalArchiveRow[];
  selectedCase: AnnualReturnCase;
}) {
  const previewRows = useMemo(() => rows.slice(0, 5), [rows]);

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">共用文件庫</h2>
          <p className="text-sm text-muted-foreground">
            客戶入口上載的檔案及系統產生的遞交記錄，會顯示於此及「文件」頁。
          </p>
        </div>
        <Button asChild>
          <Link to="/documents" search={{ caseId: selectedCase.id }}>
            開啟文件
          </Link>
        </Button>
      </div>
      <div className="mt-4 divide-y">
        {previewRows.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">文件庫暫無記錄。</p>
        ) : (
          previewRows.map((row) => (
            <div key={row.id} className="grid gap-2 py-3 text-sm md:grid-cols-[1fr_140px_120px]">
              <span className="font-medium">
                {row.title}
                {row.reviewSummary ? (
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    {row.reviewSummary}
                    {row.reviewReasonLabel ? ` — ${row.reviewReasonLabel}` : ""}
                    {row.reviewNote ? ` — ${row.reviewNote}` : ""}
                  </span>
                ) : null}
              </span>
              <span>{labelValue(row.source)}</span>
              <span>{labelValue(row.status)}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

// Mapped here rather than reusing lib/status's caseStatusTone, which is typed
// against the demo CaseStatus vocabulary and differs from the production one.
function clientPortalStatusTone(status: ProductionAnnualReturnCase["currentStatus"]): StatusTone {
  switch (status) {
    case "Documents pending":
    case "Signature pending":
      return "yellow";
    case "Payment pending":
      return "orange";
    case "Filed":
    case "Completed":
      return "blue";
    default:
      return "green";
  }
}

/**
 * The client's own view of one filing. Deliberately NOT ProductionPortalCaseView:
 * that is the staff screen and takes the internal AnnualReturnCase, which carries
 * the owner, reviewer and risk grade. This renders the projection instead.
 */
function ClientPortalCaseView({ caseItem }: { caseItem: ClientPortalCaseDetail }) {
  const [, setWarning] = useState<string | undefined>();
  // Excludes Received. A document the client sent is awaiting our review, and
  // listing it here asked them to send it a second time.
  const outstanding = outstandingForClient(caseItem.checklist);
  const awaitingOurReview = awaitingInternalReview(caseItem.checklist);

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader
        eyebrow="客戶入口"
        title={caseItem.companyName}
        subtitle={`${caseItem.returnYear} 年度周年申報 · 到期日 ${formatDate(caseItem.filingDueDate)}`}
      />

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-base font-semibold text-foreground">進度</h2>
          <StatusPill tone={clientPortalStatusTone(caseItem.currentStatus)}>
            {annualReturnStatusLabel(caseItem.currentStatus)}
          </StatusPill>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {outstanding.length === 0
            ? "我們已收到所需的全部文件，謝謝您。"
            : `我們仍在等待您提供 ${outstanding.length} 份文件。`}
        </p>
        {outstanding.length > 0 ? (
          <ul className="mt-3 list-inside list-disc text-sm text-muted-foreground">
            {outstanding.map((item) => (
              <li key={item.id}>{item.itemLabel}</li>
            ))}
          </ul>
        ) : null}
        {/* Said explicitly, because "nothing outstanding" and "we have your
            documents and are checking them" are different things to a client
            who has just uploaded, and the old screen showed neither. */}
        {awaitingOurReview.length > 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {`我們已收到您提供的 ${awaitingOurReview.length} 份文件，現正覆核，您毋須再提交。`}
          </p>
        ) : null}
        {caseItem.payment ? (
          <p className="mt-3 text-sm text-muted-foreground">
            發票 {caseItem.payment.invoiceNumber} — {caseItem.payment.currency}{" "}
            {caseItem.payment.amount} · {paymentStatusLabel(caseItem.payment.status)}
          </p>
        ) : null}
        {caseItem.filingReference ? (
          <p className="mt-1 text-sm text-muted-foreground">遞交編號 {caseItem.filingReference}</p>
        ) : null}
      </section>

      <ProductionDocumentPanel
        companyId={caseItem.companyId}
        caseId={caseItem.id}
        requirements={outstanding}
        onWarning={setWarning}
      />
      <Button asChild>
        <Link to="/portal">返回您的周年申報</Link>
      </Button>
    </main>
  );
}

/**
 * What a client signing in actually sees: their own companies' annual returns,
 * and the document panel for whichever one they open. Read-only apart from the
 * uploads the documents feature already authorises for Client actors.
 */
function ClientPortalView({ caseId }: { caseId?: string }) {
  const { actor } = Route.useRouteContext();
  const actorScope = JSON.stringify(actor);
  const casesQuery = useQuery({
    queryKey: ["client-portal", "cases", actorScope],
    queryFn: () => listClientPortalCases({ data: {} }),
    retry: false,
  });
  const caseQuery = useQuery({
    queryKey: ["client-portal", "case", caseId ?? "none", actorScope],
    queryFn: () => getClientPortalCase({ data: { caseId: caseId! } }),
    enabled: Boolean(caseId),
    retry: false,
  });

  if (caseId) {
    if (caseQuery.isPending) {
      return <div className="p-6 text-sm text-muted-foreground">正在載入您的周年申報…</div>;
    }
    if (caseQuery.data && !caseQuery.isError) {
      return <ClientPortalCaseView caseItem={caseQuery.data} />;
    }
    return (
      <main className="flex-1 space-y-3 p-6">
        <PageHeader eyebrow="客戶入口" title="找不到周年申報" />
        <p className="text-sm text-muted-foreground">此周年申報並不屬於您公司的申報。</p>
        <Button asChild>
          <Link to="/portal">返回您的周年申報</Link>
        </Button>
      </main>
    );
  }

  if (casesQuery.isPending) {
    return <div className="p-6 text-sm text-muted-foreground">正在載入您的周年申報…</div>;
  }

  const cases = casesQuery.isError ? [] : (casesQuery.data ?? []);

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader eyebrow="客戶入口" title="您的周年申報" subtitle="我們正為貴公司準備的周年申報" />
      {casesQuery.isError ? (
        <p role="alert">
          未能讀取您的周年申報。
          <Button variant="link" onClick={() => void casesQuery.refetch()}>
            重試
          </Button>
        </p>
      ) : null}
      {cases.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          貴公司暫未有周年申報記錄。申報到期前，您的公司秘書會與您聯絡。
        </p>
      ) : (
        <ul className="space-y-3">
          {cases.map((caseItem) => (
            <li key={caseItem.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-display text-base font-semibold text-foreground">
                  {caseItem.companyName} — {caseItem.returnYear}
                </p>
                <StatusPill tone={clientPortalStatusTone(caseItem.currentStatus)}>
                  {annualReturnStatusLabel(caseItem.currentStatus)}
                </StatusPill>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                到期日 {formatDate(caseItem.filingDueDate)}
                {caseItem.outstandingRequiredItems > 0
                  ? ` · 尚需您提供 ${caseItem.outstandingRequiredItems} 份文件`
                  : " · 您毋須再提供文件"}
              </p>
              <Button asChild className="mt-3">
                <Link to="/portal" search={{ caseId: caseItem.id }}>
                  開啟
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function ProductionPortalCaseView({ caseItem }: { caseItem: ProductionAnnualReturnCase }) {
  const [, setWarning] = useState<string | undefined>();
  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader
        eyebrow="客戶入口"
        title={caseItem.companyName}
        subtitle={`${caseItem.returnYear} 年度周年申報`}
      />
      <ProductionDocumentPanel
        companyId={caseItem.companyId}
        caseId={caseItem.id}
        requirements={outstandingForClient(caseItem.checklist ?? [])}
        onWarning={setWarning}
      />
    </main>
  );
}
function ProductionDocumentPanel({
  companyId,
  caseId,
  requirements = [],
  onWarning,
}: {
  requirements?: readonly { id: string; itemLabel: string }[];
  companyId: string;
  caseId: string;
  onWarning: (warning: string | undefined) => void;
}) {
  const { actor } = Route.useRouteContext();
  const actorScope = JSON.stringify(actor);
  return (
    <ScopedDocumentPanel
      key={actorScope + caseId}
      companyId={companyId}
      caseId={caseId}
      requirements={requirements}
      onWarning={onWarning}
      actorScope={actorScope}
    />
  );
}

function ScopedDocumentPanel({
  companyId,
  caseId,
  requirements,
  onWarning,
  actorScope,
}: {
  companyId: string;
  caseId: string;
  requirements: readonly { id: string; itemLabel: string }[];
  onWarning: (warning: string | undefined) => void;
  actorScope: string;
}) {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<DocumentCategory>("other");
  // Which requirement this upload answers. Optional: an upload that names none
  // is real, and lands as unassigned evidence for staff to map rather than being
  // refused or guessed at.
  const [checklistItemId, setChecklistItemId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  // Per-file, because a batch where one file fails validation and four succeed
  // has five different outcomes, and a single shared banner can only show the
  // last of them. Keyed by name+size+lastModified so re-picking the same file
  // reuses its row instead of accumulating duplicates.
  const [outcomes, setOutcomes] = useState<Record<string, UploadOutcome>>({});
  const [uploading, setUploading] = useState(false);
  const productionReady = isUuid(companyId) && isUuid(caseId);
  const documentsQuery = useInfiniteQuery({
    queryKey: [...annualReturnQueryKeys.documents(caseId), companyId, actorScope],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listDocumentPage({ data: { companyId, caseId, limit: 100, cursor: pageParam } }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: productionReady,
    retry: false,
  });
  const documentRows =
    documentsQuery.isError && !documentsQuery.isFetchNextPageError
      ? []
      : (documentsQuery.data?.pages.flatMap((page) => page.documents) ?? []);
  async function uploadOne(candidate: File): Promise<void> {
    const key = fileKey(candidate);
    setOutcomes((current) => ({ ...current, [key]: { state: "uploading" } }));
    try {
      const bytes = new Uint8Array(await candidate.arrayBuffer());
      const checksum = await sha256Hex(bytes);
      const intent = await createDocumentUploadIntent({
        data: {
          companyId,
          caseId,
          ...(checklistItemId ? { checklistItemId } : {}),
          category,
          fileName: candidate.name,
          contentType: candidate.type,
          sizeBytes: candidate.size,
          checksum,
        },
      });
      await finalizeDocumentUpload({
        data: { intentId: intent.id, bodyBase64: bytesToBase64(bytes) },
      });
      // "Received, waiting to be scanned" -- not "done". A received file is not
      // yet readable evidence, and saying so plainly is the difference between an
      // honest state and the one this phase exists to remove.
      setOutcomes((current) => ({ ...current, [key]: { state: "received" } }));
    } catch (error) {
      setOutcomes((current) => ({
        ...current,
        [key]: {
          state: "failed",
          message: error instanceof Error ? error.message : "上載失敗。",
        },
      }));
    }
  }

  async function uploadAll(candidates: File[]): Promise<void> {
    setUploading(true);
    try {
      // Sequential on purpose: each upload sends the whole body through a single
      // Worker request, and firing a batch at once is how a large intake becomes
      // a memory failure rather than a slow one.
      for (const candidate of candidates) {
        await uploadOne(candidate);
      }
    } finally {
      setUploading(false);
      void queryClient.invalidateQueries({ queryKey: annualReturnQueryKeys.documents(caseId) });
    }
  }

  async function handleDownload(documentId: string) {
    try {
      const response = await downloadDocument({ data: { documentId } });
      if (!response.ok) throw new Error(`下載失敗（${response.status}）。`);
      const href = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = "document";
      anchor.click();
      URL.revokeObjectURL(href);
    } catch (error) {
      onWarning(error instanceof Error ? error.message : "未能下載文件。");
    }
  }

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">上載文件</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            檔案會上載至私人儲存空間，並在完成安全掃描前保持隔離。
          </p>
        </div>
        <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">私人上載</span>
      </div>
      {!productionReady ? (
        <p className="mt-4 rounded-md bg-muted px-3 py-3 text-sm text-muted-foreground">
          此示範案件尚未連接正式的公司及案件 ID。
        </p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-[180px_minmax(0,1fr)_auto] md:items-end">
            <label className="grid gap-1 text-sm">
              類別
              <Select
                className="w-full"
                value={category}
                onChange={(event) => setCategory(event.target.value as DocumentCategory)}
              >
                {DOCUMENT_CATEGORIES.map((item) => (
                  <option key={item} value={item}>
                    {labelValue(item)}
                  </option>
                ))}
              </Select>
            </label>
            {requirements.length > 0 ? (
              <label className="grid gap-1 text-sm">
                回應哪一項要求
                <Select
                  aria-label="回應哪一項要求"
                  className="w-full"
                  value={checklistItemId}
                  onChange={(event) => setChecklistItemId(event.target.value)}
                >
                  <option value="">未指定（由我們的同事配對）</option>
                  {requirements.map((requirement) => (
                    <option key={requirement.id} value={requirement.id}>
                      {requirement.itemLabel}
                    </option>
                  ))}
                </Select>
              </label>
            ) : null}
            <label className="grid gap-1 text-sm">
              檔案
              <input
                className="rounded-md border bg-background px-3 py-2"
                type="file"
                multiple
                accept=".pdf,.png,.jpg,.jpeg"
                aria-label="要上載的文件"
                onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              />
            </label>
            <Button
              variant="primary"
              disabled={files.length === 0 || uploading}
              onClick={() => void uploadAll(files)}
              type="button"
            >
              {uploading ? "上載中…" : `安全上載${files.length > 1 ? `（${files.length}）` : ""}`}
            </Button>
          </div>

          {files.length > 0 ? (
            <ul aria-label="上載結果" className="mt-3 space-y-1">
              {files.map((candidate) => {
                const outcome = outcomes[fileKey(candidate)];
                return (
                  <li
                    key={fileKey(candidate)}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    <span className="min-w-0 truncate">{candidate.name}</span>
                    <span className="flex items-center gap-2">
                      <UploadOutcomeLabel outcome={outcome} />
                      {outcome?.state === "failed" ? (
                        <Button size="sm" onClick={() => void uploadOne(candidate)} type="button">
                          重試
                        </Button>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <div className="mt-4 divide-y">
            {documentsQuery.error ? (
              <p className="py-3 text-sm text-status-yellow-text">無法載入文件。</p>
            ) : null}
            {!documentsQuery.isLoading && !documentsQuery.error && documentRows.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">暫未有文件。</p>
            ) : null}
            {documentRows.map((document) => (
              <div
                key={document.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
              >
                <div>
                  <p className="font-medium">{document.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {document.uploadStatus
                      ? labelValue(document.uploadStatus)
                      : "只有文件登記，欠上載來源"}{" "}
                    / {labelValue(document.reviewStatus)}
                  </p>
                </div>
                {document.uploadStatus === "available" && document.reviewStatus === "verified" ? (
                  <Button onClick={() => handleDownload(document.id)} type="button">
                    <Download /> 下載
                  </Button>
                ) : null}
              </div>
            ))}
            {documentsQuery.hasNextPage ? (
              <Button
                type="button"
                className="min-h-11"
                disabled={documentsQuery.isFetchingNextPage}
                onClick={() => void documentsQuery.fetchNextPage({ cancelRefetch: false })}
              >
                載入更多文件
              </Button>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

function isUuid(value: string): boolean {
  return parseEntityId(value) !== null;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function primaryActionLabel(action: ClientPortalRequiredAction): string {
  if (action.kind === "document") return action.documentAction === "replace" ? "更換" : "上載";
  if (action.kind === "payment-proof") {
    return action.paymentProofAction === "replace" ? "更換付款證明" : "上載付款證明";
  }
  if (action.kind === "payment") return "確認付款";
  if (action.kind === "packet") return "批核交件套件";
  return "查看收據";
}

/**
 * What happened to one file in a batch.
 *
 * `received` deliberately does not say "uploaded" or "done": the file has
 * reached private storage and is quarantined awaiting a malware verdict, and it
 * is not readable evidence until that verdict exists. Telling a client the
 * upload succeeded when the document has not been scanned is the same class of
 * dishonesty as a queued reminder rendering as delivered.
 */
type UploadOutcome =
  | { state: "uploading" }
  | { state: "received" }
  | { state: "failed"; message: string };

/** Stable within one picker selection, without needing a generated id. */
function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function UploadOutcomeLabel({ outcome }: { outcome?: UploadOutcome }) {
  if (!outcome) return <span className="text-xs text-muted-foreground">等待上載</span>;
  if (outcome.state === "uploading") {
    return <span className="text-xs text-muted-foreground">上載中…</span>;
  }
  if (outcome.state === "received") {
    return <span className="text-xs text-status-green-text">已收到，等待掃描</span>;
  }
  return (
    <span className="text-xs text-status-red-text" title={outcome.message}>
      失敗：{outcome.message}
    </span>
  );
}
