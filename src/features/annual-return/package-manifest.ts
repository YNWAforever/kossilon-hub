import { blocksRelease, type Finding } from "@/features/documents/findings";
import {
  canCiteInManifest,
  isCurrent,
  type DocumentVersionState,
} from "@/features/documents/versions";
import { describeRequirement, type RequirementInstanceState } from "./requirements";

/**
 * What exactly was approved, and by whom.
 *
 * A filing package is a claim that a named set of requirements was satisfied by
 * a named set of bytes, checked by a named person. Every word of that has to be
 * pinned down or the approval means nothing: "the document" is not a version,
 * "verified" is not a scan, and a worker's finding is not a decision.
 *
 * The manifest is therefore built rather than asserted. Anything that would
 * make it a claim nobody can stand behind comes back as a blocker with the
 * reason attached, so the person who has to fix it is told what to fix.
 *
 * Nothing here approves anything. It decides whether an approval *could* be
 * recorded, and produces the exact payload an approval would be recorded over.
 */

/** A decision a person made. Never written by a worker; see `decidedByUserId`. */
export type HumanDecision = {
  /**
   * A staff user id. There is deliberately no representation for a non-human
   * decider: the way AI is kept out of approval is that there is no shape it
   * could be written in, not a flag somebody has to remember to check.
   */
  decidedByUserId: string;
  decision: "approve" | "request-correction" | "needs-investigation" | "authorized-not-applicable";
  decidedAt: string;
  reason: string | null;
};

/**
 * A finding from the analysis pipeline, as the manifest sees it.
 *
 * Carries the whole `Finding` rather than a copy of two of its fields. The
 * copy was a real gap: this type was written before the analysis pipeline
 * existed, so it had no `tier`, and the blocker check below tested
 * `severity === "critical"` itself instead of asking `blocksRelease`. Two
 * statements of one rule, and `findings.ts` claimed the opposite -- that the
 * manifest "asks this question rather than inspecting severity directly, so the
 * rule lives in one place". It did not, until now.
 */
export type FindingState = {
  id: string;
  finding: Finding;
  /** Whether a person has dealt with it. A worker cannot set this. */
  resolvedByUserId: string | null;
};

export type ManifestCandidateEntry = {
  requirement: RequirementInstanceState;
  /**
   * The version being filed, and the pages of it that answer the requirement.
   * Null for a requirement deliberately resolved without evidence.
   */
  version: DocumentVersionState | null;
  pageFrom: number | null;
  pageTo: number | null;
  decision: HumanDecision | null;
  findings: readonly FindingState[];
};

export type ManifestEntry = {
  requirementInstanceId: string;
  requirementKey: string;
  partyId: string | null;
  documentId: string | null;
  documentVersionId: string | null;
  /** The verified content identity. Never the client's declared value. */
  contentSha256: string | null;
  pageFrom: number | null;
  pageTo: number | null;
  decidedByUserId: string;
  decidedAt: string;
};

export type ManifestBlocker =
  /** Nothing usable has arrived, or the only evidence was rejected. */
  | { kind: "requirement-outstanding"; requirement: string }
  /** Evidence exists but nobody has hashed the stored bytes. */
  | { kind: "evidence-unverifiable"; requirement: string; documentVersionId: string }
  /** The cited version has been replaced since it was chosen. */
  | { kind: "evidence-superseded"; requirement: string; documentVersionId: string }
  /** A worker looked at it; no person did. */
  | { kind: "missing-human-decision"; requirement: string }
  /** A person looked at it and did not approve it. */
  | { kind: "decision-not-approval"; requirement: string; decision: HumanDecision["decision"] }
  /** A critical finding nobody has dealt with. */
  | { kind: "unresolved-critical-finding"; requirement: string; findingId: string };

export type PackageManifest = {
  caseId: string;
  returnYear: number;
  /** Which rule set produced these requirements, so the claim is reproducible. */
  requirementTemplateVersion: string;
  entries: readonly ManifestEntry[];
};

export type ManifestResult =
  | { kind: "releasable"; manifest: PackageManifest }
  | { kind: "blocked"; blockers: readonly ManifestBlocker[] };

function blockersFor(candidate: ManifestCandidateEntry): ManifestBlocker[] {
  const blockers: ManifestBlocker[] = [];
  const requirement = describeRequirement(candidate.requirement);

  // A blocking finding stops the package whatever the reviewer concluded. It is
  // the one place a worker's output has force, and only ever in the safe
  // direction: holding a package back, never releasing one.
  //
  // `blocksRelease` rather than a severity test here, so a provider-tier finding
  // can never block. That matters: a provider reads text an uploader controls,
  // and a document that could stall a filing by asserting a critical problem
  // would be a denial of service against the client it belongs to.
  for (const entry of candidate.findings) {
    if (!entry.resolvedByUserId && blocksRelease(entry.finding)) {
      blockers.push({ kind: "unresolved-critical-finding", requirement, findingId: entry.id });
    }
  }

  if (!candidate.decision) {
    blockers.push({ kind: "missing-human-decision", requirement });
  } else if (
    candidate.decision.decision !== "approve" &&
    candidate.decision.decision !== "authorized-not-applicable"
  ) {
    blockers.push({
      kind: "decision-not-approval",
      requirement,
      decision: candidate.decision.decision,
    });
  }

  // A requirement someone authorised as not applicable is settled by that
  // decision and needs no bytes. Everything else needs evidence.
  const resolvedWithoutEvidence =
    candidate.decision?.decision === "authorized-not-applicable" ||
    candidate.requirement.applicability !== "required";

  if (!candidate.version) {
    if (!resolvedWithoutEvidence) blockers.push({ kind: "requirement-outstanding", requirement });
    return blockers;
  }

  if (!isCurrent(candidate.version)) {
    // The reviewer approved these bytes and a newer upload has since replaced
    // them. Filing the approved version would file something the client has
    // already corrected; filing the new one would file something nobody read.
    blockers.push({
      kind: "evidence-superseded",
      requirement,
      documentVersionId: candidate.version.id,
    });
  }

  if (!canCiteInManifest(candidate.version)) {
    blockers.push({
      kind: "evidence-unverifiable",
      requirement,
      documentVersionId: candidate.version.id,
    });
  }

  return blockers;
}

export function buildPackageManifest(input: {
  caseId: string;
  returnYear: number;
  requirementTemplateVersion: string;
  entries: readonly ManifestCandidateEntry[];
}): ManifestResult {
  const blockers = input.entries.flatMap(blockersFor);
  if (blockers.length > 0) return { kind: "blocked", blockers };

  const entries: ManifestEntry[] = [];
  for (const candidate of input.entries) {
    // A candidate with no decision is a blocker, so nothing reaches here without
    // one. Narrowed rather than asserted, so that a future blocker removed by
    // accident becomes a type error instead of a manifest with a missing signer.
    const decision = candidate.decision;
    if (!decision) continue;

    entries.push({
      requirementInstanceId: candidate.requirement.id,
      requirementKey: candidate.requirement.requirementKey,
      partyId: candidate.requirement.partyId,
      documentId: candidate.version?.documentId ?? null,
      documentVersionId: candidate.version?.id ?? null,
      contentSha256: candidate.version?.verifiedChecksum ?? null,
      pageFrom: candidate.pageFrom,
      pageTo: candidate.pageTo,
      decidedByUserId: decision.decidedByUserId,
      decidedAt: decision.decidedAt,
    });
  }

  return {
    kind: "releasable",
    manifest: {
      caseId: input.caseId,
      returnYear: input.returnYear,
      requirementTemplateVersion: input.requirementTemplateVersion,
      entries,
    },
  };
}

/**
 * The exact bytes an approval is recorded over.
 *
 * Hashing is left to the caller, which keeps this module free of crypto and
 * testable without it -- and means the same payload can be hashed, logged and
 * diffed rather than only hashed.
 *
 * Two properties matter and are both tested: entry order must not change the
 * payload, because the order rows come back in is a query detail and not part
 * of what was approved; and every field that identifies the filing must be in
 * it, because a field left out is a field that can change afterwards without
 * invalidating an approval recorded before the change.
 */
export function canonicalManifestPayload(manifest: PackageManifest): string {
  const entries = [...manifest.entries]
    .sort((left, right) => left.requirementInstanceId.localeCompare(right.requirementInstanceId))
    .map((entry) => ({
      requirementInstanceId: entry.requirementInstanceId,
      requirementKey: entry.requirementKey,
      partyId: entry.partyId,
      documentId: entry.documentId,
      documentVersionId: entry.documentVersionId,
      contentSha256: entry.contentSha256,
      pageFrom: entry.pageFrom,
      pageTo: entry.pageTo,
      decidedByUserId: entry.decidedByUserId,
      decidedAt: entry.decidedAt,
    }));

  return JSON.stringify({
    caseId: manifest.caseId,
    returnYear: manifest.returnYear,
    requirementTemplateVersion: manifest.requirementTemplateVersion,
    entries,
  });
}
