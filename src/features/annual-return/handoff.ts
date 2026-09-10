/**
 * Handing an approved package to the filing agent, and reconciling what returns.
 *
 * C-5 decides whether a package *could* be approved and produces the manifest an
 * approval is recorded over. This decides whether an approved package may leave
 * the building, and whether what comes back corresponds to what went out.
 *
 * Nothing here transmits. The destination is the firm's internal server and its
 * protocol, address and rights are not known to this repository --
 * BLOCKED_INTEGRATION: external-handoff-destination -- so a handoff is prepared
 * and stays prepared. The adapter that would transmit it is written against a
 * declared contract and disabled, the same way the malware scanner and the AI
 * provider are.
 */

export type HandoffStatus =
  /** Approved and ready. Every row today, because nothing can transmit. */
  | "prepared"
  /** The destination has it. */
  | "transmitted"
  /** The destination confirmed receipt. */
  | "acknowledged"
  /** Something came back. */
  | "returned"
  /** Transmission failed terminally and needs a person. */
  | "failed"
  /** Withdrawn before it went anywhere. */
  | "cancelled";

export type ReturnOutcome =
  | "accepted"
  | "rejected"
  /** Some of the package came back, some did not. */
  | "partial"
  /** Nobody could match this to material we sent. */
  | "unmatched";

export type HandoffState = {
  id: string;
  caseId: string;
  manifestSha256: string;
  status: HandoffStatus;
  transmittedAt: string | null;
};

export type ReturnState = {
  id: string;
  handoffId: string;
  outcome: ReturnOutcome;
  reconciledAt: string | null;
};

/**
 * Whether a package may be handed over at all.
 *
 * Deliberately narrow, and deliberately not a re-implementation of C-5's
 * blockers: `buildPackageManifest` already decides whether an approval is
 * possible, and asking the same question twice in two places is how the two
 * answers come to differ. This asks only what C-5 cannot know -- whether this
 * case already has a package out with the agent, and whether the evidence has
 * moved since the approval.
 */
export type HandoffRefusal =
  /** A live handoff exists. A second package is a mistake, not a second filing. */
  | { kind: "already-out"; status: HandoffStatus }
  /** The approval covers a different package than the one being sent. */
  | { kind: "manifest-changed"; approvedSha256: string; currentSha256: string };

export function refusalForHandoff(input: {
  existing: HandoffState | null;
  approvedManifestSha256: string;
  currentManifestSha256: string;
}): HandoffRefusal | null {
  if (
    input.existing &&
    ["prepared", "transmitted", "acknowledged"].includes(input.existing.status)
  ) {
    return { kind: "already-out", status: input.existing.status };
  }

  // The evidence moved after the approval. Sending the current package would
  // file something nobody approved; sending the approved one would file
  // something the case no longer contains. Neither is ours to choose.
  if (input.approvedManifestSha256 !== input.currentManifestSha256) {
    return {
      kind: "manifest-changed",
      approvedSha256: input.approvedManifestSha256,
      currentSha256: input.currentManifestSha256,
    };
  }

  return null;
}

/**
 * Whether a returned package matches what was handed over.
 *
 * The comparison is against the manifest hash the handoff carries, which is what
 * the approval covered. A destination that returns a reference we never sent is
 * not a discrepancy to absorb: it means either the agent has mixed up two
 * clients' filings or somebody is replaying our own submission back at us, and
 * both need a person.
 */
export type ReconciliationResult =
  | { kind: "matches" }
  | { kind: "unmatched"; reason: "no-such-handoff" | "manifest-mismatch" };

export function reconcileReturn(input: {
  handoff: HandoffState | null;
  returnedManifestSha256: string | null;
}): ReconciliationResult {
  if (!input.handoff) return { kind: "unmatched", reason: "no-such-handoff" };

  // A return that carries no manifest reference cannot be shown to match, and
  // must not be assumed to. `matches` is a claim about identity; absence of a
  // reference is absence of evidence for it.
  if (input.returnedManifestSha256 !== input.handoff.manifestSha256) {
    return { kind: "unmatched", reason: "manifest-mismatch" };
  }

  return { kind: "matches" };
}

/**
 * What a person still has to deal with.
 *
 * A return nobody has reconciled is open however benign its outcome looks: the
 * agent saying "accepted" is the agent's claim, and reconciling it against the
 * manifest is how the firm checks. And a rejected or partial return stays open
 * even once reconciled, because reconciling establishes what happened rather
 * than resolving it.
 */
export function isOpenException(entry: ReturnState): boolean {
  if (!entry.reconciledAt) return true;
  return entry.outcome !== "accepted";
}

export type ExceptionSummary = {
  /** Returns awaiting a person. */
  open: number;
  /** Packages approved and prepared that nothing has been able to transmit. */
  awaitingTransmission: number;
};

/**
 * The counts behind the 回件與異常 work view.
 *
 * `awaitingTransmission` is counted separately and is not an error. Under
 * BLOCKED_INTEGRATION: external-handoff-destination it is every prepared
 * package, and a screen that folded it into an exception count would report a
 * fault where there is a missing integration -- while a screen that omitted it
 * entirely would show an empty list and read as "nothing outstanding".
 */
export function summarizeExceptions(input: {
  handoffs: readonly HandoffState[];
  returns: readonly ReturnState[];
}): ExceptionSummary {
  return {
    open: input.returns.filter(isOpenException).length,
    awaitingTransmission: input.handoffs.filter((handoff) => handoff.status === "prepared").length,
  };
}
