import { ProductionPaymentReview } from "@/features/annual-return/components/production-payment-review";
import { type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/page-header";
import { formatDate } from "@/lib/format-date";

import {
  type AnnualReturnCase,
  type AnnualReturnPaymentStatus,
  getPacketStatus,
  getReadinessScore,
  useAnnualReturnCases,
} from "../lib/annual-return-store";
import {
  getCurrentPaymentProof,
  getPaymentProofsForCase,
  useClientPortalSnapshot,
  type ClientPortalPaymentProof,
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
  const { dataMode } = Route.useRouteContext();
  return dataMode === "demo" ? <DemoPaymentsRoute /> : <ProductionPaymentsRoute />;
}

// Exported for -payments.interaction.test.tsx. The dataMode branch lives in the
// parent PaymentsRoute, so this component never touches Route itself.
export function ProductionPaymentsRoute() {
  const actor = Route.useRouteContext().actor;
  return (
    <ProductionPaymentReview
      canBulk={actor?.active === true && (actor.role === "Admin" || actor.role === "Manager")}
      actorScope={JSON.stringify(
        actor ? [actor.authUserId, actor.userId, actor.role, actor.teamId, actor.active] : null,
      )}
    />
  );
}

function DemoPaymentsRoute() {
  const cases = useAnnualReturnCases();
  const snapshot = useClientPortalSnapshot();

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader eyebrow="Operations" title="Payments" />
      <p
        className="rounded-md bg-status-yellow-soft px-3 py-2 text-sm text-status-yellow-text"
        role="status"
      >
        Read-only demo. Payment proof is attached and reviewed in production.
      </p>

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
    </main>
  );
}

type PaymentReviewRowProps = {
  caseItem: AnnualReturnCase;
  proof?: ClientPortalPaymentProof;
  history: ClientPortalPaymentProof[];
};

function PaymentReviewRow({ caseItem, proof, history }: PaymentReviewRowProps) {
  const isClosed = caseItem.status === "filed" || getPacketStatus(caseItem) === "accepted";
  const previousProofs = history.filter((candidate) => candidate.id !== proof?.id);

  return (
    <div className="grid gap-3 px-4 py-4 text-sm lg:grid-cols-[minmax(0,1.4fr)_120px_120px_minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(200px,1fr)] lg:items-start">
      <div className="min-w-0">
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:hidden">
          Company
        </p>
        <p className="truncate font-medium">{caseItem.companyName}</p>
        <p className="truncate text-muted-foreground">{caseItem.contactName}</p>
      </div>
      <Field
        label="Owner / due"
        value={
          <>
            <p>{caseItem.owner}</p>
            <p className="text-xs text-muted-foreground">Due {formatDate(caseItem.dueDate)}</p>
          </>
        }
      />
      <Field
        label="Payment"
        value={
          <>
            <p
              className={
                caseItem.paymentStatus === "overdue"
                  ? "font-medium text-red-700"
                  : caseItem.paymentStatus === "paid"
                    ? "text-green-700"
                    : undefined
              }
            >
              {paymentLabels[caseItem.paymentStatus]}
            </p>
            <p className="text-xs text-muted-foreground">
              Case {getReadinessScore(caseItem)}% ready
            </p>
          </>
        }
      />
      <ProofCell proof={proof} previousProofs={previousProofs} />
      <ReviewOutcome proof={proof} closed={isClosed} />

      <div className="min-w-0">
        <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:hidden">
          Actions
        </p>
        {isClosed && (!proof || proof.status === "rejected") ? (
          // A closed case takes no new proof. A greyed-out button with no reason
          // read as broken; say why there is nothing to do.
          <p className="text-sm text-muted-foreground">
            {caseItem.status === "filed" ? "Return filed" : "Packet accepted"} — no proof needed.
          </p>
        ) : (
          // The demo is read-only (docs/adr/0001-demo-mode-is-read-only.md): the
          // action is shown so the workflow reads true, but it is disabled and the
          // page says why once, rather than each click answering with a warning.
          <div className="flex flex-wrap gap-2">
            {!proof ? (
              <DemoAction label={`Attach payment proof for ${caseItem.companyName}`}>
                Attach proof
              </DemoAction>
            ) : proof.status === "rejected" ? (
              <DemoAction label={`Attach replacement payment proof for ${caseItem.companyName}`}>
                Attach replacement
              </DemoAction>
            ) : proof.status === "pending-review" ? (
              <>
                <DemoAction label={`Accept payment proof for ${caseItem.companyName}`}>
                  Accept
                </DemoAction>
                <DemoAction label={`Reject payment proof for ${caseItem.companyName}`}>
                  Reject
                </DemoAction>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No further payment proof action.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function DemoAction({ label, children }: { label: string; children: ReactNode }) {
  return (
    <button
      aria-label={label}
      className="rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
      disabled
      type="button"
    >
      {children}
    </button>
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

function ReviewOutcome({ proof, closed }: { proof?: ClientPortalPaymentProof; closed: boolean }) {
  const label = proof
    ? paymentProofStatusLabel(proof.status)
    : closed
      ? "Not required"
      : "Awaiting proof";

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
