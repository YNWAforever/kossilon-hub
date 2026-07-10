import { useEffect, useMemo, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, ReceiptText } from "lucide-react";

import {
  type AnnualReturnCase,
  getPacketStatus,
  useAnnualReturnCases,
} from "../lib/annual-return-store";
import {
  acknowledgePaymentInstructions,
  approveClientPacket,
  getClientPortalActivity,
  getClientPortalProgress,
  getClientPortalRequiredActions,
  getDocumentArchiveRows,
  getPaymentProofsForCase,
  recordReceiptViewed,
  replaceClientDocument,
  uploadClientDocument,
  uploadPaymentProof,
  useClientPortalSnapshot,
  type ClientPortalArchiveRow,
  type ClientPortalPaymentProof,
  type ClientPortalRequiredAction,
} from "../lib/client-portal-store";

type PortalSearch = {
  caseId?: string;
};

export const Route = createFileRoute("/portal")({
  validateSearch: (search): PortalSearch => ({
    caseId: typeof search.caseId === "string" ? search.caseId : undefined,
  }),
  component: PortalRoute,
});

function PortalRoute() {
  const cases = useAnnualReturnCases();
  const snapshot = useClientPortalSnapshot();
  const { caseId } = Route.useSearch();
  const navigate = useNavigate({ from: "/portal" });
  const [warning, setWarning] = useState<string | undefined>();

  const matchedCase = caseId ? cases.find((caseItem) => caseItem.id === caseId) : undefined;
  const selectedCase = caseId ? matchedCase : cases[0];

  useEffect(() => {
    if (!selectedCase || caseId || caseId === selectedCase.id) return;

    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, caseId: selectedCase.id }),
    });
  }, [caseId, navigate, selectedCase]);

  if (!selectedCase) {
    return (
      <div className="space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Portal case not found</h1>
        <Link className="inline-flex rounded-md border px-3 py-2 text-sm" to="/annual-returns">
          Back to staff app
        </Link>
      </div>
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
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Client portal demo</p>
          <h1 className="mt-1 text-3xl font-semibold">{selectedCase.companyName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Annual return due {selectedCase.dueDate} / Packet {packetStatus}
          </p>
        </div>
        <select
          aria-label="Select portal case"
          className="rounded-md border bg-background px-3 py-2 text-sm"
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
        </select>
      </div>

      {warning ? (
        <div className="rounded-md bg-status-yellow-soft px-3 py-2 text-sm text-status-yellow">
          {warning}
        </div>
      ) : null}

      <section className="rounded-lg border bg-card p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_220px] md:items-center">
          <div>
            <h2 className="text-lg font-semibold">Next client action</h2>
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
              {progress.completed}/{progress.total} complete
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Required actions</h2>
              <p className="text-sm text-muted-foreground">
                Mock client actions update the staff archive and case timeline.
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
              <p className="text-sm text-muted-foreground">No client action is needed.</p>
            ) : null}
          </div>
        </section>

        <section className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Portal activity</h2>
              <p className="text-sm text-muted-foreground">Newest client actions appear first.</p>
            </div>
            <ReceiptText className="h-5 w-5 text-primary" />
          </div>
          <div className="mt-4 space-y-3">
            {activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">No portal activity yet.</p>
            ) : (
              activity.map((item) => (
                <div key={item.id} className="rounded-md border px-3 py-3 text-sm">
                  <p className="font-medium">{item.summary}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatTimestamp(item.createdAt)}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <PaymentProofHistory proofs={paymentProofs} />

      <ArchivePreview rows={archiveRows} selectedCase={selectedCase} />
    </div>
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
        ? "Replace"
        : "Upload"
      : undefined;
  const showPrimaryAction =
    action.kind === "document"
      ? action.status === "open" && Boolean(action.documentAction)
      : action.kind === "payment-proof"
        ? action.status === "open" && Boolean(action.paymentProofAction)
        : true;

  function handlePrimaryAction() {
    onWarning(undefined);

    if (action.kind === "document" && action.requirementId) {
      const result =
        action.documentAction === "replace"
          ? replaceClientDocument(
              caseItem,
              action.requirementId,
              `${caseItem.id}-${action.requirementId}-replacement.pdf`,
            )
          : uploadClientDocument(
              caseItem,
              action.requirementId,
              `${caseItem.id}-${action.requirementId}.pdf`,
            );
      onWarning(result.ok ? undefined : result.reason);
      return;
    }

    if (action.kind === "payment-proof" && action.paymentProofAction) {
      const result = uploadPaymentProof(
        caseItem,
        action.paymentProofAction === "replace"
          ? `${caseItem.id}-payment-proof-replacement.png`
          : `${caseItem.id}-payment-proof.png`,
      );
      onWarning(result.ok ? undefined : result.reason);
      return;
    }

    if (action.kind === "payment") {
      const result = acknowledgePaymentInstructions(caseItem);
      onWarning(result.ok ? undefined : result.reason);
      return;
    }

    if (action.kind === "packet") {
      const result = approveClientPacket(caseItem);
      onWarning(result.ok ? undefined : result.reason);
      return;
    }

    if (action.kind === "receipt") {
      const result = recordReceiptViewed(caseItem);
      onWarning(result.ok ? undefined : result.reason);
    }
  }

  return (
    <div className="rounded-md border px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{action.label}</p>
          <p className="mt-1 text-sm text-muted-foreground">{action.detail}</p>
        </div>
        <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">{action.status}</span>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {showPrimaryAction ? (
          <button
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
            disabled={primaryDisabled}
            onClick={handlePrimaryAction}
            type="button"
            aria-label={
              action.kind === "payment-proof"
                ? `${primaryActionLabel(action)} for ${caseItem.companyName}`
                : documentPrimaryLabel
                  ? `${documentPrimaryLabel} ${action.label}`
                  : undefined
            }
          >
            {primaryActionLabel(action)}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function PaymentProofHistory({ proofs }: { proofs: ClientPortalPaymentProof[] }) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <div>
        <h2 className="text-lg font-semibold">Payment proof history</h2>
        <p className="text-sm text-muted-foreground">Uploaded proof and staff review outcomes.</p>
      </div>
      <div className="mt-4 divide-y">
        {proofs.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">No payment proof uploaded yet.</p>
        ) : (
          proofs.map((proof) => (
            <div
              key={proof.id}
              className="grid gap-2 py-3 text-sm md:grid-cols-[minmax(0,1fr)_140px_120px]"
            >
              <div className="min-w-0">
                <p className="font-medium">{proof.filename}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Uploaded by {proof.uploadedBy} on {formatTimestamp(proof.uploadedAt)}
                </p>
                {proof.reviewedBy && proof.reviewedAt ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Reviewed by {proof.reviewedBy} on {formatTimestamp(proof.reviewedAt)}
                  </p>
                ) : null}
                {proof.reviewReasonLabel ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Reason: {proof.reviewReasonLabel}
                    {proof.reviewNote ? ` - ${proof.reviewNote}` : ""}
                  </p>
                ) : null}
              </div>
              <span>{proof.origin}</span>
              <span>{proof.status}</span>
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
          <h2 className="text-lg font-semibold">Shared archive</h2>
          <p className="text-sm text-muted-foreground">
            Portal uploads and generated filing records appear here and in Documents.
          </p>
        </div>
        <Link
          className="rounded-md border px-3 py-2 text-sm"
          to="/documents"
          search={{ caseId: selectedCase.id }}
        >
          Open documents
        </Link>
      </div>
      <div className="mt-4 divide-y">
        {previewRows.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">No archive rows yet.</p>
        ) : (
          previewRows.map((row) => (
            <div key={row.id} className="grid gap-2 py-3 text-sm md:grid-cols-[1fr_140px_120px]">
              <span className="font-medium">
                {row.title}
                {row.reviewSummary ? (
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    {row.reviewSummary}
                    {row.reviewReasonLabel ? ` - ${row.reviewReasonLabel}` : ""}
                    {row.reviewNote ? ` - ${row.reviewNote}` : ""}
                  </span>
                ) : null}
              </span>
              <span>{row.source}</span>
              <span>{row.status}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
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

function primaryActionLabel(action: ClientPortalRequiredAction): string {
  if (action.kind === "document") return action.documentAction === "replace" ? "Replace" : "Upload";
  if (action.kind === "payment-proof") {
    return action.paymentProofAction === "replace"
      ? "Replace payment proof"
      : "Upload payment proof";
  }
  if (action.kind === "payment") return "Acknowledge payment";
  if (action.kind === "packet") return "Approve packet";
  return "View receipt";
}
