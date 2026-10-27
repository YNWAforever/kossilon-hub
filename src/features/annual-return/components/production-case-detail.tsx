import { ChecklistItemLabel } from "@/components/checklist-item-label";
import { LoadingRows } from "@/components/ui/skeleton";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { CaseFindings } from "./case-findings";
import { CaseHandoff } from "./case-handoff";
import { caseReturnPath } from "../daily-view-state";
import { readinessForCase } from "../readiness";
import { parseEntityId } from "@/lib/entity-id";
import { CaseParties } from "./case-parties";
import { useEffect, useRef, useState } from "react";
import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";

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

type CaseDetailProps = {
  caseId: string;
  returnTo?: string;
  actorScope?: string;
};

export function ProductionAnnualReturnCaseDetail(props: CaseDetailProps) {
  // A truncated or hand-edited link can never name a case. Asking the server
  // anyway only fails schema validation, which the query retried behind an
  // endless loading state before showing the raw validation error.
  if (parseEntityId(props.caseId) === null) return <CaseNotFound returnTo={props.returnTo} />;
  return (
    <CaseDetail key={JSON.stringify([props.caseId, props.actorScope ?? "session"])} {...props} />
  );
}

function CaseNotFound({ returnTo }: Pick<CaseDetailProps, "returnTo">) {
  return (
    <main className="flex-1 space-y-3 p-6">
      <PageHeader eyebrow="案件與客戶" title="找不到案件" />
      <Button asChild>
        <a href={caseReturnPath(returnTo)}>返回工作列表</a>
      </Button>
    </main>
  );
}

function CaseDetail({
  caseId,
  returnTo = "/annual-returns",
  actorScope = "session",
}: CaseDetailProps) {
  const queryClient = useQueryClient();
  const actions = createProductionCaseActions(
    caseId,
    undefined,
    () =>
      queryClient.getQueryData<AnnualReturnCase>(annualReturnQueryKeys.detail(caseId))?.readiness
        ?.sourceVersion,
  );
  const caseAlive = useRef(true);
  const uncertainCase = useRef(false);
  const recoveringCase = useRef(false);
  const statusSubmitting = useRef(false);
  const ownerSubmitting = useRef(false);
  const ownerNeedsRead = useRef(false);
  const checklistSubmitting = useRef(new Set<string>());
  const [caseRecovery, setCaseRecovery] = useState<"none" | "required" | "reading" | "failed">(
    "none",
  );
  useEffect(() => {
    caseAlive.current = true;
    return () => {
      caseAlive.current = false;
    };
  }, []);
  const commandKey = [...annualReturnQueryKeys.detail(caseId), "case-command"];
  const pendingCaseCommands = useMutationState({
    filters: { mutationKey: annualReturnQueryKeys.detail(caseId), status: "pending" },
    select: () => true,
  });
  const requireCaseReadback = () => {
    uncertainCase.current = true;
    if (caseAlive.current) setCaseRecovery("required");
  };
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
  const noteSubmission = useRef<string | null>(null);
  const noteRecovering = useRef(false);
  const [noteRecovery, setNoteRecovery] = useState<"none" | "required" | "reading" | "checked">(
    "none",
  );
  const noteBlocked = noteRecovery === "required" || noteRecovery === "reading";
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [filingReference, setFilingReference] = useState("");
  const [confirmationDocumentId, setConfirmationDocumentId] = useState("");

  const updateCaseCache = (caseItem: AnnualReturnCase) => {
    if (!caseAlive.current) return;
    queryClient.setQueryData(annualReturnQueryKeys.detail(caseId), caseItem);
    void queryClient.invalidateQueries({ queryKey: annualReturnQueryKeys.all });
  };
  // Commands used to succeed silently: the form simply re-rendered, which
  // left it to the user to spot whether anything happened. Checklist rows are
  // the exception — their status pill changes in place, right where you clicked.
  const updateCaseCacheAndConfirm = (message: string) => (caseItem: AnnualReturnCase) => {
    updateCaseCache(caseItem);
    toast.success(message);
  };

  const ownerMutation = useMutation({
    mutationKey: commandKey,
    mutationFn: actions.assignOwner,
    retry: false,
    onError: () => {
      ownerNeedsRead.current = true;
      requireCaseReadback();
    },
    onSettled: () => {
      ownerSubmitting.current = false;
    },
    onSuccess: updateCaseCacheAndConfirm("已分配負責同事。"),
  });
  const statusMutation = useMutation({
    mutationKey: commandKey,
    mutationFn: actions.updateStatus,
    retry: false,
    onError: requireCaseReadback,
    onSettled: () => {
      statusSubmitting.current = false;
    },
    onSuccess: updateCaseCacheAndConfirm("已更新案件狀態。"),
  });
  const checklistMutation = useMutation({
    mutationKey: checklistMutationKey,
    mutationFn: actions.updateChecklist,
    retry: false,
    onError: requireCaseReadback,
    onSettled: (_data, _error, input) => {
      checklistSubmitting.current.delete(input.itemId);
    },
    onSuccess: updateCaseCache,
  });
  const paymentMutation = useMutation({
    mutationKey: commandKey,
    mutationFn: actions.updatePayment,
    onSuccess: updateCaseCacheAndConfirm("已更新付款。"),
  });
  const noteMutation = useMutation({
    mutationKey: commandKey,
    mutationFn: actions.addNote,
    retry: false,
    onError: () => setNoteRecovery("required"),
    onSuccess: async () => {
      const submittedDraft = noteSubmission.current;
      setNote((current) => (current === submittedDraft ? "" : current));
      setNoteRecovery("none");
      toast.success("已加入備註。");
      await queryClient.invalidateQueries({ queryKey: annualReturnQueryKeys.notes(caseId) });
      noteSubmission.current = null;
    },
  });
  const reminderMutation = useMutation({
    mutationKey: commandKey,
    mutationFn: actions.sendReminder,
    onSuccess: () => {
      toast.success("已排入 WhatsApp 提醒。");
      void queryClient.invalidateQueries({ queryKey: annualReturnQueryKeys.detail(caseId) });
      void queryClient.invalidateQueries({ queryKey: annualReturnQueryKeys.notifications(caseId) });
    },
  });
  const packetMutation = useMutation({
    mutationKey: commandKey,
    mutationFn: actions.submitPacket,
    retry: false,
    onError: requireCaseReadback,
    onSettled: () => {
      statusSubmitting.current = false;
    },
    onSuccess: updateCaseCacheAndConfirm("已準備文件套件。"),
  });
  const receiptMutation = useMutation({
    mutationKey: commandKey,
    mutationFn: actions.acceptReceipt,
    onSuccess: updateCaseCacheAndConfirm("已接納回條。"),
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

  async function reconcileCase() {
    if (
      recoveringCase.current ||
      queryClient.isMutating({ mutationKey: annualReturnQueryKeys.detail(caseId) })
    )
      return;
    recoveringCase.current = true;
    setCaseRecovery("reading");
    const queryKey = annualReturnQueryKeys.detail(caseId);
    try {
      await queryClient.cancelQueries({ queryKey, exact: true });
      const fresh = await getAnnualReturnCase({ data: { id: caseId } });
      if (
        !fresh ||
        fresh.id !== caseId ||
        !Array.isArray(fresh.checklist) ||
        !fresh.readiness ||
        typeof fresh.readiness.sourceVersion !== "string" ||
        !fresh.readiness.sourceVersion.trim() ||
        typeof fresh.readiness.readyToPrepare !== "boolean" ||
        typeof fresh.readiness.readyForApproval !== "boolean" ||
        typeof fresh.readiness.readyToTransmit !== "boolean" ||
        !Array.isArray(fresh.readiness.blockers)
      )
        throw new Error("Case readiness unavailable");
      if (ownerNeedsRead.current && !isUuid(fresh.ownerId)) throw new Error("Owner unavailable");
      await queryClient.cancelQueries({ queryKey, exact: true });
      if (!caseAlive.current) return;
      await queryClient.invalidateQueries({
        queryKey: annualReturnQueryKeys.all,
        refetchType: "none",
      });
      if (!caseAlive.current) return;
      queryClient.setQueryData(queryKey, fresh);
      void queryClient.invalidateQueries({ queryKey: annualReturnQueryKeys.history(caseId) });
      if (ownerNeedsRead.current) setOwnerId(fresh.ownerId);
      ownerNeedsRead.current = false;
      ownerMutation.reset();
      checklistMutation.reset();
      statusMutation.reset();
      packetMutation.reset();
      uncertainCase.current = false;
      setCaseRecovery("none");
    } catch {
      if (caseAlive.current) setCaseRecovery("failed");
    } finally {
      recoveringCase.current = false;
    }
  }

  if (caseRecovery !== "none")
    return (
      <main className="flex-1 space-y-3 p-6">
        <PageHeader eyebrow="案件與客戶" title="案件操作結果待核實" />
        <p role="alert">案件或清單操作結果未確認。請先重新核對案件及就緒資料，避免重複操作。</p>
        {caseRecovery === "failed" ? (
          <p role="status">尚未核實案件結果。請稍後重新核對；沒有重試寫入。</p>
        ) : null}
        <Button
          type="button"
          disabled={caseRecovery === "reading" || pendingCaseCommands.length > 0}
          onClick={() => void reconcileCase()}
        >
          重新核對案件結果
        </Button>
        <Button asChild>
          <a href={caseReturnPath(returnTo)}>返回工作列表</a>
        </Button>
      </main>
    );

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
        <Button
          type="button"
          className="min-h-11"
          disabled={caseQuery.isFetching}
          onClick={() => void caseQuery.refetch({ cancelRefetch: false })}
        >
          重新載入案件資料
        </Button>
        <Button asChild>
          <a href={caseReturnPath(returnTo)}>返回工作列表</a>
        </Button>
      </main>
    );
  }

  if (!caseItem) return <CaseNotFound returnTo={returnTo} />;

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
              <Button asChild className="min-h-11">
                <a href={caseReturnPath(returnTo)}>返回工作列表</a>
              </Button>

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
                  onClick={() => {
                    if (
                      locked ||
                      uncertainCase.current ||
                      ownerSubmitting.current ||
                      !isUuid(ownerId)
                    )
                      return;
                    ownerSubmitting.current = true;
                    ownerMutation.mutate(ownerId);
                  }}
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
                      locked ||
                      statusMutation.isPending ||
                      packetMutation.isPending ||
                      nextStatus === caseItem.currentStatus
                    }
                    onClick={() => {
                      if (uncertainCase.current || statusSubmitting.current) return;
                      statusSubmitting.current = true;
                      statusMutation.mutate(nextStatus);
                    }}
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
                      <p className="text-sm font-medium">
                        <ChecklistItemLabel label={item.itemLabel} />
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {checklistStatusLabel(item.status)}
                      </p>
                    </div>
                    <Button
                      disabled={locked || pendingChecklistItemIds.includes(item.id)}
                      onClick={() => {
                        if (uncertainCase.current || checklistSubmitting.current.has(item.id))
                          return;
                        checklistSubmitting.current.add(item.id);
                        checklistMutation.mutate({
                          itemId: item.id,
                          status: nextChecklistStatus,
                          documentId: nextChecklistStatus === "Missing" ? null : item.documentId,
                        });
                      }}
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
            <ul id="case-blockers" className="mt-2 space-y-1 text-sm" aria-label="交件阻礙事項">
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
                  {/* A blocker with nowhere better to go points back at this
                      page; a link that reloads the page you are on is noise. */}
                  {blocker.action !== `/annual-returns/${caseItem.id}` ? (
                    <Button asChild variant="link" className="ml-2 underline">
                      <a href={blocker.action}>處理</a>
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                disabled={
                  locked || packetMutation.isPending || statusMutation.isPending || !packetReady
                }
                onClick={() => {
                  if (uncertainCase.current || statusSubmitting.current) return;
                  statusSubmitting.current = true;
                  packetMutation.mutate();
                }}
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
              onChange={(event) => {
                setNote(event.target.value);
                if (noteRecovery === "checked") setNoteRecovery("none");
              }}
            />
            <Button
              className="mt-2"
              disabled={locked || noteBlocked || noteMutation.isPending || !note.trim()}
              onClick={() => {
                // Capture the raw draft and block same-turn duplicate writes.
                if (locked || noteBlocked || noteSubmission.current !== null || !note.trim())
                  return;
                noteSubmission.current = note;
                setNoteRecovery("none");
                noteMutation.mutate(note.trim());
              }}
              type="button"
            >
              <PendingIcon pending={noteMutation.isPending} />
              <MessageSquarePlus aria-hidden className="h-4 w-4" />
              加入備註
            </Button>
            {noteBlocked ? (
              <div role="alert" className="mt-2 space-y-2 text-sm text-destructive">
                <p>{noteMutation.error?.message}</p>
                <p>備註儲存結果未能核實。草稿已保留，請先核對已儲存備註；沒有自動重試寫入。</p>
                <Button
                  type="button"
                  className="min-h-11"
                  disabled={noteRecovery === "reading"}
                  onClick={async () => {
                    if (noteRecovering.current) return;
                    noteRecovering.current = true;
                    setNoteRecovery("reading");
                    const queryKey = annualReturnQueryKeys.notes(caseId);
                    try {
                      // Refetch cancellation may return reverted cached data.
                      // Independently read and publish the actual response.
                      await queryClient.cancelQueries({ queryKey, exact: true });
                      const notes = await listAnnualReturnCaseNotes({ data: { caseId } });
                      if (!Array.isArray(notes)) throw new Error("Notes unavailable");
                      await queryClient.cancelQueries({ queryKey, exact: true });
                      queryClient.setQueryData(queryKey, notes);
                      await queryClient.invalidateQueries({
                        queryKey: annualReturnQueryKeys.history(caseId),
                      });
                      noteMutation.reset();
                      noteSubmission.current = null;
                      setNoteRecovery("checked");
                    } catch {
                      setNoteRecovery("required");
                    } finally {
                      noteRecovering.current = false;
                    }
                  }}
                >
                  重新核對備註結果
                </Button>
              </div>
            ) : null}
            {noteRecovery === "checked" && notesQuery.isSuccess && !notesQuery.isFetching ? (
              <p role="status" className="mt-2 text-sm">
                已重新載入備註。草稿仍保留，請先核對清單，避免重複新增。
              </p>
            ) : null}
            <div className="mt-4 space-y-3">
              {noteBlocked ? null : notesQuery.isPending ? (
                <LoadingRows label="正在載入備註…" rows={2} className="p-0" />
              ) : notesQuery.isError ? (
                <div role="alert" className="space-y-2 text-sm text-destructive">
                  <p>{notesQuery.error.message}</p>
                  <Button
                    type="button"
                    className="min-h-11"
                    disabled={notesQuery.isFetching}
                    onClick={() => void notesQuery.refetch({ cancelRefetch: false })}
                  >
                    重新載入備註
                  </Button>
                </div>
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
              <div role="alert" className="mt-3 space-y-2 text-sm text-destructive">
                <p>{historyQuery.error.message}</p>
                <Button
                  type="button"
                  className="min-h-11"
                  disabled={historyQuery.isFetching}
                  onClick={() => void historyQuery.refetch({ cancelRefetch: false })}
                >
                  重新載入審計記錄
                </Button>
              </div>
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
