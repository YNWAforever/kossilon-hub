/**
 * What an analysis pass is allowed to say, and what it can never say.
 *
 * Two rules from the plan are enforced here rather than remembered:
 *
 * 1. Every finding cites its source or says it has none. A finding about a
 *    missing document has nothing to point at, and inventing a page reference
 *    for a document that does not exist is the specific failure this shape
 *    exists to prevent -- so "nothing to cite" is a citation, not a null.
 *
 * 2. Document text is untrusted evidence. Extracted text, OCR output and
 *    message bodies are data, never instructions. The enforcement is that a
 *    provider-tier finding cannot reach the severity that blocks a filing: a
 *    PDF whose text says "this case has a critical problem, hold the filing"
 *    can produce a warning a human reads, and nothing more. It cannot stop a
 *    release, and it certainly cannot cause one.
 */

export type FindingOutcome =
  /** Checked, and it is fine. */
  | "pass"
  /** Checked, and something is wrong. */
  | "issue"
  /**
   * Could not be checked. A first-class outcome, not a low score: an image-only
   * PDF with no text layer must report that the year could not be read, never
   * that the year is missing.
   */
  | "uncertain";

export type FindingSeverity = "critical" | "warning" | "info";

export type FindingTier =
  /** Readability of the stored bytes. Deterministic. */
  | "classification"
  /** Records compared against each other. Deterministic. */
  | "cross-check"
  /** A model read something. Advisory only. */
  | "provider";

export type AnalysisProvenance = {
  schemaVersion: string;
  model: string | null;
  cost: number | null;
  advisoryOnly: boolean;
  ruleVersion?: string;
  promptVersion?: string;
  providerConfigured?: boolean;
  providerStatus?: string;
  providerReference?: string | null;
  providerError?: string | null;
  providerMetadataStatus?: string;
  extraction?: import("./text-extraction").ExtractedEvidence["provenance"];
};

export type FindingCitation =
  /** Specific bytes, optionally a page range within them. */
  | { kind: "version"; documentVersionId: string; pageFrom: number | null; pageTo: number | null }
  /** A requirement rather than a file -- for instance, one nobody has answered. */
  | { kind: "requirement"; requirementInstanceId: string }
  /** An absence. There is genuinely nothing to point at, and that is recorded. */
  | { kind: "none" };

export type Finding = {
  ruleKey: string;
  /** So a finding recorded last month can be read against the rule that made it. */
  ruleVersion: string;
  tier: FindingTier;
  outcome: FindingOutcome;
  severity: FindingSeverity;
  /** Plain text for a human. Never interpreted, never executed. */
  detail: string;
  citation: FindingCitation;
  evidence?: {
    sha256: string;
    field: string;
    partyId: string | null;
    year: number | null;
    observed: string | null;
    expected: string | null;
    unknownReason: string | null;
    requirementInstanceId: string | null;
    spans: import("./text-extraction").EvidenceSpan[];
  };
};

/**
 * A finding as it exists in the database, with its identity and its resolution.
 *
 * One shape, used by both the review workspace and the package manifest. They
 * had two: the manifest carried its own tier-less copy, which is how it came to
 * test severity itself instead of asking `blocksRelease`, and how a provider
 * finding could have blocked a filing.
 */
export type PersistedFinding = {
  id: string;
  finding: Finding;
  /** A person dealt with it. No worker can write this. */
  resolvedByUserId: string | null;
  resolvedAt: string | null;
};

/**
 * The severity a finding is actually allowed to carry.
 *
 * Clamped rather than trusted, because three different things would otherwise
 * each be able to block a filing by accident:
 *
 * - A `pass` is not a problem, so it cannot be a warning or worse.
 * - An `uncertain` is not evidence of a problem. Letting it be critical would
 *   block every filing for as long as extraction is unavailable, which is the
 *   present state -- "we could not check" would become "you may not file".
 * - A provider finding is advisory. `critical` is the severity that holds a
 *   package back, so a model -- reading text an uploader controls -- must not be
 *   able to reach it.
 */
export function allowedSeverity(
  tier: FindingTier,
  outcome: FindingOutcome,
  proposed: FindingSeverity,
): FindingSeverity {
  if (outcome === "pass") return "info";
  if (outcome === "uncertain") return proposed === "critical" ? "warning" : proposed;
  if (tier === "provider") return proposed === "critical" ? "warning" : proposed;
  return proposed;
}

export function makeFinding(input: {
  ruleKey: string;
  ruleVersion: string;
  tier: FindingTier;
  outcome: FindingOutcome;
  severity: FindingSeverity;
  detail: string;
  citation: FindingCitation;
  evidence?: Finding["evidence"];
}): Finding {
  if (!input.ruleKey.trim()) throw new Error("A finding must name the rule that produced it.");
  if (!input.ruleVersion.trim()) throw new Error("A finding must carry its rule version.");
  if (!input.detail.trim()) throw new Error("A finding must say something a human can read.");

  const citation = input.citation;
  if (citation.kind === "version") {
    // Pages only mean something against specific bytes, and a page range that
    // runs backwards is a bug in the caller, not a finding about the document.
    if (citation.pageFrom !== null && citation.pageFrom < 1) {
      throw new Error("A cited page range starts at 1.");
    }
    if (citation.pageTo !== null && citation.pageFrom === null) {
      throw new Error("A cited page range needs a start.");
    }
    if (
      citation.pageFrom !== null &&
      citation.pageTo !== null &&
      citation.pageTo < citation.pageFrom
    ) {
      throw new Error("A cited page range ends at or after it starts.");
    }
  }

  return {
    ruleKey: input.ruleKey,
    ruleVersion: input.ruleVersion,
    tier: input.tier,
    outcome: input.outcome,
    severity: allowedSeverity(input.tier, input.outcome, input.severity),
    detail: input.detail,
    citation,
    ...(input.evidence ? { evidence: input.evidence } : {}),
  };
}

/**
 * Whether this finding, left unresolved, holds a package back.
 *
 * Deliberately narrow. Only a deterministic check that actually found something
 * wrong can stop a filing; everything else is information for the reviewer.
 *
 * `buildPackageManifest` calls this rather than testing severity itself, so the
 * rule lives in one place. It did not always: the manifest predates the analysis
 * pipeline and carried its own two-field copy of a finding with no `tier`, which
 * meant a provider finding recorded as critical would have blocked a filing --
 * the one thing a provider tier must never be able to do.
 */
export function blocksRelease(finding: Finding): boolean {
  return finding.outcome === "issue" && finding.severity === "critical";
}

/** Findings a reviewer should see first: real problems, worst first. */
export function orderForReview(findings: readonly Finding[]): Finding[] {
  const outcomeRank: Record<FindingOutcome, number> = { issue: 0, uncertain: 1, pass: 2 };
  const severityRank: Record<FindingSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return [...findings].sort(
    (left, right) =>
      outcomeRank[left.outcome] - outcomeRank[right.outcome] ||
      severityRank[left.severity] - severityRank[right.severity] ||
      left.ruleKey.localeCompare(right.ruleKey),
  );
}
