import { LoadingRows } from "@/components/ui/skeleton";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { CaseFindings } from "./case-findings";
import { CaseHandoff } from "./case-handoff";
import { caseReturnPath, dailyViewSearch } from "../daily-view-state";
import { readinessForCase } from "../readiness";
import { parseEntityId } from "@/lib/entity-id";
import { CaseParties } from "./case-parties";
import { useEffect, useState } from "react";
import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
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
  annualReturnStatusLabel,
  checklistStatusLabel,
  paymentStatusLabel,
  riskLevelLabel,
} from "../labels";
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
  return parseEntityId(value) !== null;
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

export function ProductionAnnualReturnCaseDetail({
  caseId,
  returnTo = "/annual-returns",
  actorScope = "session",
}: {
  caseId: string;
  returnTo?: string;
  actorScope?: string;
}) {
  const queryClient = useQueryClient();
  const actions = createProductionCaseActions(
    caseId,
    undefined,
    () =>
      queryClient.getQueryData<AnnualReturnCase>(annualReturnQueryKeys.detail(caseId))?.readiness
        ?.sourceVersion,
  );
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

  const [ownerId, setOwnerId] = useState("");
  const [nextStatus, setNextStatus] = useState<AnnualReturnStatus>("Upcoming");
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>("Payment pending");
  const [paymentProofDocumentId, setPaymentProofDocumentId] = useState("");
  const [note, setNote] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
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
  const packetMutation = useMutation({
    mutationFn: actions.submitPacket,
    onSuccess: updateCaseCache,
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
    setPaymentProofDocumentId(
      (current) => current || caseItem.payment?.paymentProofDocumentId || "",
    );
    setFilingReference((current) => current || caseItem.filingReference || "");
    setConfirmationDocumentId((current) => current || caseItem.confirmationDocumentId || "");
  }, [caseItem]);

  if (caseQuery.isPending) {
    return <LoadingRows label="正在載入周年申報案件" rows={6} className="p-6" />;
  }

  if (caseQuery.isError) {
    return (
      <main className="flex-1 space-y-3 p-6">
        <PageHeader eyebrow="案件與客戶" title="無法載入周年申報案件" />
        <p role="alert" className="text-sm text-destructive">
          {caseQuery.error.message}
        </p>
        <Button asChild>
          <Link to="/annual-returns">返回周年申報</Link>
        </Button>
      </main>
    );
  }

  if (!caseItem) {
    return (
      <main className="flex-1 space-y-3 p-6">
        <PageHeader eyebrow="案件與客戶" title="找不到案件" />
        <Button asChild>
          <Link to="/annual-returns">返回周年申報</Link>
        </Button>
      </main>
    );
  }

  const readiness = readinessForCase(caseItem);
  const packetReady = readiness.readyToPrepare && Boolean(readiness.sourceVersion);
  const locked = Boolean(
    caseItem.lockedAt || caseItem.completedAt || caseItem.currentStatus === "Completed",
  );

  return (
    <main className="flex-1 space-y-4 p-4 md:p-6">
      <div className="border-b pb-4">
        <PageHeader
          eyebrow="案件與客戶"
          title={caseItem.companyName}
          subtitle={`申報年度 ${caseItem.returnYear} · 到期日 ${formatDate(caseItem.filingDueDate)}`}
          actions={
            <div className="flex flex-wrap items-center gap-3">
              {caseReturnPath(returnTo).startsWith("/today") ? (
                <Button asChild className="min-h-11">
                  <Link
                    to="/today"
                    search={dailyViewSearch(
                      Object.fromEntries(
                        new URL(caseReturnPath(returnTo), "https://kossilon.invalid").searchParams,
                      ),
                    )}
                  >
                    返回工作列表
                  </Link>
                </Button>
              ) : (
                <Button asChild className="min-h-11">
                  <Link to="/annual-returns">返回工作列表</Link>
                </Button>
              )}

              {/* The demo case detail has always had this. Without it in
                  production there was no link anywhere carrying a caseId, so
                  /portal was unreachable except by hand-editing the URL. */}
              <Button asChild>
                <Link to="/portal" search={{ caseId: caseItem.id }}>
                  開啟客戶入口
                </Link>
              </Button>
              <div className="text-right text-sm">
                <p className="font-medium">{annualReturnStatusLabel(caseItem.currentStatus)}</p>
                <p className="text-muted-foreground">風險：{riskLevelLabel(caseItem.riskLevel)}</p>
              </div>
            </div>
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-4">
          <section className="border-b pb-4">
            <h2 className="text-base font-semibold">案件操作</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <StaffPicker
                  actorScope={actorScope}
                  id="owner-id"
                  label="負責同事"
                  value={ownerId}
                  onChange={setOwnerId}
                  disabled={locked || ownerMutation.isPending}
                />
                <Button
                  className="mt-2"
                  disabled={locked || ownerMutation.isPending || !isUuid(ownerId)}
                  onClick={() => ownerMutation.mutate(ownerId)}
                  type="button"
                >
                  <PendingIcon pending={ownerMutation.isPending} />
                  <UserRoundCheck aria-hidden className="h-4 w-4" />
                  分配
                </Button>
                <MutationMessage error={ownerMutation.error} />
              </div>

              <div>
                <label className="text-sm font-medium" htmlFor="case-status">
                  案件狀態
                </label>
                <div className="mt-1 flex gap-2">
                  <Select
                    id="case-status"
                    className="min-w-0 flex-1"
                    value={nextStatus}
                    onChange={(event) => setNextStatus(event.target.value as AnnualReturnStatus)}
                  >
                    {ANNUAL_RETURN_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {annualReturnStatusLabel(status)}
                      </option>
                    ))}
                  </Select>
                  <Button
                    disabled={
                      locked || statusMutation.isPending || nextStatus === caseItem.currentStatus
                    }
                    onClick={() => statusMutation.mutate(nextStatus)}
                    type="button"
                  >
                    <PendingIcon pending={statusMutation.isPending} />
                    更新
                  </Button>
                </div>
                <MutationMessage error={statusMutation.error} />
              </div>
            </div>
          </section>

          <section className="border-b pb-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">必要清單</h2>
              <span className="text-sm text-muted-foreground">
                已核對 {caseItem.checklist.filter((item) => item.status === "Verified").length}/
                {caseItem.checklist.length}
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
                    <Button
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
                        ? "核對證明"
                        : nextChecklistStatus === "Missing"
                          ? "標記為缺少"
                          : "標記為已收到"}
                    </Button>
                  </div>
                );
              })}
            </div>
            <MutationMessage error={checklistMutation.error} />
          </section>

          <CaseParties caseId={caseId} locked={locked} />

          <CaseFindings caseId={caseId} locked={locked} />

          <CaseHandoff caseId={caseId} locked={locked} actorScope={actorScope} />

          <section className="border-b pb-4">
            <h2 className="text-base font-semibold">付款</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-[12rem_minmax(0,1fr)_auto]">
              <Select
                aria-label="付款狀態"
                className="w-full"
                value={paymentStatus}
                onChange={(event) => setPaymentStatus(event.target.value as PaymentStatus)}
              >
                {paymentStatuses.map((status) => (
                  <option key={status} value={status}>
                    {paymentStatusLabel(status)}
                  </option>
                ))}
              </Select>
              <DocumentPicker
                actorScope={actorScope}
                id="payment-proof-document"
                label="付款證明文件"
                caseId={caseItem.id}
                categories={["payment", "receipt", "other"]}
                value={paymentProofDocumentId}
                onChange={setPaymentProofDocumentId}
                disabled={locked || paymentMutation.isPending}
              />
              <Button
                disabled={
                  locked ||
                  paymentMutation.isPending ||
                  (paymentStatus === "Payment received" && !isUuid(paymentProofDocumentId))
                }
                onClick={() =>
                  paymentMutation.mutate({
                    status: paymentStatus,
                    paymentProofDocumentId:
                      paymentStatus === "Payment received" ? paymentProofDocumentId : null,
                  })
                }
                type="button"
              >
                <PendingIcon pending={paymentMutation.isPending} />
                更新付款
              </Button>
            </div>
            <MutationMessage error={paymentMutation.error} />
          </section>

          <section className="border-b pb-4">
            <h2 className="text-base font-semibold">交件套件</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              先核對當前文件版本及付款證據，再準備套件；準備或下載不等於外部提交。
            </p>
            <ul className="mt-2 space-y-1 text-sm" aria-label="交件阻礙事項">
              {readiness.blockers.map((blocker, index) => (
                <li key={`${blocker.code}:${index}`}>
                  <span className="text-muted-foreground">
                    {blocker.stage === "prepare"
                      ? "準備"
                      : blocker.stage === "approval"
                        ? "批准"
                        : "送出"}
                    ：
                  </span>
                  {blocker.message}
                  <Button asChild variant="link" className="ml-2 underline">
                    <a href={blocker.action}>處理</a>
                  </Button>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                disabled={locked || packetMutation.isPending || !packetReady}
                onClick={() => packetMutation.mutate()}
                type="button"
              >
                <PendingIcon pending={packetMutation.isPending} />
                <FileCheck2 aria-hidden className="h-4 w-4" />
                準備交件套件
              </Button>
            </div>
            <MutationMessage error={packetMutation.error} />
          </section>

          <section className="pb-2">
            <h2 className="text-base font-semibold">接納遞交回條</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <Input
                aria-label="遞交編號"
                className="w-full min-w-0"
                placeholder="遞交編號"
                value={filingReference}
                onChange={(event) => setFilingReference(event.target.value)}
              />
              <DocumentPicker
                actorScope={actorScope}
                id="confirmation-document"
                label="已核對回條文件"
                caseId={caseItem.id}
                categories={["receipt", "submission", "registry"]}
                value={confirmationDocumentId}
                onChange={setConfirmationDocumentId}
                disabled={locked || receiptMutation.isPending}
              />
              <Button
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
                接納回條
              </Button>
            </div>
            <MutationMessage error={receiptMutation.error} />
          </section>
        </div>

        <aside className="space-y-4 border-t pt-4 xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0">
          <section className="border-b pb-4">
            <h2 className="text-base font-semibold">備註</h2>
            <Textarea
              aria-label="案件備註"
              className="mt-3 min-h-24 w-full resize-y"
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
            <Button
              className="mt-2"
              disabled={locked || noteMutation.isPending || !note.trim()}
              onClick={() => noteMutation.mutate(note.trim())}
              type="button"
            >
              <PendingIcon pending={noteMutation.isPending} />
              <MessageSquarePlus aria-hidden className="h-4 w-4" />
              加入備註
            </Button>
            <MutationMessage error={noteMutation.error} />
            <div className="mt-4 space-y-3">
              {notesQuery.isPending ? (
                <LoadingRows label="正在載入備註…" rows={2} className="p-0" />
              ) : notesQuery.isError ? (
                <p role="alert" className="text-sm text-destructive">
                  {notesQuery.error.message}
                </p>
              ) : notesQuery.data.length === 0 ? (
                <p className="text-sm text-muted-foreground">暫時沒有備註。</p>
              ) : (
                notesQuery.data.map((entry) => (
                  <div key={entry.id} className="border-l-2 pl-3">
                    <p className="text-sm">{entry.body}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatDateTime(entry.createdAt)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="border-b pb-4">
            <h2 className="text-base font-semibold">審計記錄</h2>
            {historyQuery.isPending ? (
              <LoadingRows label="正在載入記錄…" rows={3} className="mt-3 p-0" />
            ) : historyQuery.isError ? (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {historyQuery.error.message}
              </p>
            ) : historyQuery.data.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">暫時沒有記錄。</p>
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
                            {formatDateTime(entry.createdAt)}
                          </p>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
                        <p className="mt-1 text-xs text-muted-foreground">操作人：{actorName}</p>
                      </li>
                    );
                  })}
              </ul>
            )}
          </section>

          <section>
            <h2 className="text-base font-semibold">WhatsApp 提醒</h2>
            <div className="mt-3 space-y-2">
              <Input
                aria-label="提醒收件人姓名"
                className="w-full"
                placeholder="收件人姓名"
                value={recipientName}
                onChange={(event) => setRecipientName(event.target.value)}
              />
              <Input
                aria-label="提醒電話號碼"
                className="w-full"
                placeholder="+852..."
                value={recipientPhone}
                onChange={(event) => setRecipientPhone(event.target.value)}
              />
              <Button
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
                發送提醒
              </Button>
            </div>
            <MutationMessage error={reminderMutation.error} />
          </section>
        </aside>
      </div>
    </main>
  );
}
