import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { useRetainedPage } from "@/lib/use-retained-page";
import { SafeDocumentPreview } from "@/features/documents/safe-preview";
import { canApproveDocument, documentSafetyOf } from "@/features/documents/safety";
import type { DocumentSummary } from "@/features/documents/repository";
import {
  listPaymentWorkspace,
  getAnnualReturnCase,
  recordAnnualReturnPaymentEvidence,
  reviewAnnualReturnPaymentEvidence,
} from "../server-fns";
import { annualReturnQueryKeys } from "../query-keys";
import { PAYMENT_RETURN_REASONS, type PaymentReviewInput } from "../payment-review-input";
import type { AnnualReturnCase } from "../types";
import { BulkSelectionToolbar } from "@/components/bulk-selection-toolbar";
const money = (value: number | undefined) =>
  value === undefined
    ? "待補"
    : `HK$${value.toLocaleString("en-HK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function ProductionPaymentReview({
  actorScope,
  canBulk = false,
}: {
  actorScope: string;
  canBulk?: boolean;
}) {
  const client = useQueryClient();
  const [mode, setMode] = useState<"review" | "outstanding">("review"),
    [q, setQ] = useState(""),
    [cursor, setCursor] = useState<string>(),
    [selectedRowId, setSelectedRowId] = useState<string>();
  const workspace = useQuery({
    queryKey: ["payment-workspace", actorScope, mode, q, cursor],
    queryFn: () => listPaymentWorkspace({ data: { mode, q, cursor, limit: 50 } }),
    retry: false,
  });
  const page = useRetainedPage(JSON.stringify([actorScope, mode, q]), workspace.data),
    items = page?.items ?? [];
  const activeRow = selectedRowId ?? items.find((r) => r.document)?.rowId;
  const selected = items.find((r) => r.rowId === activeRow),
    activeId = selected?.caseId;
  const detail = useQuery({
    queryKey: [...annualReturnQueryKeys.detail(activeId ?? "none"), actorScope],
    queryFn: () => getAnnualReturnCase({ data: { id: activeId! } }),
    enabled: !!selected?.document && mode === "review",
    retry: false,
  });
  const updated = (case_: AnnualReturnCase) => {
    client.setQueryData(annualReturnQueryKeys.detail(case_.id), case_);
    void client.invalidateQueries({ queryKey: annualReturnQueryKeys.all });
    void client.invalidateQueries({ queryKey: ["payment-workspace"] });
    void client.invalidateQueries({ queryKey: ["documents"] });
    void client.invalidateQueries({ queryKey: ["work-queue"] });
  };
  const changeMode = (next: "review" | "outstanding") => {
    setMode(next);
    setCursor(undefined);
    setSelectedRowId(undefined);
  };
  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader eyebrow="Operations" title="Payments" />
      <p>先核對當前安全憑證，再由人手記錄及批准入賬；欠款包括沒有上載憑證的案件。</p>
      <div className="flex flex-wrap gap-3">
        <button className="min-h-11 rounded border px-3" onClick={() => changeMode("review")}>
          付款憑證覆核
        </button>
        <button className="min-h-11 rounded border px-3" onClick={() => changeMode("outstanding")}>
          欠款／未有憑證
        </button>
        <input
          aria-label="Search payment cases"
          value={q}
          maxLength={200}
          className="min-h-11 rounded border px-3"
          onChange={(e) => {
            setQ(e.target.value);
            setCursor(undefined);
            setSelectedRowId(undefined);
          }}
        />
      </div>
      <p>
        已載入{items.length}
        {mode === "review" ? "份憑證" : "案"}／共{page?.total ?? "待確認"}
        {mode === "review" ? "份憑證" : "案"}
      </p>
      {canBulk && mode === "outstanding" ? (
        <BulkSelectionToolbar
          actorScope={actorScope}
          resource="annual_return_case"
          filters={{
            selectionContext: "payment_outstanding_cases",
            ...(q.trim() ? { q: q.trim() } : {}),
          }}
          page={items.map((r) => ({ id: r.caseId, label: r.companyName }))}
          total={page?.total ?? null}
          pageSize={50}
          maintenanceActions={["payment_list_export"]}
        />
      ) : null}
      {workspace.isPending ? <p>Loading payment evidence...</p> : null}
      {workspace.isError ? (
        <p role="alert">
          Production payment evidence is unavailable. 已讀資料保留。
          <button className="min-h-11 px-3" onClick={() => void workspace.refetch()}>
            重試付款頁
          </button>
        </p>
      ) : null}
      <section className="divide-y border-y">
        {items.map((row) =>
          mode === "review" &&
          row.document &&
          selected?.rowId === row.rowId &&
          detail.data?.id === row.caseId ? (
            row.sourceVersion === detail.data.readiness?.sourceVersion ? (
              <PaymentEvidenceRow
                key={row.rowId + ":" + row.document.currentVersionId + ":" + row.sourceVersion}
                document={row.document}
                case_={detail.data}
                onUpdated={updated}
              />
            ) : (
              <article key={row.rowId} className="p-4">
                <p>案件或文件已更新，請重讀付款頁後覆核。</p>
                <button className="min-h-11 px-3" onClick={() => void workspace.refetch()}>
                  重讀付款頁
                </button>
              </article>
            )
          ) : (
            <article key={row.rowId} className="space-y-2 p-4">
              <Link
                to="/annual-returns/$id"
                params={{ id: row.caseId }}
                className="font-semibold underline"
              >
                {row.companyName}
              </Link>
              <p>
                應收：{money(row.payment.amount)} · 已核對：{money(row.payment.receivedAmount)} ·
                餘額：{money(row.payment.balance)}
              </p>
              <p>
                {row.document ? row.document.fileName : "未有付款憑證"} · {row.proofCount}
                份憑證；法定申報日{row.filingDueDate}
              </p>
              {mode === "review" && row.document ? (
                <button
                  className="min-h-11 rounded border px-3"
                  onClick={() => setSelectedRowId(row.rowId)}
                >
                  開啟覆核
                </button>
              ) : null}
            </article>
          ),
        )}
      </section>
      {detail.isError ? (
        <p role="alert">
          當前案件覆核資料未能載入，請重試；未有批准。
          <button className="min-h-11 px-3" onClick={() => void detail.refetch()}>
            重試案件覆核
          </button>
        </p>
      ) : null}
      {!workspace.isPending && !workspace.isError && items.length === 0 ? (
        <p>
          {mode === "review"
            ? "No production payment evidence is awaiting review."
            : "目前授權範圍沒有未清欠款。"}
        </p>
      ) : null}
      <div className="flex gap-3">
        {cursor ? (
          <button className="min-h-11 rounded border px-3" onClick={() => setCursor(undefined)}>
            回第一頁付款
          </button>
        ) : null}
        {page?.nextCursor ? (
          <button
            disabled={workspace.isFetching || workspace.isError}
            className="min-h-11 rounded border px-3"
            onClick={() => setCursor(page.nextCursor!)}
          >
            下一頁付款
          </button>
        ) : null}
      </div>
    </main>
  );
}
function PaymentEvidenceRow({
  document,
  case_,
  onUpdated,
}: {
  document: DocumentSummary;
  case_: AnnualReturnCase;
  onUpdated: (case_: AnnualReturnCase) => void;
}) {
  const [amount, setAmount] = useState(""),
    [date, setDate] = useState(""),
    [reference, setReference] = useState(""),
    [reasonCode, setReasonCode] =
      useState<NonNullable<PaymentReviewInput["reasonCode"]>>("unreadable"),
    [reason, setReason] = useState("");
  const payment = case_.payment,
    versionId = document.currentVersionId,
    expectedVersion = case_.readiness?.sourceVersion;
  const entry = payment?.evidenceEntries?.find(
    (e) => e.documentId === document.id && e.proofVersionId === versionId,
  );
  const returned = payment?.proofReturns?.find(
    (e) => e.documentId === document.id && e.proofVersionId === versionId,
  );
  const safe = canApproveDocument(documentSafetyOf(document)),
    writable =
      !case_.lockedAt &&
      !case_.completedAt &&
      !["Filed", "Completed"].includes(case_.currentStatus);
  const source =
    payment && versionId && expectedVersion
      ? {
          caseId: case_.id,
          paymentId: payment.id,
          documentId: document.id,
          proofVersionId: versionId,
          expectedVersion,
        }
      : null;
  const record = useMutation({
    mutationFn: () => {
      if (!source) throw new Error("Unavailable current proof");
      return recordAnnualReturnPaymentEvidence({
        data: {
          ...source,
          amount,
          receivedOn: date,
          ...(reference.trim() ? { reference: reference.trim() } : {}),
        },
      });
    },
    onSuccess: onUpdated,
    retry: false,
  });
  const review = useMutation({
    mutationFn: (decision: "verified" | "rejected") => {
      if (!source) throw new Error("Unavailable current proof");
      return reviewAnnualReturnPaymentEvidence({
        data: {
          ...source,
          decision,
          ...(decision === "rejected" ? { reasonCode, reasonText: reason.trim() } : {}),
        },
      });
    },
    onSuccess: onUpdated,
    retry: false,
  });
  const disabled = !source || !safe || !writable || record.isPending || review.isPending;
  return (
    <article className="grid gap-4 p-4 lg:grid-cols-2">
      <div>
        <Link
          to="/annual-returns/$id"
          params={{ id: case_.id }}
          className="font-semibold underline"
        >
          {case_.companyName}
        </Link>
        <p>
          {document.fileName} · {document.uploadStatus ?? "未知"} / {document.reviewStatus}
        </p>
        <p>
          應收：{money(payment?.amount)} · 已核對：{money(payment?.receivedAmount)} · 餘額：
          {money(payment?.balance)}
        </p>
        <p>全付日期：{payment?.paidAt?.slice(0, 10) ?? "待補"}</p>
        <p>狀態：{payment?.status ?? "未有付款紀錄"}</p>
        <SafeDocumentPreview document={document} />
      </div>
      <div className="space-y-2">
        {returned && !entry ? (
          <p>
            退回：{returned.reasonCode} — {returned.reasonText}
            ；未記錄或入賬任何金額，請補傳後重新覆核。
          </p>
        ) : entry ? (
          <>
            <p>
              已存憑證金額：{money(entry.amount)} · 收款日期：{entry.receivedOn}
            </p>
            <p>憑證記錄：{entry.status}</p>
            {entry.reasonText ? (
              <p>
                退回：{entry.reasonCode} — {entry.reasonText}；請補傳後重新覆核。
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p>憑證金額及收款日期：待補；以下由人手從文件記錄。</p>
            <label className="block">
              文件所示金額（HKD）
              <input
                aria-label="Receipt amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                className="ml-2 rounded border"
              />
            </label>
            <label className="block">
              文件所示收款日期
              <input
                aria-label="Receipt date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                type="date"
                className="ml-2 rounded border"
              />
            </label>
            <label className="block">
              交易識別／備註
              <input
                aria-label="Receipt reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="ml-2 rounded border"
              />
            </label>
            <button
              type="button"
              disabled={disabled || !amount || !date}
              onClick={() => record.mutate()}
              className="rounded border px-3 py-2 disabled:opacity-50"
            >
              儲存憑證資料
            </button>
          </>
        )}
        {!returned && (!entry || entry.status === "pending") ? (
          <>
            {entry ? (
              <button
                type="button"
                disabled={disabled}
                className="rounded bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50"
                onClick={() => review.mutate("verified")}
              >
                批准此筆憑證金額
              </button>
            ) : null}
            <label className="block">
              退回原因
              <select
                aria-label="Return reason code"
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value as typeof reasonCode)}
              >
                {PAYMENT_RETURN_REASONS.map((code) => (
                  <option key={code}>{code}</option>
                ))}
              </select>
            </label>
            <textarea
              aria-label="Concrete return reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="指出需要補回或修正的內容"
              className="block w-full rounded border"
            />
            <button
              type="button"
              disabled={disabled || !reason.trim()}
              onClick={() => review.mutate("rejected")}
              className="rounded border px-3 py-2 disabled:opacity-50"
            >
              退回補傳
            </button>
          </>
        ) : null}
        {payment?.evidenceEntries
          ?.filter((e) => e.documentId !== document.id || e.proofVersionId !== versionId)
          .map((e) => (
            <p key={e.id} className="text-xs text-muted-foreground">
              歷史憑證 {e.status} · {money(e.amount)} · {e.receivedOn}
              {e.reasonText ? ` · ${e.reasonText}` : ""}
            </p>
          ))}
        {!safe ? <p>付款證據待安全掃描或版本核對，暫不可批准。</p> : null}
        {record.isError || review.isError ? (
          <p role="alert">未能保存付款覆核；可能版本或授權已更新，請重新載入案件。沒有自動重試。</p>
        ) : null}
      </div>
    </article>
  );
}
