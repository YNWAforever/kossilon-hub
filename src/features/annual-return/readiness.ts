import type { ManifestBlocker, ManifestResult } from "./package-manifest";
import type { ReturnDecisionInput, ReturnOutcome } from "./return-service";
import type { AnnualReturnStatus, CompletionBlocker } from "./types";

export type EvidenceReadState = "confirmed" | "outstanding" | "unknown";

export type CaseReadinessSnapshot = {
  caseId: string;
  revision: number;
  asOf: string;
  currentStatus: AnnualReturnStatus;
  caseLocked: boolean;
  requiredEvidenceState: EvidenceReadState;
  paymentEvidenceState: EvidenceReadState;
  /** Built from the current requirement, version, finding and human-decision rows. */
  manifestResult: ManifestResult;
  /** Server-computed hash of canonicalManifestPayload for the current manifest. */
  currentManifestHash: string | null;
  approval: { manifestHash: string; approverId: string } | null;
  submission: { id: string; reference: string; verifiedAt: string } | null;
  /** Existing live handoff, including one prepared but not yet submitted. */
  activeHandoffId?: string | null;
  returnReconciliation: {
    id: string;
    status: "matched" | "exception";
    outcome: ReturnOutcome;
    decision: ReturnDecisionInput["decision"] | null;
    verifiedAt: string | null;
  } | null;
  completionBlockers: readonly CompletionBlocker[];
};

export type ReadinessBlockerCode =
  | "missing-evidence"
  | "unsafe-file"
  | "stale-version"
  | "review-required"
  | "payment-unconfirmed"
  | "unknown-data"
  | "manifest-changed"
  | "submission-missing"
  | "return-unresolved"
  | "case-locked";

export type ReadinessBlocker = {
  code: ReadinessBlockerCode;
  targetId: string;
  messageKey: string;
};

export type ReadinessResult = {
  documentsComplete: boolean;
  paymentConfirmed: boolean;
  canApprovePackage: boolean;
  canRecordSubmission: boolean;
  canComplete: boolean;
  blockers: ReadinessBlocker[];
  snapshotRevision: number;
};

function manifestBlockerToReadiness(blocker: ManifestBlocker, caseId: string): ReadinessBlocker {
  switch (blocker.kind) {
    case "requirement-outstanding":
      return {
        code: "missing-evidence",
        targetId: caseId,
        messageKey: "readiness.missingEvidence",
      };
    case "evidence-unverifiable":
      return {
        code: "unsafe-file",
        targetId: blocker.documentVersionId,
        messageKey: "readiness.unsafeFile",
      };
    case "evidence-superseded":
      return {
        code: "stale-version",
        targetId: blocker.documentVersionId,
        messageKey: "readiness.staleVersion",
      };
    case "missing-human-decision":
    case "decision-not-approval":
      return { code: "review-required", targetId: caseId, messageKey: "readiness.reviewRequired" };
    case "unresolved-critical-finding":
      return {
        code: "unsafe-file",
        targetId: blocker.findingId,
        messageKey: "readiness.unsafeFile",
      };
  }
}

export function evaluateCaseReadiness(snapshot: CaseReadinessSnapshot): ReadinessResult {
  const blockers: ReadinessBlocker[] = [];
  const add = (code: ReadinessBlockerCode, targetId = snapshot.caseId) =>
    blockers.push({ code, targetId, messageKey: "readiness." + code });

  if (snapshot.requiredEvidenceState === "unknown") add("unknown-data");
  else if (snapshot.requiredEvidenceState === "outstanding") add("missing-evidence");

  if (snapshot.paymentEvidenceState === "unknown") add("unknown-data");
  else if (snapshot.paymentEvidenceState === "outstanding") add("payment-unconfirmed");

  if (snapshot.manifestResult.kind === "blocked") {
    blockers.push(
      ...snapshot.manifestResult.blockers.map((blocker) =>
        manifestBlockerToReadiness(blocker, snapshot.caseId),
      ),
    );
  } else if (!snapshot.currentManifestHash) {
    add("unknown-data");
  }

  if (snapshot.caseLocked || snapshot.currentStatus === "Completed") add("case-locked");
  if (snapshot.activeHandoffId) add("case-locked", snapshot.activeHandoffId);

  const documentsComplete = snapshot.requiredEvidenceState === "confirmed";
  const paymentConfirmed = snapshot.paymentEvidenceState === "confirmed";
  const manifestReady =
    snapshot.manifestResult.kind === "releasable" && Boolean(snapshot.currentManifestHash);
  const mutable = !snapshot.caseLocked && snapshot.currentStatus !== "Completed";
  const packageMutable = mutable && snapshot.currentStatus !== "Filed";
  const canApprovePackage =
    documentsComplete && paymentConfirmed && manifestReady && packageMutable;

  if (!snapshot.approval) add("review-required");
  else if (
    !snapshot.currentManifestHash ||
    snapshot.approval.manifestHash !== snapshot.currentManifestHash
  ) {
    add("manifest-changed");
  }

  const approvalCurrent =
    snapshot.approval !== null &&
    snapshot.currentManifestHash !== null &&
    snapshot.approval.manifestHash === snapshot.currentManifestHash;
  const canRecordSubmission =
    canApprovePackage &&
    approvalCurrent &&
    snapshot.currentStatus !== "Filed" &&
    snapshot.submission === null &&
    !snapshot.activeHandoffId;

  if (
    !snapshot.submission?.id ||
    !snapshot.submission.reference ||
    !snapshot.submission.verifiedAt
  ) {
    add("submission-missing");
  }
  const returnAccepted =
    Boolean(snapshot.returnReconciliation?.id) &&
    snapshot.returnReconciliation?.status === "matched" &&
    snapshot.returnReconciliation.outcome === "accepted" &&
    snapshot.returnReconciliation.decision === "confirm" &&
    Boolean(snapshot.returnReconciliation.verifiedAt);
  if (!returnAccepted) add("return-unresolved");

  for (const blocker of snapshot.completionBlockers) {
    switch (blocker.code) {
      case "required_checklist_unverified":
        add("missing-evidence");
        break;
      case "payment_not_received":
      case "payment_proof_missing":
        add("payment-unconfirmed");
        break;
      case "filing_reference_missing":
      case "confirmation_document_missing":
        add("submission-missing");
        break;
    }
  }

  const canComplete =
    documentsComplete &&
    paymentConfirmed &&
    manifestReady &&
    mutable &&
    approvalCurrent &&
    Boolean(
      snapshot.submission?.id && snapshot.submission.reference && snapshot.submission.verifiedAt,
    ) &&
    returnAccepted &&
    snapshot.completionBlockers.length === 0;

  return {
    documentsComplete,
    paymentConfirmed,
    canApprovePackage,
    canRecordSubmission,
    canComplete,
    blockers,
    snapshotRevision: snapshot.revision,
  };
}
