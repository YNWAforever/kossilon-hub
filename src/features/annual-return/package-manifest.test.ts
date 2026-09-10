import { describe, expect, it } from "vitest";
import { makeFinding, type FindingTier } from "@/features/documents/findings";
import type { DocumentVersionState } from "@/features/documents/versions";
import {
  buildPackageManifest,
  canonicalManifestPayload,
  type HumanDecision,
  type ManifestCandidateEntry,
  type PackageManifest,
} from "./package-manifest";
import type { RequirementInstanceState } from "./requirements";

const VERIFIED_HASH = "a".repeat(64);
const REVIEWER = "11111111-1111-4111-8111-111111111111";

let counter = 0;

function requirement(overrides: Partial<RequirementInstanceState> = {}): RequirementInstanceState {
  counter += 1;
  return {
    id: `req-${counter}`,
    checklistItemId: "item-1",
    partyId: null,
    partyName: null,
    requirementKey: "NAR1",
    applicability: "required",
    evidence: [],
    ...overrides,
  };
}

function version(overrides: Partial<DocumentVersionState> = {}): DocumentVersionState {
  counter += 1;
  return {
    id: `ver-${counter}`,
    documentId: `doc-${counter}`,
    versionNumber: 1,
    declaredChecksum: "b".repeat(64),
    verifiedChecksum: VERIFIED_HASH,
    supersededByVersionId: null,
    ...overrides,
  };
}

const approval: HumanDecision = {
  decidedByUserId: REVIEWER,
  decision: "approve",
  decidedAt: "2026-09-10T02:00:00.000Z",
  reason: null,
};

function candidate(overrides: Partial<ManifestCandidateEntry> = {}): ManifestCandidateEntry {
  return {
    requirement: requirement(),
    version: version(),
    pageFrom: null,
    pageTo: null,
    decision: approval,
    findings: [],
    ...overrides,
  };
}

/**
 * A finding as the manifest sees it. `tier` matters now: the manifest asks
 * blocksRelease rather than testing severity, so a provider-tier finding cannot
 * block however severe it claims to be.
 */
function findingState(overrides: {
  id: string;
  severity: "critical" | "warning" | "info";
  resolvedByUserId?: string | null;
  tier?: FindingTier;
}) {
  return {
    id: overrides.id,
    resolvedByUserId: overrides.resolvedByUserId ?? null,
    finding: makeFinding({
      ruleKey: "content-identity-matches-claim",
      ruleVersion: "1",
      tier: overrides.tier ?? "cross-check",
      outcome: "issue",
      severity: overrides.severity,
      detail: "The stored bytes do not hash to the checksum declared at upload.",
      citation: { kind: "none" },
    }),
  };
}

function build(entries: ManifestCandidateEntry[]) {
  return buildPackageManifest({
    caseId: "case-1",
    returnYear: 2026,
    requirementTemplateVersion: "annual-return-v1",
    entries,
  });
}

describe("buildPackageManifest", () => {
  it("releases when every requirement has verified evidence and a person approved it", () => {
    const result = build([candidate()]);
    expect(result.kind).toBe("releasable");
  });

  // The rule the whole phase exists for. A finding is advisory; an approval is a
  // person. There is deliberately no shape a worker could write a decision in.
  it("refuses to release a requirement no person decided", () => {
    const result = build([candidate({ decision: null })]);
    expect(result).toMatchObject({
      kind: "blocked",
      blockers: [{ kind: "missing-human-decision" }],
    });
  });

  it("refuses when a reviewer asked for a correction rather than approving", () => {
    const result = build([
      candidate({ decision: { ...approval, decision: "request-correction" } }),
    ]);
    expect(result).toMatchObject({
      kind: "blocked",
      blockers: [{ kind: "decision-not-approval", decision: "request-correction" }],
    });
  });

  // Only the provider scanner hashes stored bytes, and it is
  // BLOCKED_INTEGRATION -- so this is the state of every document today, and it
  // must read as "not releasable", not as "fine".
  it("refuses evidence whose stored bytes nobody has hashed", () => {
    const result = build([candidate({ version: version({ verifiedChecksum: null }) })]);
    expect(result).toMatchObject({
      kind: "blocked",
      blockers: [{ kind: "evidence-unverifiable" }],
    });
  });

  it("does not accept the client's declared checksum in place of a verified one", () => {
    const declaredOnly = version({ verifiedChecksum: null, declaredChecksum: VERIFIED_HASH });
    const result = build([candidate({ version: declaredOnly })]);
    expect(result.kind).toBe("blocked");
  });

  // Filing the approved version files something the client has already
  // corrected; filing the newer one files something nobody read.
  it("refuses a cited version that has since been replaced", () => {
    const result = build([candidate({ version: version({ supersededByVersionId: "ver-next" }) })]);
    expect(result).toMatchObject({
      kind: "blocked",
      blockers: [{ kind: "evidence-superseded" }],
    });
  });

  it("refuses a required requirement with no evidence at all", () => {
    const result = build([candidate({ version: null })]);
    expect(result).toMatchObject({
      kind: "blocked",
      blockers: [{ kind: "requirement-outstanding" }],
    });
  });

  it("allows a requirement a person authorized as not applicable to carry no evidence", () => {
    const result = build([
      candidate({
        version: null,
        decision: {
          ...approval,
          decision: "authorized-not-applicable",
          reason: "Sole director; no second identity document exists.",
        },
      }),
    ]);
    expect(result.kind).toBe("releasable");
  });

  // The one place a worker's output has force, and only in the safe direction.
  it("holds the package back for a critical finding nobody has dealt with", () => {
    const result = build([
      candidate({ findings: [findingState({ id: "f1", severity: "critical" })] }),
    ]);
    expect(result).toMatchObject({
      kind: "blocked",
      blockers: [{ kind: "unresolved-critical-finding", findingId: "f1" }],
    });
  });

  it("releases once a person has resolved the critical finding", () => {
    const result = build([
      candidate({
        findings: [findingState({ id: "f1", severity: "critical", resolvedByUserId: REVIEWER })],
      }),
    ]);
    expect(result.kind).toBe("releasable");
  });

  it("does not let a warning or an info finding block a filing", () => {
    const result = build([
      candidate({
        findings: [
          findingState({ id: "f1", severity: "warning" }),
          findingState({ id: "f2", severity: "info" }),
        ],
      }),
    ]);
    expect(result.kind).toBe("releasable");
  });

  /**
   * The manifest used to carry its own two-field copy of a finding with no
   * `tier`, and tested `severity === "critical"` itself. A provider finding
   * recorded as critical would have blocked a filing -- the one thing a provider
   * tier must never be able to do, since it reads text an uploader controls and
   * stalling a client's filing is a denial of service against that client.
   */
  it("does not let a provider finding block a filing, however severe it claims to be", () => {
    const result = build([
      candidate({
        findings: [findingState({ id: "f1", severity: "critical", tier: "provider" })],
      }),
    ]);
    expect(result.kind).toBe("releasable");
  });

  it("reports every blocker rather than only the first", () => {
    const result = build([
      candidate({ decision: null, version: version({ verifiedChecksum: null }) }),
      candidate({ version: null }),
    ]);
    expect(result.kind).toBe("blocked");
    if (result.kind !== "blocked") return;
    expect(result.blockers.map((blocker) => blocker.kind).sort()).toEqual([
      "evidence-unverifiable",
      "missing-human-decision",
      "requirement-outstanding",
    ]);
  });

  it("names the person a requirement is incomplete for", () => {
    const result = build([
      candidate({
        version: null,
        requirement: requirement({
          requirementKey: "身分證明文件",
          partyName: "李小明",
          partyId: "p2",
        }),
      }),
    ]);
    expect(result).toMatchObject({
      kind: "blocked",
      blockers: [{ requirement: "身分證明文件（李小明）" }],
    });
  });

  it("records the verified hash and the version, not the document alone", () => {
    const cited = version();
    const result = build([candidate({ version: cited, pageFrom: 1, pageTo: 2 })]);
    if (result.kind !== "releasable") throw new Error("expected a releasable manifest");

    expect(result.manifest.entries[0]).toMatchObject({
      documentVersionId: cited.id,
      documentId: cited.documentId,
      contentSha256: VERIFIED_HASH,
      pageFrom: 1,
      pageTo: 2,
      decidedByUserId: REVIEWER,
    });
  });
});

describe("canonicalManifestPayload", () => {
  function manifestWith(entryIds: string[]): PackageManifest {
    return {
      caseId: "case-1",
      returnYear: 2026,
      requirementTemplateVersion: "annual-return-v1",
      entries: entryIds.map((id) => ({
        requirementInstanceId: id,
        requirementKey: "NAR1",
        partyId: null,
        documentId: `doc-${id}`,
        documentVersionId: `ver-${id}`,
        contentSha256: VERIFIED_HASH,
        pageFrom: null,
        pageTo: null,
        decidedByUserId: REVIEWER,
        decidedAt: "2026-09-10T02:00:00.000Z",
      })),
    };
  }

  // Row order is a query detail. If it changed the payload, the same approval
  // would hash differently on a re-read and read as tampering.
  it("does not depend on the order the entries arrive in", () => {
    expect(canonicalManifestPayload(manifestWith(["a", "b"]))).toBe(
      canonicalManifestPayload(manifestWith(["b", "a"])),
    );
  });

  it("changes when the cited bytes change", () => {
    const before = manifestWith(["a"]);
    const after: PackageManifest = {
      ...before,
      entries: [{ ...before.entries[0], contentSha256: "c".repeat(64) }],
    };
    expect(canonicalManifestPayload(after)).not.toBe(canonicalManifestPayload(before));
  });

  it("changes when the cited version changes even though the document does not", () => {
    const before = manifestWith(["a"]);
    const after: PackageManifest = {
      ...before,
      entries: [{ ...before.entries[0], documentVersionId: "ver-a-2" }],
    };
    expect(canonicalManifestPayload(after)).not.toBe(canonicalManifestPayload(before));
  });

  it("changes when the rule set that produced the requirements changes", () => {
    const before = manifestWith(["a"]);
    expect(
      canonicalManifestPayload({ ...before, requirementTemplateVersion: "annual-return-v2" }),
    ).not.toBe(canonicalManifestPayload(before));
  });

  it("changes when a different person approves", () => {
    const before = manifestWith(["a"]);
    const after: PackageManifest = {
      ...before,
      entries: [{ ...before.entries[0], decidedByUserId: "someone-else" }],
    };
    expect(canonicalManifestPayload(after)).not.toBe(canonicalManifestPayload(before));
  });
});
