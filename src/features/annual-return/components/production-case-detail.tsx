import { CaseFindings } from "./case-findings";
import { ManualReturnPanel } from "./manual-return-panel";
import { CaseParties } from "./case-parties";
import {
  approveAnnualReturnPackage,
  downloadAnnualReturnPackage,
  getAnnualReturnPackage,
  getAnnualReturnSubmission,
  getAnnualReturnSubmissionReadiness,
  listAnnualReturnSubmissionProofs,
  prepareAnnualReturnPackage,
  recordAnnualReturnSubmission,
} from "../package-server-fns";
import { useEffect, useState } from "react";
import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { PageHeader } from "@/components/page-header";
import {
  annualReturnStatusLabel,
  checklistStatusLabel,
  riskLevelLabel,
  paymentStatusLabel,
} from "@/features/runtime/operational-copy";
import {
  CheckSquare,
  FileCheck2,
  Loader2,
  MessageSquarePlus,
  ReceiptText,
  Send,
  UserRoundCheck,
} from "lucide-react";
import { annualReturnQueryKeys } from "../query-keys";
import { DocumentPicker, StaffPicker } from "./scoped-pickers";
import { createProductionCaseActions } from "./production-case-actions";
import {
  getAnnualReturnCase,
  listAnnualReturnCaseHistory,
  listAnnualReturnCaseNotes,
} from "../server-fns";
import { describeCaseHistoryEntry } from "../case-history";
import {
  ANNUAL_RETURN_STATUSES,
  type AnnualReturnCase,
  type AnnualReturnStatus,
  type ChecklistStatus,
  type PaymentStatus,
} from "../types";

type MutationError = Error | null;
type ChecklistMutationInput = {
  itemId: string;
  status: ChecklistStatus;
  documentId: string | null;
};

const paymentStatuses: PaymentStatus[] = [
  "Not invoiced",
  "Payment pending",
  "Payment received",
  "Overdue",
];

function errorMessage(error: MutationError): string | null {
  return error ? error.message : null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function MutationMessage({ error }: { error: MutationError }) {
  const message = errorMessage(error);
  if (!message) return null;
  return (
    <p role="alert" className="mt-2 text-sm text-destructive">
      {message}
    </p>
  );
}

function PendingIcon({ pending }: { pending: boolean }) {
  return pending ? <Loader2 aria-hidden className="h-4 w-4 animate-spin" /> : null;
}

export function ProductionAnnualReturnCaseDetail({ caseId }: { caseId: string }) {
  const queryClient = useQueryClient();
  const actions = createProductionCaseActions(caseId);
  const checklistMutationKey = [...annualReturnQueryKeys.detail(caseId), "checklist-mutation"];
  const pendingChecklistItemIds = useMutationState({
    filters: { mutationKey: checklistMutationKey, status: "pending" },
    select: (mutation) => (mutation.state.variables as ChecklistMutationInput | undefined)?.itemId,
  });
  const caseQuery = useQuery({
    queryKey: annualReturnQueryKeys.detail(caseId),
    queryFn: () => getAnnualReturnCase({ data: { id: caseId } }),
  });
  const notesQuery = useQuery({
    queryKey: annualReturnQueryKeys.notes(caseId),
    queryFn: () => listAnnualReturnCaseNotes({ data: { caseId } }),
  });
  const historyQuery = useQuery({
    queryKey: annualReturnQueryKeys.history(caseId),
    queryFn: () => listAnnualReturnCaseHistory({ data: { caseId } }),
  });
  const packageKey = [...annualReturnQueryKeys.detail(caseId), "package"];
  const packageQuery = useQuery({
    queryKey: packageKey,
    queryFn: () => getAnnualReturnPackage({ data: { caseId } }),
  });

  const submissionKey = [...annualReturnQueryKeys.detail(caseId), "submission"];
  const submissionQuery = useQuery({
    queryKey: submissionKey,
    queryFn: () => getAnnualReturnSubmission({ data: { caseId } }),
  });
  const submissionReadinessKey = [...annualReturnQueryKeys.detail(caseId), "submission-readiness"];
  const submissionReadinessQuery = useQuery({
    queryKey: [...submissionReadinessKey, packageQuery.data?.id, packageQuery.data?.state],
    queryFn: () => getAnnualReturnSubmissionReadiness({ data: { caseId } }),
    enabled: packageQuery.data?.state === "approved" && !submissionQuery.data,
  });
  const submissionProofKey = [...annualReturnQueryKeys.detail(caseId), "submission-proofs"];
  const submissionProofQuery = useQuery({
    queryKey: submissionProofKey,
    queryFn: () => listAnnualReturnSubmissionProofs({ data: { caseId } }),
    enabled: packageQuery.data?.state === "approved",
  });

  const [ownerId, setOwnerId] = useState("");
  const [nextStatus, setNextStatus] = useState<AnnualReturnStatus>("Upcoming");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("Payment pending");
  const [note, setNote] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [submissionAtHkt, setSubmissionAtHkt] = useState("");
  const [submissionDestination, setSubmissionDestination] = useState("");
  const [submissionReference, setSubmissionReference] = useState("");
  const [submissionProofVersionId, setSubmissionProofVersionId] = useState("");
  const [filingReference, setFilingReference] = useState("");
  const [confirmationDocumentId, setConfirmationDocumentId] = useState("");

  const updateCaseCache = (caseItem: AnnualReturnCase) => {
    queryClient.setQueryData(annualReturnQueryKeys.detail(caseId), caseItem);
    void queryClient.invalidateQueries({ queryKey: annualReturnQueryKeys.all });
  };

  const ownerMutation = useMutation({
    mutationFn: actions.assignOwner,
    onSuccess: updateCaseCache,
  });
  const statusMutation = useMutation({
    mutationFn: actions.updateStatus,
    onSuccess: updateCaseCache,
  });
  const checklistMutation = useMutation({
    mutationKey: checklistMutationKey,
    mutationFn: actions.updateChecklist,
    onSuccess: updateCaseCache,
  });
  const paymentMutation = useMutation({
    mutationFn: actions.updatePayment,
    onSuccess: updateCaseCache,
  });
  const noteMutation = useMutation({
    mutationFn: actions.addNote,
    onSuccess: () => {
      setNote("");
      void queryClient.invalidateQueries({ queryKey: annualReturnQueryKeys.notes(caseId) });
    },
  });
  const reminderMutation = useMutation({
    mutationFn: actions.sendReminder,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: annualReturnQueryKeys.detail(caseId) });
      void queryClient.invalidateQueries({ queryKey: annualReturnQueryKeys.notifications(caseId) });
    },
  });
  const preparePackageMutation = useMutation({
    mutationFn: (expectedRevision: number) =>
      prepareAnnualReturnPackage({ data: { caseId, expectedRevision } }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: packageKey }),
  });
  const approvePackageMutation = useMutation({
    mutationFn: (data: { packageId: string; manifestHash: string; expectedRevision: number }) =>
      approveAnnualReturnPackage({ data }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: packageKey }),
  });
  const downloadPackageMutation = useMutation({
    mutationFn: async (packageId: string) => {
      const response = await downloadAnnualReturnPackage({ data: { packageId } });
      if (!response.ok) throw new Error("Approved package download failed.");
      const blob = await response.blob();
      const filename =
        response.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "NAR1.zip";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    },
  });
  const recordSubmissionMutation = useMutation({
    mutationFn: () => {
      const approved = packageQuery.data;
      if (!approved || approved.state !== "approved") {
        throw new Error("Approve the current package before recording submission.");
      }
      return recordAnnualReturnSubmission({
        data: {
          packageId: approved.id,
          manifestHash: approved.manifestHash,
          expectedRevision: approved.revision,
          submittedAt: submissionAtHkt + (submissionAtHkt.length === 16 ? ":00+08:00" : "+08:00"),
          destinationLabel: submissionDestination.trim(),
          externalReference: submissionReference.trim(),
          proofVersionId: submissionProofVersionId,
        },
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: submissionKey });
      void queryClient.invalidateQueries({ queryKey: submissionReadinessKey });
      void queryClient.invalidateQueries({ queryKey: annualReturnQueryKeys.history(caseId) });
    },
  });
  const receiptMutation = useMutation({
    mutationFn: actions.acceptReceipt,
    onSuccess: updateCaseCache,
  });

  const caseItem = caseQuery.data;

  useEffect(() => {
    if (!caseItem) return;
    setOwnerId((current) => current || caseItem.ownerId);
    setNextStatus(caseItem.currentStatus);
    setPaymentStatus(caseItem.payment?.status ?? "Not invoiced");
    setFilingReference((current) => current || caseItem.filingReference || "");
    setConfirmationDocumentId((current) => current || caseItem.confirmationDocumentId || "");
  }, [caseItem]);

  if (caseQuery.isPending) {
    return (
      <div className="flex min-h-64 items-center justify-center p-6 text-sm text-muted-foreground">
        <Loader2 aria-hidden className="mr-2 h-4 w-4 animate-spin" />
        正在載入周年申報案件…
      </div>
    );
  }

  if (caseQuery.isError) {
    return (
      <main className="flex-1 space-y-3 p-6">
        <PageHeader eyebrow="周年申報案件" title="暫時無法讀取案件" />
        <p role="alert" className="text-sm text-destructive">
          無法載入此案件。請由負責同事重試；持續失敗時聯絡系統管理員。
        </p>
        <button
          className="inline-flex rounded-md border px-3 py-2 text-sm"
          onClick={() => void caseQuery.refetch()}
          type="button"
        >
          重試載入
        </button>
        <Link className="inline-flex rounded-md border px-3 py-2 text-sm" to="/annual-returns">
          返回周年申報案件板
        </Link>
      </main>
    );
  }

  if (!caseItem) {
    return (
      <main className="flex-1 space-y-3 p-6">
        <PageHeader eyebrow="周年申報案件" title="找不到案件" />
        <p className="text-sm text-muted-foreground">請由負責同事返回案件板核對公司及年度。</p>
        <Link className="inline-flex rounded-md border px-3 py-2 text-sm" to="/annual-returns">
          返回周年申報案件板
        </Link>
      </main>
    );
  }

  const locked = caseItem.currentStatus === "Completed";

  return (
    <main className="flex-1 space-y-4 p-4 md:p-6">
      <div className="border-b pb-4">
        <PageHeader
          eyebrow="周年申報案件"
          title={caseItem.companyName}
          subtitle={`${caseItem.returnYear} 年申報 · 到期日 ${caseItem.filingDueDate}（香港時間）`}
          actions={
            <div className="flex items-center gap-3">
              {/* The demo case detail has always had this. Without it in
                  production there was no link anywhere carrying a caseId, so
                  /portal was unreachable except by hand-editing the URL. */}
              <Link
                className="rounded-md border px-3 py-2 text-sm"
                to="/portal"
                search={{ caseId: caseItem.id }}
              >
                開啟客戶門戶
              </Link>
              <div className="text-right text-sm">
                <p className="font-medium">{annualReturnStatusLabel(caseItem.currentStatus)}</p>
                <p className="text-muted-foreground">{riskLevelLabel(caseItem.riskLevel)}</p>
              </div>
            </div>
          }
        />
      </div>

      <nav aria-label="案件部分" className="flex flex-wrap gap-2 text-sm">
        <a className="rounded-md border px-3 py-2" href="#documents">
          文件
        </a>
        <a className="rounded-md border px-3 py-2" href="#payment">
          付款
        </a>
        <a className="rounded-md border px-3 py-2" href="#reminders">
          追件訊息
        </a>
        <a className="rounded-md border px-3 py-2" href="#filing">
          交件
        </a>
        <a className="rounded-md border px-3 py-2" href="#returns">
          回件
        </a>
        <a className="rounded-md border px-3 py-2" href="#audit">
          審計紀錄
        </a>
      </nav>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <section className="border-b pb-4">
            <h2 className="text-base font-semibold">案件控制</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <StaffPicker
                  id="owner-id"
                  label="負責同事"
                  value={ownerId}
                  onChange={setOwnerId}
                  disabled={locked || ownerMutation.isPending}
                />
                <button
                  className="mt-2 inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                  disabled={locked || ownerMutation.isPending || !isUuid(ownerId)}
                  onClick={() => ownerMutation.mutate(ownerId)}
                  type="button"
                >
                  <PendingIcon pending={ownerMutation.isPending} />
                  <UserRoundCheck aria-hidden className="h-4 w-4" />
                  指派
                </button>
                <MutationMessage error={ownerMutation.error} />
              </div>

              <div>
                <label className="text-sm font-medium" htmlFor="case-status">
                  案件狀態
                </label>
                <div className="mt-1 flex gap-2">
                  <select
                    id="case-status"
                    className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
                    value={nextStatus}
                    onChange={(event) => setNextStatus(event.target.value as AnnualReturnStatus)}
                  >
                    {ANNUAL_RETURN_STATUSES.filter(
                      (status) =>
                        (status !== "NAR1 prepared" && status !== "Filed") ||
                        status === caseItem.currentStatus,
                    ).map((status) => (
                      <option key={status} value={status}>
                        {annualReturnStatusLabel(status)}
                      </option>
                    ))}
                  </select>
                  <button
                    className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                    disabled={
                      locked || statusMutation.isPending || nextStatus === caseItem.currentStatus
                    }
                    onClick={() => statusMutation.mutate(nextStatus)}
                    type="button"
                  >
                    <PendingIcon pending={statusMutation.isPending} />
                    更新
                  </button>
                </div>
                <MutationMessage error={statusMutation.error} />
              </div>
            </div>
          </section>

          <section className="border-b pb-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">所需文件清單</h2>
              <span className="text-sm text-muted-foreground">
                {caseItem.checklist.filter((item) => item.status === "Verified").length}/
                {caseItem.checklist.length} 已核實
              </span>
            </div>
            <div className="mt-3 divide-y border-y">
              {caseItem.checklist.map((item) => {
                const nextChecklistStatus: ChecklistStatus =
                  item.status === "Missing"
                    ? "Received"
                    : item.status === "Received" && item.documentId
                      ? "Verified"
                      : "Missing";
                return (
                  <div key={item.id} className="flex items-center justify-between gap-3 py-3">
                    <div>
                      <p className="text-sm font-medium">{item.itemLabel}</p>
                      <p className="text-xs text-muted-foreground">
                        {checklistStatusLabel(item.status)}
                      </p>
                    </div>
                    <button
                      className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                      disabled={locked || pendingChecklistItemIds.includes(item.id)}
                      onClick={() =>
                        checklistMutation.mutate({
                          itemId: item.id,
                          status: nextChecklistStatus,
                          documentId: nextChecklistStatus === "Missing" ? null : item.documentId,
                        })
                      }
                      type="button"
                    >
                      <CheckSquare aria-hidden className="h-4 w-4" />
                      {nextChecklistStatus === "Verified"
                        ? "核實證據"
                        : nextChecklistStatus === "Missing"
                          ? "標記欠缺"
                          : "標記已收到"}
                    </button>
                  </div>
                );
              })}
            </div>
            <MutationMessage error={checklistMutation.error} />
          </section>

          <CaseParties caseId={caseId} locked={locked} />

          <CaseFindings caseId={caseId} locked={locked} />

          <section id="payment" className="scroll-mt-8 border-b pb-4">
            <h2 className="text-base font-semibold">付款</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-[12rem_auto]">
              <select
                aria-label="付款狀態"
                className="rounded-md border bg-background px-3 py-2 text-sm"
                value={paymentStatus}
                onChange={(event) => setPaymentStatus(event.target.value as PaymentStatus)}
              >
                {paymentStatuses.map((status) => (
                  <option key={status} value={status} disabled={status === "Payment received"}>
                    {paymentStatusLabel(status)}
                  </option>
                ))}
              </select>
              <button
                className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                disabled={
                  locked || paymentMutation.isPending || paymentStatus === "Payment received"
                }
                onClick={() =>
                  paymentMutation.mutate({
                    status: paymentStatus,
                    paymentProofDocumentId: null,
                  })
                }
                type="button"
              >
                <PendingIcon pending={paymentMutation.isPending} />
                更新付款狀態
              </button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              只有負責同事在付款頁面以已覆核憑證對應發票後，系統才會標記「已核實付款」。
            </p>
            <MutationMessage error={paymentMutation.error} />
          </section>

          <section className="border-b pb-4">
            <h2 className="text-base font-semibold">交件套件</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              先準備有版本的 ZIP，批准其確切清單，再下載供人手外部上載。下載不代表已交件。
            </p>
            {packageQuery.isError && <MutationMessage error={packageQuery.error} />}
            {packageQuery.data && (
              <details className="mt-2 text-sm">
                <summary>套件技術詳情</summary>
                <p>
                  版本 {packageQuery.data.revision} · 狀態 {packageQuery.data.state}
                </p>
                <p>
                  Manifest SHA-256：
                  <code className="break-all">{packageQuery.data.manifestHash}</code>
                </p>
              </details>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                disabled={locked || packageQuery.isPending || preparePackageMutation.isPending}
                onClick={() => preparePackageMutation.mutate(packageQuery.data?.revision ?? 0)}
                type="button"
              >
                <PendingIcon pending={preparePackageMutation.isPending} />
                <FileCheck2 aria-hidden className="h-4 w-4" />
                準備套件
              </button>
              {packageQuery.data?.state === "draft" && (
                <button
                  className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                  disabled={locked || approvePackageMutation.isPending}
                  onClick={() =>
                    approvePackageMutation.mutate({
                      packageId: packageQuery.data!.id,
                      manifestHash: packageQuery.data!.manifestHash,
                      expectedRevision: packageQuery.data!.revision,
                    })
                  }
                  type="button"
                >
                  批准套件
                </button>
              )}
              {packageQuery.data?.state === "approved" && (
                <button
                  className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                  disabled={downloadPackageMutation.isPending}
                  onClick={() => downloadPackageMutation.mutate(packageQuery.data!.id)}
                  type="button"
                >
                  下載已批准 ZIP
                </button>
              )}
            </div>
            <MutationMessage error={preparePackageMutation.error} />
            <MutationMessage error={approvePackageMutation.error} />
            <MutationMessage error={downloadPackageMutation.error} />
          </section>

          <section id="filing" className="scroll-mt-8 border-b pb-4">
            <h2 className="text-base font-semibold">記錄人手交件</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              有人在 Kossilon 以外上載已批准 ZIP
              後，請由負責同事填寫外部目的地、參考編號及已覆核交件證明。這只記錄交件主張，不代表註冊處已接納，亦不會標記為已交件。
            </p>
            {submissionQuery.isError && <MutationMessage error={submissionQuery.error} />}
            {packageQuery.data?.state === "approved" && !submissionQuery.data && (
              <div className="mt-3 text-sm" role="status">
                {submissionReadinessQuery.isPending
                  ? "正在核實套件、付款及文件證據…"
                  : submissionReadinessQuery.isError
                    ? "目前無法核實交件條件，請稍後重新檢查。"
                    : submissionReadinessQuery.data?.state === "ready"
                      ? "已核實目前套件；完成外部人手上載後，才能在此記錄交件證明。"
                      : submissionReadinessQuery.data?.reason === "existing-handoff"
                        ? "案件已有交件記錄，請先核對現有交件及回件。"
                        : submissionReadinessQuery.data?.reason === "case-closed"
                          ? "已申報或已結案的案件不能再記錄新交件。"
                          : "目前套件或證據未能核實，請重新準備及批准套件後再檢查。"}
                {(submissionReadinessQuery.isError ||
                  submissionReadinessQuery.data?.state === "unknown") && (
                  <button
                    className="ml-2 underline"
                    type="button"
                    onClick={() => void submissionReadinessQuery.refetch()}
                  >
                    重新核實交件條件
                  </button>
                )}
              </div>
            )}
            {submissionProofQuery.isError && <MutationMessage error={submissionProofQuery.error} />}
            {submissionQuery.data ? (
              <div className="mt-3 text-sm">
                <p>
                  Recorded{" "}
                  {new Date(submissionQuery.data.recordedAtUtc).toLocaleString("en-HK", {
                    timeZone: "Asia/Hong_Kong",
                  })}{" "}
                  HKT.
                </p>
                <p>目的地： {submissionQuery.data.destinationLabel}</p>
                <p>外部參考編號： {submissionQuery.data.externalReference}</p>
                <p>狀態：已記錄交件主張；仍待外部回件證據確認是否接納。</p>
              </div>
            ) : packageQuery.data?.state === "approved" ? (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <label className="text-sm">
                  外部交件目的地
                  <input
                    aria-label="外部交件目的地"
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2"
                    maxLength={120}
                    value={submissionDestination}
                    onChange={(event) => setSubmissionDestination(event.target.value)}
                  />
                </label>
                <label className="text-sm">
                  外部參考編號
                  <input
                    aria-label="外部參考編號"
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2"
                    maxLength={200}
                    value={submissionReference}
                    onChange={(event) => setSubmissionReference(event.target.value)}
                  />
                </label>
                <label className="text-sm">
                  交件時間（香港時間 UTC+08:00）
                  <input
                    aria-label="交件時間（香港）"
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2"
                    type="datetime-local"
                    value={submissionAtHkt}
                    onChange={(event) => setSubmissionAtHkt(event.target.value)}
                  />
                </label>
                <label className="text-sm">
                  已覆核外部交件證明
                  <select
                    aria-label="已覆核外部交件證明"
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2"
                    value={submissionProofVersionId}
                    onChange={(event) => setSubmissionProofVersionId(event.target.value)}
                  >
                    <option value="">選擇已覆核交件或回執文件</option>
                    {submissionProofQuery.data?.map((proof) => (
                      <option key={proof.versionId} value={proof.versionId}>
                        {proof.fileName} ({proof.category})
                      </option>
                    ))}
                  </select>
                </label>
                <div className="md:col-span-2 flex flex-wrap gap-2">
                  <button
                    className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                    type="button"
                    onClick={() => void submissionProofQuery.refetch()}
                    disabled={submissionProofQuery.isFetching}
                  >
                    重新載入證明清單
                  </button>
                  <button
                    className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                    type="button"
                    disabled={
                      locked ||
                      recordSubmissionMutation.isPending ||
                      submissionReadinessQuery.data?.state !== "ready" ||
                      !submissionDestination.trim() ||
                      !submissionReference.trim() ||
                      !submissionAtHkt ||
                      !submissionProofVersionId
                    }
                    onClick={() => recordSubmissionMutation.mutate()}
                  >
                    <PendingIcon pending={recordSubmissionMutation.isPending} />
                    記錄外部交件
                  </button>
                </div>
              </div>
            ) : null}
            <MutationMessage error={recordSubmissionMutation.error} />
          </section>

          <ManualReturnPanel caseId={caseId} />

          <section className="pb-2">
            <h2 className="text-base font-semibold">確認交件回執</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <input
                aria-label="交件參考編號"
                className="min-w-0 rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="交件參考編號"
                value={filingReference}
                onChange={(event) => setFilingReference(event.target.value)}
              />
              <DocumentPicker
                id="confirmation-document"
                label="已核實回執文件"
                caseId={caseItem.id}
                categories={["receipt", "submission", "registry"]}
                value={confirmationDocumentId}
                onChange={setConfirmationDocumentId}
                disabled={locked || receiptMutation.isPending}
              />
              <button
                className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                disabled={
                  locked ||
                  receiptMutation.isPending ||
                  !filingReference.trim() ||
                  !isUuid(confirmationDocumentId)
                }
                onClick={() =>
                  receiptMutation.mutate({
                    filingReference: filingReference.trim(),
                    confirmationDocumentId,
                  })
                }
                type="button"
              >
                <PendingIcon pending={receiptMutation.isPending} />
                <ReceiptText aria-hidden className="h-4 w-4" />
                確認回執
              </button>
            </div>
            <MutationMessage error={receiptMutation.error} />
          </section>
        </div>

        <aside className="space-y-4 border-t pt-4 xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0">
          <section className="border-b pb-4">
            <h2 className="text-base font-semibold">備註</h2>
            <textarea
              aria-label="案件備註"
              className="mt-3 min-h-24 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <button
              className="mt-2 inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm disabled:opacity-50"
              disabled={locked || noteMutation.isPending || !note.trim()}
              onClick={() => noteMutation.mutate(note.trim())}
              type="button"
            >
              <PendingIcon pending={noteMutation.isPending} />
              <MessageSquarePlus aria-hidden className="h-4 w-4" />
              新增備註
            </button>
            <MutationMessage error={noteMutation.error} />
            <div className="mt-4 space-y-3">
              {notesQuery.isPending ? (
                <p className="text-sm text-muted-foreground">正在載入備註…</p>
              ) : notesQuery.isError ? (
                <p role="alert" className="text-sm text-destructive">
                  {notesQuery.error.message}
                </p>
              ) : notesQuery.data.length === 0 ? (
                <p className="text-sm text-muted-foreground">暫無備註。</p>
              ) : (
                notesQuery.data.map((entry) => (
                  <div key={entry.id} className="border-l-2 pl-3">
                    <p className="text-sm">{entry.body}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleString("zh-HK", {
                        timeZone: "Asia/Hong_Kong",
                      })}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>

          <section id="audit" className="scroll-mt-8 border-b pb-4">
            <h2 className="text-base font-semibold">審計紀錄</h2>
            {historyQuery.isPending ? (
              <p className="mt-3 text-sm text-muted-foreground">正在載入紀錄…</p>
            ) : historyQuery.isError ? (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {historyQuery.error.message}
              </p>
            ) : historyQuery.data.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">暫無紀錄。</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {/* mergeCaseHistory already returns newest-first (with an id tiebreak for
                    rows written in one transaction), so this is a no-op on real data —
                    Array#sort is stable, so equal timestamps keep the server's order. It
                    stays because ordering is compliance-visible and the interaction test
                    mocks the server fn directly, bypassing that sort. */}
                {[...historyQuery.data]
                  .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                  .map((entry) => {
                    const { label, description } = describeCaseHistoryEntry(entry);
                    const actorName =
                      entry.kind === "audit" ? (entry.actorName ?? "系統") : entry.assignedByName;
                    return (
                      <li key={entry.id} className="border-l-2 pl-3">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-medium">{label}</p>
                          <p className="text-xs text-muted-foreground">
                            {new Date(entry.createdAt).toLocaleString("zh-HK", {
                              timeZone: "Asia/Hong_Kong",
                            })}
                          </p>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
                        <p className="mt-1 text-xs text-muted-foreground">執行者：{actorName}</p>
                      </li>
                    );
                  })}
              </ul>
            )}
          </section>

          <section id="reminders" className="scroll-mt-8">
            <h2 className="text-base font-semibold">WhatsApp 追件</h2>
            <div className="mt-3 space-y-2">
              <input
                aria-label="追件收件人姓名"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="收件人姓名"
                value={recipientName}
                onChange={(event) => setRecipientName(event.target.value)}
              />
              <input
                aria-label="追件電話"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="+852..."
                value={recipientPhone}
                onChange={(event) => setRecipientPhone(event.target.value)}
              />
              <button
                className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                disabled={
                  locked ||
                  reminderMutation.isPending ||
                  !recipientName.trim() ||
                  recipientPhone.trim().length < 3
                }
                onClick={() =>
                  reminderMutation.mutate({
                    recipientName: recipientName.trim(),
                    recipientPhone: recipientPhone.trim(),
                  })
                }
                type="button"
              >
                <PendingIcon pending={reminderMutation.isPending} />
                <Send aria-hidden className="h-4 w-4" />
                發送追件訊息
              </button>
            </div>
            <MutationMessage error={reminderMutation.error} />
          </section>
        </aside>
      </div>
    </main>
  );
}
