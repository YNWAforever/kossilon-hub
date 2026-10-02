import { describe, expect, it } from "vitest";
import {
  canCiteInManifest,
  contentIdentityOf,
  currentVersion,
  nextVersionNumber,
  supersessionIssues,
  versionHistory,
  type DocumentVersionState,
} from "./versions";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function version(overrides: Partial<DocumentVersionState> = {}): DocumentVersionState {
  return {
    id: "v1",
    documentId: "doc-1",
    versionNumber: 1,
    declaredChecksum: HASH_A,
    verifiedChecksum: null,
    supersededByVersionId: null,
    ...overrides,
  };
}

describe("contentIdentityOf", () => {
  it("is verified only when the stored bytes were hashed", () => {
    expect(contentIdentityOf(version({ verifiedChecksum: HASH_B }))).toEqual({
      kind: "verified",
      checksum: HASH_B,
    });
  });

  // The distinction the whole model exists for. The intent checksum is supplied
  // by the client before the bytes exist and is never checked against storage by
  // any enabled code path.
  it("does not treat the client's declared checksum as an identity", () => {
    expect(contentIdentityOf(version()).kind).toBe("declared-only");
  });

  it("is unknown when nothing was ever recorded", () => {
    expect(contentIdentityOf(version({ declaredChecksum: null })).kind).toBe("unknown");
  });

  it("prefers the verified hash when the declared one disagrees with it", () => {
    const identity = contentIdentityOf(
      version({ declaredChecksum: HASH_A, verifiedChecksum: HASH_B }),
    );
    expect(identity).toEqual({ kind: "verified", checksum: HASH_B });
  });
});

describe("canCiteInManifest", () => {
  it("refuses a superseded version even when its historical bytes were verified", () => {
    expect(
      canCiteInManifest(version({ verifiedChecksum: HASH_A, supersededByVersionId: "v2" })),
    ).toBe(false);
  });
  it("accepts a version whose stored bytes were hashed", () => {
    expect(canCiteInManifest(version({ verifiedChecksum: HASH_B }))).toBe(true);
  });

  // Same gate Phase A applies to approval, from the same blocked provider: a
  // manifest hash over a client-declared value certifies nothing.
  it("refuses a version that only carries the uploader's claim", () => {
    expect(canCiteInManifest(version())).toBe(false);
    expect(canCiteInManifest(version({ declaredChecksum: null }))).toBe(false);
  });
});

describe("currentVersion", () => {
  it("finds the one version nothing supersedes", () => {
    const superseded = version({ id: "v1", supersededByVersionId: "v2" });
    const live = version({ id: "v2", versionNumber: 2 });
    expect(currentVersion([superseded, live])).toEqual({ kind: "one", version: live });
  });

  it("reports none rather than inventing one", () => {
    expect(currentVersion([]).kind).toBe("none");
    expect(currentVersion([version({ supersededByVersionId: "v2" })]).kind).toBe("none");
  });

  // The partial unique index makes this unreachable in a consistent database,
  // which is why picking the highest number would be the wrong recovery: it
  // would silently attach a reviewer's decision to bytes nobody selected.
  it("refuses to choose between two versions that both claim to be current", () => {
    const result = currentVersion([version({ id: "v1" }), version({ id: "v2", versionNumber: 2 })]);
    expect(result.kind).toBe("ambiguous");
  });
});

describe("versionHistory", () => {
  it("reads newest first", () => {
    const ordered = versionHistory([
      version({ id: "v1", versionNumber: 1 }),
      version({ id: "v3", versionNumber: 3 }),
      version({ id: "v2", versionNumber: 2 }),
    ]);
    expect(ordered.map((entry) => entry.id)).toEqual(["v3", "v2", "v1"]);
  });

  it("does not mutate its input", () => {
    const input = [
      version({ id: "v1", versionNumber: 1 }),
      version({ id: "v2", versionNumber: 2 }),
    ];
    versionHistory(input);
    expect(input.map((entry) => entry.id)).toEqual(["v1", "v2"]);
  });
});

describe("nextVersionNumber", () => {
  it("starts at 1 for a document with no versions", () => {
    expect(nextVersionNumber([])).toBe(1);
  });

  // Max plus one, not count plus one: a removed row must not let a later upload
  // reuse a number an existing decision already refers to.
  it("does not reuse a number after a gap in the sequence", () => {
    expect(nextVersionNumber([version({ versionNumber: 1 }), version({ versionNumber: 5 })])).toBe(
      6,
    );
  });
});

describe("supersessionIssues", () => {
  it("is silent on a sound chain", () => {
    expect(
      supersessionIssues([
        version({ id: "v1", versionNumber: 1, supersededByVersionId: "v2" }),
        version({ id: "v2", versionNumber: 2, supersededByVersionId: "v3" }),
        version({ id: "v3", versionNumber: 3 }),
      ]),
    ).toEqual([]);
  });

  it("reports two live versions", () => {
    const issues = supersessionIssues([version({ id: "v1" }), version({ id: "v2" })]);
    expect(issues).toEqual([{ kind: "multiple-current", versionIds: ["v1", "v2"] }]);
  });

  it("reports a successor that is not in the set", () => {
    const issues = supersessionIssues([version({ id: "v1", supersededByVersionId: "gone" })]);
    expect(issues).toContainEqual({
      kind: "dangling-successor",
      versionId: "v1",
      missingId: "gone",
    });
  });

  it("reports a replacement that is older than what it replaces", () => {
    const issues = supersessionIssues([
      version({ id: "v2", versionNumber: 2, supersededByVersionId: "v1" }),
      version({ id: "v1", versionNumber: 1 }),
    ]);
    expect(issues).toContainEqual({
      kind: "successor-not-newer",
      versionId: "v2",
      successorId: "v1",
    });
  });

  it("reports a cycle once rather than once per member", () => {
    const issues = supersessionIssues([
      version({ id: "v1", versionNumber: 1, supersededByVersionId: "v2" }),
      version({ id: "v2", versionNumber: 2, supersededByVersionId: "v1" }),
    ]);
    expect(issues.filter((issue) => issue.kind === "cycle")).toHaveLength(1);
  });

  it("terminates on a version that supersedes itself", () => {
    const issues = supersessionIssues([version({ id: "v1", supersededByVersionId: "v1" })]);
    expect(issues.some((issue) => issue.kind === "cycle")).toBe(true);
  });
});
