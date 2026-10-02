import {
  blocksRelease,
  type AnalysisProvenance,
  type Finding,
  type PersistedFinding,
} from "./findings";
import { isBoundEvidence } from "./evidence-contract";
import type { ExtractedEvidence } from "./text-extraction";
import type { DocumentSummary } from "./repository";

/**
 * What a reviewer is shown about a document, and what they must not be shown.
 *
 * The whole point of this module is one distinction. An empty finding list has
 * two completely different meanings:
 *
 * - nothing has analysed this document yet, or
 * - it was analysed and nothing was wrong.
 *
 * Rendering both as an empty list would tell a reviewer "checked, clean" about a
 * document nothing has ever looked at. Today that would be *every* document,
 * because the analysis worker refuses anything without a real malware verdict
 * and the scanner is BLOCKED_INTEGRATION -- so the wrong version of this screen
 * would be uniformly, confidently wrong.
 */

export type AnalysisRunState =
  | "legacy-unverified"
  /** A run finished. An empty list here really does mean nothing was found. */
  | "analysed"
  /** Queued and not yet run. */
  | "pending"
  /** Claimed, and it could not proceed -- today, waiting for a scan verdict. */
  | "deferred"
  /** Ran and gave up. Needs a person. */
  | "failed"
  /** No job exists at all, or the one that did will never answer. */
  | "never-queued";

export type DocumentFindingsView = {
  documentId: string;
  documentVersionId: string;
  fileName: string;
  state: AnalysisRunState;
  /** Ordered worst first. Empty is only meaningful when state is "analysed". */
  findings: PersistedFinding[];
  provenance?: AnalysisProvenance | null;
  evidence?: ExtractedEvidence | null;
  document?: Pick<
    DocumentSummary,
    "id" | "currentVersionId" | "uploadStatus" | "scanVerdictSource" | "availability"
  >;
};

export type ReviewSummary = {
  /** Unresolved findings that would hold a filing back. */
  blocking: number;
  /** Unresolved issues that would not. */
  advisory: number;
  /** Checks that could not be performed. */
  uncertain: number;
  /**
   * Documents nothing has analysed. Counted separately and never folded into a
   * "0 problems" total, because they are the absence of an answer rather than a
   * reassuring one.
   */
  notAnalysed: number;
};

export function analysisStateFrom(
  job: {
    status: "pending" | "processing" | "succeeded" | "failed" | "cancelled";
    lastErrorCode: string | null;
  } | null,
): AnalysisRunState {
  if (!job) return "never-queued";
  if (job.status === "succeeded") return "analysed";
  if (job.status === "failed") return "failed";
  // 'processing' included: a claim is in flight, and from a reviewer's point of
  // view that is indistinguishable from queued -- neither has produced an answer.
  if (job.status === "pending" || job.status === "processing") {
    return job.lastErrorCode === "awaiting-scan-verdict" ? "deferred" : "pending";
  }
  // 'cancelled' -- the version was superseded, so this job will never answer.
  return "never-queued";
}

/**
 * Whether an empty finding list may be presented as reassurance.
 *
 * Only "analysed" qualifies. Everything else means the silence is the absence of
 * an answer, and the screen has to say which.
 */
export function isSilenceMeaningful(state: AnalysisRunState): boolean {
  return state === "analysed";
}

/** What to tell a reviewer when there are no findings to show. */
export function describeSilence(state: AnalysisRunState): string {
  if (state === "legacy-unverified")
    return "這份歷史分析欠缺當前版本引用，請重新檢查；這不代表文件沒有問題。";
  switch (state) {
    case "analysed":
      return "已完成自動檢查，未發現問題。";
    case "deferred":
      // The honest and, today, universal case.
      return "尚未檢查：仍在等待防毒掃描結果。這不代表文件沒有問題。";
    case "pending":
      return "已排隊，尚未檢查。這不代表文件沒有問題。";
    case "failed":
      return "自動檢查失敗，需要人手跟進。這不代表文件沒有問題。";
    case "never-queued":
      return "沒有自動檢查記錄。這不代表文件沒有問題。";
  }
}

const OUTCOME_RANK: Record<Finding["outcome"], number> = { issue: 0, uncertain: 1, pass: 2 };
const SEVERITY_RANK: Record<Finding["severity"], number> = { critical: 0, warning: 1, info: 2 };

/**
 * Worst first, and resolved last within a tie.
 *
 * Sorts the persisted rows directly rather than sorting the inner findings and
 * matching rows back by object identity: identity matching needs a fallback for
 * the case it cannot resolve, and any fallback here would silently attach one
 * finding's id and resolution to another finding's text.
 */
export function orderPersisted(findings: readonly PersistedFinding[]): PersistedFinding[] {
  return [...findings].sort((left, right) => {
    const resolvedRank =
      Number(Boolean(left.resolvedByUserId)) - Number(Boolean(right.resolvedByUserId));
    if (resolvedRank !== 0) return resolvedRank;
    return (
      OUTCOME_RANK[left.finding.outcome] - OUTCOME_RANK[right.finding.outcome] ||
      SEVERITY_RANK[left.finding.severity] - SEVERITY_RANK[right.finding.severity] ||
      left.finding.ruleKey.localeCompare(right.finding.ruleKey)
    );
  });
}

export function viewFor(input: {
  documentId: string;
  documentVersionId: string;
  fileName: string;
  state: AnalysisRunState;
  findings: readonly PersistedFinding[];
  provenance?: AnalysisProvenance | null;
  evidence?: ExtractedEvidence | null;
  document?: DocumentFindingsView["document"];
}): DocumentFindingsView {
  return {
    documentId: input.documentId,
    documentVersionId: input.documentVersionId,
    fileName: input.fileName,
    state:
      input.state === "analysed" &&
      input.provenance !== undefined &&
      (!input.provenance ||
        !isBoundEvidence(input.evidence) ||
        input.evidence.documentVersionId !== input.documentVersionId)
        ? "legacy-unverified"
        : input.state,
    findings: orderPersisted(input.findings),
    ...(input.provenance !== undefined
      ? { provenance: input.provenance, evidence: input.evidence ?? null }
      : {}),
    ...(input.document ? { document: input.document } : {}),
  };
}

/**
 * Counts for the header.
 *
 * `notAnalysed` is deliberately not folded into the others. "3 problems across
 * 10 documents" is a very different statement from "3 problems across 10
 * documents, 7 of which nobody has looked at", and only the second is true today.
 */
export function summarize(views: readonly DocumentFindingsView[]): ReviewSummary {
  const summary: ReviewSummary = { blocking: 0, advisory: 0, uncertain: 0, notAnalysed: 0 };

  for (const view of views) {
    if (!isSilenceMeaningful(view.state)) summary.notAnalysed += 1;

    for (const entry of view.findings) {
      if (entry.resolvedByUserId) continue;
      // blocksRelease, called rather than restated, so the reviewer's count and
      // the manifest's blocker check cannot drift apart. They already did once.
      if (blocksRelease(entry.finding)) summary.blocking += 1;
      else if (entry.finding.outcome === "uncertain") summary.uncertain += 1;
      else if (entry.finding.outcome === "issue") summary.advisory += 1;
    }
  }

  return summary;
}
