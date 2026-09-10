import type { DocumentSafety } from "@/features/documents/safety";

/**
 * Whether a requirement is answered, and by whom it is owed.
 *
 * The checklist could not express this. One row per requirement per case with a
 * single `document_id` has no way to say that two directors need two identity
 * documents and only one arrived: the row holds a document, so it looks answered.
 * Five files containing duplicates and no CDD look, to that model, like plenty.
 *
 * A requirement instance carries the party it applies to, so "incomplete" can
 * name the person it is incomplete for.
 */

export type RequirementApplicability = "required" | "not_applicable" | "waived";

export type RequirementEvidenceState = {
  documentId: string;
  /** The business decision. */
  reviewStatus: "pending" | "verified" | "rejected";
  /** The scan dimension, which is separate and equally necessary. */
  safety: DocumentSafety;
  pageFrom?: number | null;
  pageTo?: number | null;
};

export type RequirementInstanceState = {
  id: string;
  checklistItemId: string;
  /** Null for a requirement owed by the company rather than a person. */
  partyId: string | null;
  partyName: string | null;
  requirementKey: string;
  applicability: RequirementApplicability;
  applicabilityReason?: string | null;
  evidence: readonly RequirementEvidenceState[];
};

export type RequirementStatus =
  /** A real scanner passed it and a reviewer approved it. */
  | "satisfied"
  /** Somebody decided it does not apply, or waived it, with a reason. */
  | "resolved_without_evidence"
  /** Evidence is here and unreviewed. Our work, not the client's. */
  | "awaiting_review"
  /** Evidence is here but not yet safe to act on. Nobody's move but the queue's. */
  | "awaiting_scan"
  /** Nothing usable has arrived. The client's move. */
  | "outstanding";

/**
 * One evidence link satisfies a requirement only when both dimensions agree.
 *
 * A rejected document is not evidence, and a document whose only clean verdict
 * came from the deterministic fixture scanner is not evidence either -- however
 * long ago a reviewer approved it. Requiring both is what stops an approval
 * recorded against unverifiable bytes from closing a requirement.
 */
function isUsableEvidence(evidence: RequirementEvidenceState): boolean {
  return evidence.reviewStatus === "verified" && evidence.safety === "verified";
}

export function requirementStatusOf(instance: RequirementInstanceState): RequirementStatus {
  if (instance.applicability !== "required") return "resolved_without_evidence";
  if (instance.evidence.some(isUsableEvidence)) return "satisfied";

  // Ordered by who has to act next. A file waiting on a reviewer is different
  // work from a file waiting on the scanner, and both are different from a
  // client who has sent nothing -- and only the last of the three is a reason to
  // send anyone a reminder.
  if (
    instance.evidence.some((item) => item.reviewStatus === "pending" && item.safety === "verified")
  ) {
    return "awaiting_review";
  }
  if (instance.evidence.some((item) => item.safety === "pending" || item.safety === "unknown")) {
    return "awaiting_scan";
  }
  return "outstanding";
}

export type RequirementSummary = {
  total: number;
  satisfied: number;
  resolvedWithoutEvidence: number;
  awaitingReview: number;
  awaitingScan: number;
  outstanding: number;
  /**
   * Every required instance is settled one way or another. Deliberately does not
   * count awaiting_review or awaiting_scan as done: a filing built on evidence
   * nobody has checked is the failure this whole model exists to prevent.
   */
  complete: boolean;
};

export function summarizeRequirements(
  instances: readonly RequirementInstanceState[],
): RequirementSummary {
  const summary: RequirementSummary = {
    total: instances.length,
    satisfied: 0,
    resolvedWithoutEvidence: 0,
    awaitingReview: 0,
    awaitingScan: 0,
    outstanding: 0,
    complete: true,
  };

  for (const instance of instances) {
    switch (requirementStatusOf(instance)) {
      case "satisfied":
        summary.satisfied += 1;
        break;
      case "resolved_without_evidence":
        summary.resolvedWithoutEvidence += 1;
        break;
      case "awaiting_review":
        summary.awaitingReview += 1;
        summary.complete = false;
        break;
      case "awaiting_scan":
        summary.awaitingScan += 1;
        summary.complete = false;
        break;
      case "outstanding":
        summary.outstanding += 1;
        summary.complete = false;
        break;
    }
  }

  return summary;
}

/**
 * What is genuinely still owed by the client, named per person.
 *
 * Mirrors outstandingForClient's split at the requirement level: evidence that
 * has arrived is our work whatever state it is in, and asking the client for it
 * again is asking for something already in hand.
 */
export function outstandingRequirementsForClient(
  instances: readonly RequirementInstanceState[],
): RequirementInstanceState[] {
  return instances.filter((instance) => requirementStatusOf(instance) === "outstanding");
}

export function requirementsAwaitingUs(
  instances: readonly RequirementInstanceState[],
): RequirementInstanceState[] {
  return instances.filter((instance) => {
    const status = requirementStatusOf(instance);
    return status === "awaiting_review" || status === "awaiting_scan";
  });
}

/**
 * A human-readable label for what is missing, per person.
 *
 * The point of the whole model: "身分證明文件" is not actionable when two
 * directors need one each and only one arrived. "身分證明文件（陳大文）" is.
 */
export function describeRequirement(instance: RequirementInstanceState): string {
  return instance.partyName
    ? `${instance.requirementKey}（${instance.partyName}）`
    : instance.requirementKey;
}
