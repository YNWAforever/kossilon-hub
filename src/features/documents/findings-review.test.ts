import { describe, expect, it } from "vitest";
import {
  analysisStateFrom,
  describeSilence,
  isSilenceMeaningful,
  orderPersisted,
  summarize,
  viewFor,
  type AnalysisRunState,
} from "./findings-review";
import { makeFinding, type FindingTier, type PersistedFinding } from "./findings";

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const REVIEWER = "22222222-2222-4222-8222-222222222222";

function persisted(overrides: {
  id: string;
  outcome?: "pass" | "issue" | "uncertain";
  severity?: "critical" | "warning" | "info";
  tier?: FindingTier;
  ruleKey?: string;
  resolved?: boolean;
}): PersistedFinding {
  return {
    id: overrides.id,
    resolvedByUserId: overrides.resolved ? REVIEWER : null,
    resolvedAt: overrides.resolved ? "2026-09-10T03:00:00.000Z" : null,
    finding: makeFinding({
      ruleKey: overrides.ruleKey ?? "content-identity-matches-claim",
      ruleVersion: "1",
      tier: overrides.tier ?? "cross-check",
      outcome: overrides.outcome ?? "issue",
      severity: overrides.severity ?? "critical",
      detail: "The stored bytes do not hash to the checksum declared at upload.",
      citation: { kind: "version", documentVersionId: VERSION_ID, pageFrom: null, pageTo: null },
    }),
  };
}

function view(state: AnalysisRunState, findings: PersistedFinding[] = []) {
  return viewFor({
    documentId: "doc-1",
    documentVersionId: VERSION_ID,
    fileName: "passport.pdf",
    state,
    findings,
  });
}

describe("analysisStateFrom", () => {
  it("calls a finished run analysed", () => {
    expect(analysisStateFrom({ status: "succeeded", lastErrorCode: null })).toBe("analysed");
  });

  // Today's universal case: the worker claimed the job, found no real scanner
  // verdict, and put it back.
  it("distinguishes waiting for a scan from merely queued", () => {
    expect(analysisStateFrom({ status: "pending", lastErrorCode: "awaiting-scan-verdict" })).toBe(
      "deferred",
    );
    expect(analysisStateFrom({ status: "pending", lastErrorCode: null })).toBe("pending");
  });

  // A claim in flight has produced no answer, which from a reviewer's seat is
  // the same as not having started.
  it("treats a run in flight as not yet answered", () => {
    expect(analysisStateFrom({ status: "processing", lastErrorCode: null })).toBe("pending");
  });

  it("reports a job that gave up, and one that never existed", () => {
    expect(analysisStateFrom({ status: "failed", lastErrorCode: "version-missing" })).toBe(
      "failed",
    );
    expect(analysisStateFrom(null)).toBe("never-queued");
  });

  // A cancelled job belongs to a superseded version and will never answer.
  it("does not treat a cancelled job as an answer", () => {
    expect(analysisStateFrom({ status: "cancelled", lastErrorCode: "superseded-version" })).toBe(
      "never-queued",
    );
  });
});

/**
 * The distinction this module exists for. Getting it wrong would tell a reviewer
 * "checked, clean" about a document nothing has looked at -- and today that is
 * every document, so the wrong version of this screen is uniformly wrong.
 */
describe("an empty finding list", () => {
  it("is reassurance only after a run actually finished", () => {
    expect(isSilenceMeaningful("analysed")).toBe(true);
    for (const state of ["pending", "deferred", "failed", "never-queued"] as const) {
      expect(isSilenceMeaningful(state)).toBe(false);
    }
  });

  it("says so, and says it is not a clean bill of health", () => {
    for (const state of ["pending", "deferred", "failed", "never-queued"] as const) {
      expect(describeSilence(state)).toContain("這不代表文件沒有問題");
    }
    expect(describeSilence("analysed")).not.toContain("這不代表");
  });

  it("names waiting for the scanner specifically, since that is why", () => {
    expect(describeSilence("deferred")).toContain("防毒掃描");
  });
});

describe("orderPersisted", () => {
  it("puts blocking problems first and resolved ones last", () => {
    const ordered = orderPersisted([
      persisted({ id: "resolved", resolved: true }),
      persisted({ id: "uncertain", outcome: "uncertain", severity: "warning" }),
      persisted({ id: "blocking", outcome: "issue", severity: "critical" }),
      persisted({ id: "advisory", outcome: "issue", severity: "warning" }),
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual([
      "blocking",
      "advisory",
      "uncertain",
      "resolved",
    ]);
  });

  // The ordering must carry each row's own id and resolution. Sorting the inner
  // findings and matching rows back by identity needed a fallback, and any
  // fallback would attach one finding's id to another finding's text.
  it("keeps every row's id attached to its own finding", () => {
    const rows = [
      persisted({ id: "a", ruleKey: "zzz", outcome: "issue", severity: "warning" }),
      persisted({ id: "b", ruleKey: "aaa", outcome: "issue", severity: "critical" }),
    ];
    for (const entry of orderPersisted(rows)) {
      const original = rows.find((row) => row.id === entry.id);
      expect(entry.finding.ruleKey).toBe(original?.finding.ruleKey);
    }
  });

  it("does not mutate its input", () => {
    const rows = [persisted({ id: "a", resolved: true }), persisted({ id: "b" })];
    orderPersisted(rows);
    expect(rows.map((row) => row.id)).toEqual(["a", "b"]);
  });
});

describe("summarize", () => {
  it("counts a deterministic critical issue as blocking", () => {
    expect(summarize([view("analysed", [persisted({ id: "f1" })])])).toMatchObject({ blocking: 1 });
  });

  // The manifest cannot block on a provider finding, so the reviewer's count
  // must not claim it will. blocksRelease is called, not restated.
  it("does not count a provider finding as blocking, however severe", () => {
    const summary = summarize([
      view("analysed", [persisted({ id: "f1", tier: "provider", severity: "critical" })]),
    ]);
    expect(summary).toMatchObject({ blocking: 0, advisory: 1 });
  });

  it("counts an unperformed check as uncertain rather than as a problem", () => {
    const summary = summarize([
      view("analysed", [persisted({ id: "f1", outcome: "uncertain", severity: "warning" })]),
    ]);
    expect(summary).toMatchObject({ blocking: 0, advisory: 0, uncertain: 1 });
  });

  it("ignores anything a person has already dealt with", () => {
    expect(summarize([view("analysed", [persisted({ id: "f1", resolved: true })])])).toMatchObject({
      blocking: 0,
    });
  });

  /**
   * "3 problems across 10 documents" and "3 problems across 10 documents, 7 of
   * which nobody has looked at" are different statements, and only the second is
   * true today.
   */
  it("counts un-analysed documents separately rather than as zero problems", () => {
    const summary = summarize([
      view("analysed", [persisted({ id: "f1" })]),
      view("deferred"),
      view("never-queued"),
    ]);
    expect(summary).toEqual({ blocking: 1, advisory: 0, uncertain: 0, notAnalysed: 2 });
  });

  it("reports the state every document is in today", () => {
    const summary = summarize([view("deferred"), view("deferred")]);
    expect(summary).toEqual({ blocking: 0, advisory: 0, uncertain: 0, notAnalysed: 2 });
  });
});
