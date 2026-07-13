import { useEffect, useState } from "react";
import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
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
import { createProductionCaseActions } from "./production-case-actions";
import { getAnnualReturnCase, listAnnualReturnCaseNotes } from "../server-fns";
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

function caseIsPacketReady(caseItem: AnnualReturnCase): boolean {
  return (
    caseItem.checklist
      .filter((item) => item.required)
      .every((item) => item.status === "Verified") &&
    caseItem.payment?.status === "Payment received"
  );
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
    return (
      <div className="flex min-h-64 items-center justify-center p-6 text-sm text-muted-foreground">
        <Loader2 aria-hidden className="mr-2 h-4 w-4 animate-spin" />
        Loading annual return case
      </div>
    );
  }

  if (caseQuery.isError) {
    return (
      <div className="space-y-3 p-6">
        <h1 className="text-xl font-semibold">Annual return case unavailable</h1>
        <p role="alert" className="text-sm text-destructive">
          {caseQuery.error.message}
        </p>
        <Link className="inline-flex rounded-md border px-3 py-2 text-sm" to="/annual-returns">
          Back to annual returns
        </Link>
      </div>
    );
  }

  if (!caseItem) {
    return (
      <div className="space-y-3 p-6">
        <h1 className="text-xl font-semibold">Case not found</h1>
        <Link className="inline-flex rounded-md border px-3 py-2 text-sm" to="/annual-returns">
          Back to annual returns
        </Link>
      </div>
    );
  }

  const packetReady = caseIsPacketReady(caseItem);
  const locked = caseItem.currentStatus === "Completed";

  return (
    <div className="space-y-4 p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
        <div>
          <Link
            className="text-sm text-muted-foreground hover:text-foreground"
            to="/annual-returns"
          >
            Annual returns
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{caseItem.companyName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Return year {caseItem.returnYear} / Due {caseItem.filingDueDate}
          </p>
        </div>
        <div className="text-right text-sm">
          <p className="font-medium">{caseItem.currentStatus}</p>
          <p className="text-muted-foreground">{caseItem.riskLevel} risk</p>
        </div>
      </header>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <main className="space-y-4">
          <section className="border-b pb-4">
            <h2 className="text-base font-semibold">Case controls</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div>
                <label className="text-sm font-medium" htmlFor="owner-id">
                  Owner ID
                </label>
                <div className="mt-1 flex gap-2">
                  <input
                    id="owner-id"
                    className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
                    value={ownerId}
                    onChange={(event) => setOwnerId(event.target.value)}
                  />
                  <button
                    className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                    disabled={locked || ownerMutation.isPending || !isUuid(ownerId)}
                    onClick={() => ownerMutation.mutate(ownerId)}
                    type="button"
                  >
                    <PendingIcon pending={ownerMutation.isPending} />
                    <UserRoundCheck aria-hidden className="h-4 w-4" />
                    Assign
                  </button>
                </div>
                <MutationMessage error={ownerMutation.error} />
              </div>

              <div>
                <label className="text-sm font-medium" htmlFor="case-status">
                  Case status
                </label>
                <div className="mt-1 flex gap-2">
                  <select
                    id="case-status"
                    className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm"
                    value={nextStatus}
                    onChange={(event) => setNextStatus(event.target.value as AnnualReturnStatus)}
                  >
                    {ANNUAL_RETURN_STATUSES.map((status) => (
                      <option key={status}>{status}</option>
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
                    Update
                  </button>
                </div>
                <MutationMessage error={statusMutation.error} />
              </div>
            </div>
          </section>

          <section className="border-b pb-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Required checklist</h2>
              <span className="text-sm text-muted-foreground">
                {caseItem.checklist.filter((item) => item.status === "Verified").length}/
                {caseItem.checklist.length} verified
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
                      <p className="text-xs text-muted-foreground">{item.status}</p>
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
                        ? "Verify evidence"
                        : nextChecklistStatus === "Missing"
                          ? "Mark missing"
                          : "Mark received"}
                    </button>
                  </div>
                );
              })}
            </div>
            <MutationMessage error={checklistMutation.error} />
          </section>

          <section className="border-b pb-4">
            <h2 className="text-base font-semibold">Payment</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-[12rem_minmax(0,1fr)_auto]">
              <select
                aria-label="Payment status"
                className="rounded-md border bg-background px-3 py-2 text-sm"
                value={paymentStatus}
                onChange={(event) => setPaymentStatus(event.target.value as PaymentStatus)}
              >
                {paymentStatuses.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
              <input
                aria-label="Payment proof document ID"
                className="min-w-0 rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="Payment proof document UUID"
                value={paymentProofDocumentId}
                onChange={(event) => setPaymentProofDocumentId(event.target.value)}
              />
              <button
                className="inline-flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm disabled:opacity-50"
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
                Update payment
              </button>
            </div>
            <MutationMessage error={paymentMutation.error} />
          </section>

          <section className="border-b pb-4">
            <h2 className="text-base font-semibold">Filing packet</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Required items must be verified and payment received before packet submission.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                disabled={locked || packetMutation.isPending || !packetReady}
                onClick={() => packetMutation.mutate()}
                type="button"
              >
                <PendingIcon pending={packetMutation.isPending} />
                <FileCheck2 aria-hidden className="h-4 w-4" />
                Submit packet
              </button>
            </div>
            <MutationMessage error={packetMutation.error} />
          </section>

          <section className="pb-2">
            <h2 className="text-base font-semibold">Accept filing receipt</h2>
            <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
              <input
                aria-label="Filing reference"
                className="min-w-0 rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="Filing reference"
                value={filingReference}
                onChange={(event) => setFilingReference(event.target.value)}
              />
              <input
                aria-label="Verified receipt document ID"
                className="min-w-0 rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="Verified receipt document UUID"
                value={confirmationDocumentId}
                onChange={(event) => setConfirmationDocumentId(event.target.value)}
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
                Accept receipt
              </button>
            </div>
            <MutationMessage error={receiptMutation.error} />
          </section>
        </main>

        <aside className="space-y-4 border-t pt-4 xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0">
          <section className="border-b pb-4">
            <h2 className="text-base font-semibold">Notes</h2>
            <textarea
              aria-label="Case note"
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
              Add note
            </button>
            <MutationMessage error={noteMutation.error} />
            <div className="mt-4 space-y-3">
              {notesQuery.isPending ? (
                <p className="text-sm text-muted-foreground">Loading notes</p>
              ) : notesQuery.isError ? (
                <p role="alert" className="text-sm text-destructive">
                  {notesQuery.error.message}
                </p>
              ) : notesQuery.data.length === 0 ? (
                <p className="text-sm text-muted-foreground">No notes yet.</p>
              ) : (
                notesQuery.data.map((entry) => (
                  <div key={entry.id} className="border-l-2 pl-3">
                    <p className="text-sm">{entry.body}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {new Date(entry.createdAt).toLocaleString("en-HK")}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>

          <section>
            <h2 className="text-base font-semibold">WhatsApp reminder</h2>
            <div className="mt-3 space-y-2">
              <input
                aria-label="Reminder recipient name"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="Recipient name"
                value={recipientName}
                onChange={(event) => setRecipientName(event.target.value)}
              />
              <input
                aria-label="Reminder phone"
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
                Send reminder
              </button>
            </div>
            <MutationMessage error={reminderMutation.error} />
          </section>
        </aside>
      </div>
    </div>
  );
}
