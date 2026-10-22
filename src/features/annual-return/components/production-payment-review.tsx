import { LoadingRows } from "@/components/ui/skeleton";
import { useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import { listDocumentPage } from "@/features/documents/server-fns";
import { SafeDocumentPreview } from "@/features/documents/safe-preview";
import { canApproveDocument, documentSafetyOf } from "@/features/documents/safety";
import type { DocumentSummary } from "@/features/documents/repository";
import {
  getAnnualReturnCase,
  listAnnualReturnCasePage,
  recordAnnualReturnPaymentEvidence,
  reviewAnnualReturnPaymentEvidence,
} from "../server-fns";
import { annualReturnQueryKeys } from "../query-keys";
import { PAYMENT_RETURN_REASONS, type PaymentReviewInput } from "../payment-review-input";
import type { AnnualReturnCase } from "../types";
import { BulkSelectionToolbar } from "@/components/bulk-selection-toolbar";
import { labelValue } from "@/lib/format-label";
import { paymentStatusLabel } from "../labels";

const RETURN_REASON_LABELS: Record<(typeof PAYMENT_RETURN_REASONS)[number], string> = {
  unreadable: "無法閱讀",
  amount_mismatch: "金額不符",
  date_mismatch: "日期不符",
  duplicate_proof: "重複憑證",
  wrong_account: "收款帳戶錯誤",
  other: "其他",
};
const returnReasonLabel = (code: string) =>
  RETURN_REASON_LABELS[code as (typeof PAYMENT_RETURN_REASONS)[number]] ?? code;
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
  const documentsQuery = useInfiniteQuery({
    queryKey: [...annualReturnQueryKeys.payment("all"), actorScope],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listDocumentPage({ data: { category: "payment", limit: 100, cursor: pageParam } }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });
  const cases =
      casesQuery.isError && !casesQuery.isFetchNextPageError
        ? []
        : (casesQuery.data?.pages.flatMap((page) => page.cases) ?? []),
    documents = (documentsQuery.data?.pages.flatMap((p) => p.documents) ?? []).filter(
      (d) => d.caseId,
    );
  const updated = (case_: AnnualReturnCase) => {
    client.setQueryData(annualReturnQueryKeys.detail(case_.id), case_);
    void client.invalidateQueries({ queryKey: annualReturnQueryKeys.all });
    void client.invalidateQueries({ queryKey: ["annual-return"] });
    void client.invalidateQueries({ queryKey: ["documents"] });
    void client.invalidateQueries({ queryKey: ["work-queue"] });
  };
  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader eyebrow="文件與付款" title="付款" />
      <p>
        先預覽當前憑證，記錄文件所示金額及日期，再批准入賬或退回。批准部分款只更新已核對金額，餘額未清仍待付款。
      </p>
      {canBulk ? (
        <BulkSelectionToolbar
          actorScope={actorScope}
          resource="annual_return_case"
          filters={{}}
          page={cases.map((c) => ({ id: c.id, label: c.companyName }))}
          total={casesQuery.hasNextPage ? null : casesQuery.isSuccess ? cases.length : null}
          pageSize={200}
          maintenanceActions={["payment_list_export"]}
        />
      ) : null}
      {casesQuery.isError || documentsQuery.isError ? (
        <p role="alert">暫時無法載入付款憑證。</p>
      ) : null}
      {casesQuery.isPending || documentsQuery.isPending ? (
        <LoadingRows label="正在載入付款憑證…" rows={4} />
      ) : null}
      <section aria-label="付款憑證覆核" className="divide-y border-y">
        <h2 className="py-3 font-semibold">付款憑證覆核</h2>
        {documents.map((document) => (
          <PaymentEvidenceContextRow
            key={`${actorScope}:${document.id}`}
            actorScope={actorScope}
            document={document}
            readBlocked={documentsQuery.isError && !documentsQuery.isFetchNextPageError}
            onUpdated={updated}
          />
        ))}
      </section>
      {!casesQuery.isPending &&
      !documentsQuery.isPending &&
      !casesQuery.isError &&
      !documentsQuery.isError &&
      documents.length === 0 ? (
        <p>沒有待覆核的付款憑證。</p>
      ) : null}
      {casesQuery.hasNextPage ? (
        <Button
          disabled={casesQuery.isFetchingNextPage}
          onClick={() => void casesQuery.fetchNextPage({ cancelRefetch: false })}
        >
          載入更多案件
        </Button>
      ) : null}
      {documentsQuery.hasNextPage ? (
        <Button
          className="min-h-11"
          disabled={documentsQuery.isFetchingNextPage}
          onClick={() => void documentsQuery.fetchNextPage({ cancelRefetch: false })}
        >
          載入更多付款憑證
        </Button>
      ) : null}
      {documentsQuery.isFetchNextPageError ? (
        <p role="alert">下一頁付款憑證未能載入，請重試。</p>
      ) : null}
      <section aria-label="待收款案件" className="divide-y border-y">
        <h2 className="py-3 font-semibold">待收款案件</h2>
        <p className="py-2 text-sm">未有憑證亦可開啟案件跟進付款及補傳文件。</p>
        {cases
          .filter(
            (case_) =>
              case_.payment &&
              ((case_.payment.balance ?? 0) > 0 ||
                ["Not invoiced", "Payment pending", "Overdue"].includes(case_.payment.status)),
          )
          .map((case_) => (
            <article key={case_.id} className="space-y-1 py-3">
              <Link
                to="/annual-returns/$id"
                params={{ id: case_.id }}
                className="font-semibold underline"
              >
                {case_.companyName}
              </Link>
              <p>
                {case_.payment!.status === "Overdue"
                  ? "逾期"
                  : (case_.payment!.receivedAmount ?? 0) > 0 && (case_.payment!.balance ?? 0) > 0
                    ? "部分收款"
                    : "未收款"}
              </p>
              <p>
                應收：{money(case_.payment!.amount)} · 已核對：
                {money(case_.payment!.receivedAmount)} · 餘額：{money(case_.payment!.balance)}
              </p>
              <p className="text-sm">開啟案件跟進付款／補傳憑證</p>
            </article>
          ))}
      </section>
      {casesQuery.isFetchNextPageError ? (
        <p role="alert">下一頁未能載入，已讀取案件仍可查閱，請重試。</p>
      ) : null}
    </main>
  );
}
function PaymentEvidenceContextRow({
  actorScope,
  document,
  readBlocked,
  onUpdated,
}: {
  actorScope: string;
  document: DocumentSummary;
  readBlocked: boolean;
  onUpdated: (case_: AnnualReturnCase) => void;
}) {
  // A proof's review context must not depend on paging the unrelated case list.
  // Separate actor-scoped cache entries also prevent a previous actor's case
  // from being reused when this actor cannot read it.
  const caseQuery = useQuery({
    queryKey: [...annualReturnQueryKeys.detail(document.caseId!), "payment-review", actorScope],
    queryFn: () => getAnnualReturnCase({ data: { id: document.caseId! } }),
    retry: false,
  });
  if (caseQuery.isPending)
    return <LoadingRows label={`${document.fileName}：正在載入案件資料…`} rows={1} />;
  if (
    readBlocked ||
    caseQuery.isError ||
    !caseQuery.data ||
    caseQuery.data.id !== document.caseId
  ) {
    return (
      <p role="alert" className="p-4">
        {document.fileName}：案件資料不可用或沒有權限，暫不可審核。
      </p>
    );
  }
  return (
    <PaymentEvidenceRow
      key={`${document.currentVersionId}:${caseQuery.data.readiness?.sourceVersion ?? "unknown"}`}
      document={document}
      case_={caseQuery.data}
      refreshing={caseQuery.isFetching}
      onUpdated={onUpdated}
    />
  );
}
function PaymentEvidenceRow({
  document,
  case_,
  refreshing,
  onUpdated,
}: {
  document: DocumentSummary;
  case_: AnnualReturnCase;
  refreshing: boolean;
  onUpdated: (case_: AnnualReturnCase) => void;
}) {
  const submitting = useRef(false);
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
    onSettled: () => {
      submitting.current = false;
    },
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
    onSettled: () => {
      submitting.current = false;
    },
    retry: false,
  });
  const disabled =
    !source || !safe || !writable || refreshing || record.isPending || review.isPending;
  const submit = (command: "record" | "verified" | "rejected") => {
    // React's pending render cannot guard two clicks in the same event turn.
    if (disabled || submitting.current) return;
    if (command === "record" ? !amount || !date : command === "rejected" && !reason.trim()) return;
    submitting.current = true;
    if (command === "record") record.mutate();
    else review.mutate(command);
  };
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
          {document.fileName} · {labelValue(document.uploadStatus ?? "unknown")} /{" "}
          {labelValue(document.reviewStatus)}
        </p>
        <p>
          應收：{money(payment?.amount)} · 已核對：{money(payment?.receivedAmount)} · 餘額：
          {money(payment?.balance)}
        </p>
        <p>全付日期：{payment?.paidAt?.slice(0, 10) ?? "待補"}</p>
        <p>狀態：{payment ? paymentStatusLabel(payment.status) : "未有付款紀錄"}</p>
        <SafeDocumentPreview document={document} />
      </div>
      <div className="space-y-2">
        {returned && !entry ? (
          <p>
            退回：{returnReasonLabel(returned.reasonCode)} — {returned.reasonText}
            ；未記錄或入賬任何金額，請補傳後重新覆核。
          </p>
        ) : entry ? (
          <>
            <p>
              已存憑證金額：{money(entry.amount)} · 收款日期：{entry.receivedOn}
            </p>
            <p>憑證記錄：{labelValue(entry.status)}</p>
            {entry.reasonText ? (
              <p>
                退回：{entry.reasonCode ? returnReasonLabel(entry.reasonCode) : "—"} —{" "}
                {entry.reasonText}；請補傳後重新覆核。
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p>憑證金額及收款日期：待補；以下由人手從文件記錄。</p>
            <label className="block">
              文件所示金額（HKD）
              <Input
                aria-label="憑證金額"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                className="ml-2"
              />
            </label>
            <label className="block">
              文件所示收款日期
              <Input
                aria-label="憑證收款日期"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                type="date"
                className="ml-2"
              />
            </label>
            <label className="block">
              交易識別／備註
              <Input
                aria-label="憑證交易參考"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="ml-2"
              />
            </label>
            <Button disabled={disabled || !amount || !date} onClick={() => submit("record")}>
              儲存憑證資料
            </Button>
          </>
        )}
        {!returned && (!entry || entry.status === "pending") ? (
          <>
            {entry ? (
              <Button variant="primary" disabled={disabled} onClick={() => submit("verified")}>
                批准此筆憑證金額
              </Button>
            ) : null}
            <label className="block">
              退回原因
              <Select
                aria-label="退回原因類別"
                value={reasonCode}
                onChange={(e) => setReasonCode(e.target.value as typeof reasonCode)}
              >
                {PAYMENT_RETURN_REASONS.map((code) => (
                  <option key={code} value={code}>
                    {returnReasonLabel(code)}
                  </option>
                ))}
              </Select>
            </label>
            <Textarea
              aria-label="具體退回原因"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="指出需要補回或修正的內容"
              className="block w-full"
            />
            <Button disabled={disabled || !reason.trim()} onClick={() => submit("rejected")}>
              退回補傳
            </Button>
          </>
        ) : null}
        {payment?.evidenceEntries
          ?.filter((e) => e.documentId !== document.id || e.proofVersionId !== versionId)
          .map((e) => (
            <p key={e.id} className="text-xs text-muted-foreground">
              歷史憑證 {labelValue(e.status)} · {money(e.amount)} · {e.receivedOn}
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
