import { type ReactNode, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";

import {
  type AnnualReturnCase,
  type AnnualReturnPaymentStatus,
  getPacketStatus,
  getReadinessScore,
  useAnnualReturnCases,
} from "../lib/annual-return-store";
import {
  acceptPaymentProof,
  attachPaymentProof,
  clientPortalPaymentProofReviewReasons,
  getCurrentPaymentProof,
  getPaymentProofsForCase,
  rejectPaymentProof,
  useClientPortalSnapshot,
  type ClientPortalPaymentProof,
  type ClientPortalPaymentProofReviewReasonCode,
} from "../lib/client-portal-store";

export const Route = createFileRoute("/payments")({
  component: PaymentsRoute,
});

const paymentLabels: Record<AnnualReturnPaymentStatus, string> = {
  pending: "Pending",
  paid: "Paid",
  overdue: "Overdue",
};

function PaymentsRoute() {
  const cases = useAnnualReturnCases();
  const snapshot = useClientPortalSnapshot();

  return (
    <div className="space-y-6 p-6">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Finance</p>
        <h1 className="mt-1 text-3xl font-semibold">Payments</h1>
      </div>

      <section className="rounded-lg border bg-card">
        <div className="hidden grid-cols-[minmax(0,1.4fr)_120px_120px_minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(200px,1fr)] gap-3 border-b px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:grid">
          <span>Company</span>
          <span>Owner / due</span>
          <span>Payment</span>
          <span>Current proof</span>
          <span>Review outcome</span>
          <span>Actions</span>
        </div>

        <div className="divide-y">
          {cases.map((caseItem) => (
            <PaymentReviewRow
              key={caseItem.id}
              caseItem={caseItem}
              proof={getCurrentPaymentProof(caseItem.id, snapshot)}
              history={getPaymentProofsForCase(caseItem.id, snapshot)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

type PaymentReviewRowProps = {
  caseItem: AnnualReturnCase;
  proof?: ClientPortalPaymentProof;
  history: ClientPortalPaymentProof[];
};

function PaymentReviewRow({ caseItem, proof, history }: PaymentReviewRowProps) {
  const [reasonCode, setReasonCode] =
    useState<ClientPortalPaymentProofReviewReasonCode>("unreadable");
  const [note, setNote] = useState("");
  const [warning, setWarning] = useState<string | undefined>();
  const [isRejecting, setIsRejecting] = useState(false);
  const isReadOnly = caseItem.status === "filed" || getPacketStatus(caseItem) === "accepted";
  const previousProofs = history.filter((candidate) => candidate.id !== proof?.id);

  function handleAttach(filename: string) {
    const result = attachPaymentProof(caseItem, filename, "Operations");
    setWarning(result.ok ? undefined : result.reason);
  }

  function handleAccept() {
    if (!proof) return;
    const result = acceptPaymentProof(proof.id, "Operations");
    setWarning(result.ok ? undefined : result.reason);
  }

  function handleReject() {
    if (!proof) return;
    const result = rejectPaymentProof(proof.id, {
      reasonCode,
      note,
      actor: "Operations",
    });
    setWarning(result.ok ? undefined : result.reason);
    if (result.ok) setIsRejecting(false);
  }

  return (
    <div className="grid gap-3 px-4 py-4 text-sm lg:grid-cols-[minmax(0,1.4fr)_120px_120px_minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(200px,1fr)] lg:items-start">
      <div className="min-w-0">
        <p className="truncate font-medium">{caseItem.companyName}</p>
        <p className="truncate text-muted-foreground">{caseItem.contactName}</p>
      </div>
      <Field label="Owner / due" value={`${caseItem.owner} | ${caseItem.dueDate}`} />
      <Field
        label="Payment"
        value={`${paymentLabels[caseItem.paymentStatus]} | ${getReadinessScore(caseItem)}% ready`}
      />
      <ProofCell proof={proof} previousProofs={previousProofs} />
      <ReviewOutcome proof={proof} />

      <div className="min-w-0">
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:hidden">
          Actions
        </p>
        {!proof ? (
          <button
            className="rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isReadOnly}
            onClick={() => handleAttach(`${caseItem.id}-payment-proof.png`)}
            type="button"
          >
            Attach proof
          </button>
        ) : proof.status === "rejected" ? (
          <button
            className="rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isReadOnly}
            onClick={() => handleAttach(`${caseItem.id}-payment-proof-replacement.png`)}
            type="button"
          >
            Attach replacement
          </button>
        ) : proof.status === "pending-review" ? (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <button
                aria-label={`Accept payment proof for ${caseItem.companyName}`}
                className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isReadOnly}
                onClick={handleAccept}
                type="button"
              >
                Accept
              </button>
              <button
                aria-label={`Reject payment proof for ${caseItem.companyName}`}
                className="rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isReadOnly}
                onClick={() => setIsRejecting((current) => !current)}
                type="button"
              >
                Reject
              </button>
            </div>
            {isRejecting ? (
              <div className="space-y-2">
                <div className="space-y-1">
                  <label
                    className="text-xs font-medium text-muted-foreground"
                    htmlFor={`payment-proof-reason-${proof.id}`}
                  >
                    Rejection reason
                  </label>
                  <select
                    aria-label="Payment proof rejection reason"
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    disabled={isReadOnly}
                    id={`payment-proof-reason-${proof.id}`}
                    onChange={(event) =>
                      setReasonCode(event.target.value as ClientPortalPaymentProofReviewReasonCode)
                    }
                    value={reasonCode}
                  >
                    {clientPortalPaymentProofReviewReasons.map((reason) => (
                      <option key={reason.code} value={reason.code}>
                        {reason.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1">
                  <label
                    className="text-xs font-medium text-muted-foreground"
                    htmlFor={`payment-proof-note-${proof.id}`}
                  >
                    Client-visible note
                  </label>
                  <input
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    disabled={isReadOnly}
                    id={`payment-proof-note-${proof.id}`}
                    onChange={(event) => setNote(event.target.value)}
                    value={note}
                  />
                </div>
                <button
                  className="rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isReadOnly}
                  onClick={handleReject}
                  type="button"
                >
                  Confirm rejection
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No further payment proof action.</p>
        )}
        {warning ? (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {warning}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ProofCell({
  proof,
  previousProofs,
}: {
  proof?: ClientPortalPaymentProof;
  previousProofs: ClientPortalPaymentProof[];
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:hidden">
        Current proof
      </p>
      {proof ? (
        <>
          <p className="truncate font-medium">{proof.filename}</p>
          <p className="text-muted-foreground">{`Attached by ${proof.uploadedBy}`}</p>
        </>
      ) : (
        <p className="text-muted-foreground">No proof attached</p>
      )}
      {previousProofs.length > 0 ? (
        <p className="mt-1 truncate text-xs text-muted-foreground">
          {`History: ${previousProofs.map((candidate) => candidate.filename).join(", ")}`}
        </p>
      ) : null}
    </div>
  );
}

function ReviewOutcome({ proof }: { proof?: ClientPortalPaymentProof }) {
  const label = proof ? paymentProofStatusLabel(proof.status) : "Awaiting proof";

  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:hidden">
        Review outcome
      </p>
      <p className="font-medium">{proof?.reviewSummary ?? label}</p>
      {proof?.reviewReasonLabel ? (
        <p className="text-muted-foreground">{proof.reviewReasonLabel}</p>
      ) : null}
      {proof?.reviewNote ? <p className="text-muted-foreground">{proof.reviewNote}</p> : null}
      {proof?.reviewedAt ? (
        <p className="text-xs text-muted-foreground">{`Reviewed ${formatTimestamp(proof.reviewedAt)}`}</p>
      ) : null}
    </div>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:hidden">
        {label}
      </p>
      <div className="text-sm leading-5">{value}</div>
    </div>
  );
}

function paymentProofStatusLabel(status: ClientPortalPaymentProof["status"]): string {
  return {
    "pending-review": "Pending review",
    accepted: "Accepted",
    rejected: "Rejected",
    superseded: "Superseded",
  }[status];
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString("en-HK", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
