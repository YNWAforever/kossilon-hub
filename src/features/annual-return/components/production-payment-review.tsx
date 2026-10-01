import { useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { listDocuments } from "@/features/documents/server-fns";
import { SafeDocumentPreview } from "@/features/documents/safe-preview";
import { canApproveDocument, documentSafetyOf } from "@/features/documents/safety";
import type { DocumentSummary } from "@/features/documents/repository";
import {
  listAnnualReturnCasePage,
  recordAnnualReturnPaymentEvidence,
  reviewAnnualReturnPaymentEvidence,
} from "../server-fns";
import { annualReturnQueryKeys } from "../query-keys";
import { PAYMENT_RETURN_REASONS, type PaymentReviewInput } from "../payment-review-input";
import type { AnnualReturnCase } from "../types";
const money = (value: number | undefined) =>
  value === undefined
    ? "待補"
    : `HK$${value.toLocaleString("en-HK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function ProductionPaymentReview({ actorScope }: { actorScope: string }) {
  const client = useQueryClient();
  const casesQuery = useInfiniteQuery({
    queryKey: [...annualReturnQueryKeys.list({ paymentEvidence: true }), actorScope],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listAnnualReturnCasePage({
        data: { limit: 200, ...(pageParam ? { cursor: pageParam } : {}) },
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const documentsQuery = useQuery({
    queryKey: [...annualReturnQueryKeys.payment("all"), actorScope],
    queryFn: () => listDocuments({ data: {} }),
    retry: false,
  });
  const cases = casesQuery.data?.pages.flatMap((page) => page.cases) ?? [],
    documents = (documentsQuery.data ?? []).filter((d) => d.category === "payment" && d.caseId);
  const updated = (case_: AnnualReturnCase) => {
    client.setQueryData(annualReturnQueryKeys.detail(case_.id), case_);
    void client.invalidateQueries({ queryKey: annualReturnQueryKeys.all });
    void client.invalidateQueries({ queryKey: ["annual-return"] });
    void client.invalidateQueries({ queryKey: ["documents"] });
    void client.invalidateQueries({ queryKey: ["work-queue"] });
  };
  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader eyebrow="Operations" title="Payments" />
      <p>
        先預覽當前憑證，記錄文件所示金額及日期，再批准入賬或退回。批准部分款只更新已核對金額，餘額未清仍待付款。
      </p>
      {casesQuery.isError || documentsQuery.isError ? (
        <p role="alert">Production payment evidence is unavailable.</p>
      ) : null}
      {casesQuery.isPending || documentsQuery.isPending ? <p>Loading payment evidence...</p> : null}
      <section className="divide-y border-y">
        {documents.map((document) => {
          const case_ = cases.find((c) => c.id === document.caseId);
          return case_ ? (
            <PaymentEvidenceRow
              key={`${document.id}:${case_.readiness?.sourceVersion ?? "unknown"}`}
              document={document}
              case_={case_}
              onUpdated={updated}
            />
          ) : (
            <div key={document.id} className="p-4">
              <p>{document.fileName}：先載入所屬案件資料；暫不可審核。</p>
            </div>
          );
        })}
      </section>
      {!casesQuery.isPending &&
      !documentsQuery.isPending &&
      !casesQuery.isError &&
      !documentsQuery.isError &&
      documents.length === 0 ? (
        <p>No production payment evidence is awaiting review.</p>
      ) : null}
      {casesQuery.hasNextPage ? (
        <button
          className="rounded border px-3 py-2"
          disabled={casesQuery.isFetchingNextPage}
          onClick={() => void casesQuery.fetchNextPage({ cancelRefetch: false })}
        >
          載入更多案件
        </button>
      ) : null}
      {casesQuery.isFetchNextPageError ? (
        <p role="alert">下一頁未能載入，已讀取案件仍可查閱，請重試。</p>
      ) : null}
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
