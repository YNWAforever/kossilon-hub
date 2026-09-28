import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  buildPackageManifest,
  canonicalManifestPayload,
  type ManifestCandidateEntry,
  type PackageManifest,
} from "./package-manifest";
import { createProductionCaseActions } from "./components/production-case-actions";
import { downloadApprovedPackageForActor } from "./package-service";

const caseId = "11111111-1111-4111-8111-111111111111";
const reviewerId = "22222222-2222-4222-8222-222222222222";
const versionId = "33333333-3333-4333-8333-333333333333";
const digest = (manifest: PackageManifest) =>
  createHash("sha256").update(canonicalManifestPayload(manifest)).digest("hex");

function candidate(): ManifestCandidateEntry {
  return {
    requirement: {
      id: "44444444-4444-4444-8444-444444444444",
      checklistItemId: "55555555-5555-4555-8555-555555555555",
      partyId: null,
      partyName: null,
      requirementKey: "Signed NAR1",
      applicability: "required",
      evidence: [],
    },
    version: {
      id: versionId,
      documentId: "66666666-6666-4666-8666-666666666666",
      versionNumber: 1,
      declaredChecksum: "a".repeat(64),
      verifiedChecksum: "a".repeat(64),
      supersededByVersionId: null,
    },
    safety: "verified",
    pageFrom: 1,
    pageTo: 2,
    decision: {
      decidedByUserId: reviewerId,
      decision: "approve",
      decidedAt: "2026-09-27T00:00:00.000Z",
      reason: null,
    },
    findings: [],
  };
}

describe("T14 package approval", () => {
  it("t14_scenario_1 invalidates an approval hash after document, payment or requirement changes", () => {
    const base = buildPackageManifest({
      caseId,
      returnYear: 2026,
      requirementTemplateVersion: "annual-return-v1",
      entries: [candidate()],
    });
    expect(base.kind).toBe("releasable");
    if (base.kind !== "releasable") return;
    const paid = {
      ...base.manifest,
      payment: { status: "Payment received", allocationId: "77777777-7777-4777-8777-777777777777" },
    } as PackageManifest;
    const revoked = {
      ...base.manifest,
      payment: { status: "Payment pending", allocationId: null },
    } as PackageManifest;
    expect(digest(paid)).not.toBe(digest(revoked));
    const replaced = {
      ...paid,
      entries: [{ ...paid.entries[0], documentVersionId: "88888888-8888-4888-8888-888888888888" }],
    };
    expect(digest(paid)).not.toBe(digest(replaced));
    const newRequirement = {
      ...paid,
      entries: [
        ...paid.entries,
        { ...paid.entries[0], requirementInstanceId: "99999999-9999-4999-8999-999999999999" },
      ],
    };
    expect(digest(paid)).not.toBe(digest(newRequirement));
    const changedRule = {
      ...paid,
      entries: [
        {
          ...paid.entries[0],
          applicability: "waived" as const,
          applicabilityReason: "Human-approved waiver",
        },
      ],
    };
    expect(digest(paid)).not.toBe(digest(changedRule));
    const changedDecision = {
      ...paid,
      entries: [{ ...paid.entries[0], decisionReason: "New review rationale" }],
    };
    expect(digest(paid)).not.toBe(digest(changedDecision));
  });

  it("t14_scenario_2 refuses a package without genuinely safe evidence and a human decision", () => {
    const unscanned = { ...candidate(), safety: "unknown" } as ManifestCandidateEntry;
    expect(
      buildPackageManifest({
        caseId,
        returnYear: 2026,
        requirementTemplateVersion: "annual-return-v1",
        entries: [unscanned],
      }).kind,
    ).toBe("blocked");
    expect(
      buildPackageManifest({
        caseId,
        returnYear: 2026,
        requirementTemplateVersion: "annual-return-v1",
        entries: [{ ...candidate(), decision: null }],
      }).kind,
    ).toBe("blocked");
  });

  it("t14_scenario_3 rejects a Client before looking up package identity", async () => {
    const sql = vi.fn();
    await expect(
      downloadApprovedPackageForActor(
        {
          authUserId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          userId: null,
          role: "Client",
          teamId: null,
          active: true,
        },
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        {
          sql: sql as never,
          storage: {} as never,
        },
      ),
    ).rejects.toThrow(/staff/i);
    expect(sql).not.toHaveBeenCalled();
  });

  it("t14_scenario_2 cannot make a case appear prepared merely by clicking the old Submit packet action", async () => {
    const updateStatus = vi.fn(async () => undefined);
    const actions = createProductionCaseActions(caseId, {
      updateStatus,
    } as never);
    expect("submitPacket" in actions).toBe(false);
    expect(updateStatus).not.toHaveBeenCalled();
  });
});
