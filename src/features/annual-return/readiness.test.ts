import { describe, expect, it } from "vitest";
import { evaluateCaseReadiness, type CaseReadinessSnapshot } from "./readiness";

const BASE: CaseReadinessSnapshot = {
  caseId: "40000000-0000-0000-0000-000000000002",
  revision: 7,
  asOf: "2026-09-27T00:00:00.000Z",
  currentStatus: "NAR1 prepared",
  caseLocked: false,
  requiredEvidenceState: "confirmed",
  paymentEvidenceState: "confirmed",
  manifestResult: {
    kind: "releasable",
    manifest: {
      caseId: "40000000-0000-0000-0000-000000000002",
      returnYear: 2026,
      requirementTemplateVersion: "v1",
      entries: [],
    },
  },
  currentManifestHash: "hash-7",
  approval: { manifestHash: "hash-7", approverId: "reviewer-1" },
  submission: { id: "submission-1", reference: "NAR-1", verifiedAt: "2026-09-27T00:00:00.000Z" },
  returnReconciliation: {
    id: "return-1",
    status: "matched",
    outcome: "accepted",
    decision: "confirm",
    verifiedAt: "2026-09-27T00:00:00.000Z",
  },
  completionBlockers: [],
};

describe("evaluateCaseReadiness", () => {
  it("t03_scenario_1 separates document completion from payment and submission", () => {
    const result = evaluateCaseReadiness({
      ...BASE,
      paymentEvidenceState: "outstanding",
      approval: null,
      submission: null,
      returnReconciliation: null,
    });
    expect(result.documentsComplete).toBe(true);
    expect(result.paymentConfirmed).toBe(false);
    expect(result.canApprovePackage).toBe(false);
    expect(result.canRecordSubmission).toBe(false);
    expect(result.canComplete).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "payment-unconfirmed", targetId: BASE.caseId }),
      ]),
    );
    expect(result.snapshotRevision).toBe(7);
  });

  it("t03_scenario_2 blocks unknown evidence and a superseded document", () => {
    const unknown = evaluateCaseReadiness({ ...BASE, requiredEvidenceState: "unknown" });
    expect(unknown.documentsComplete).toBe(false);
    expect(unknown.canRecordSubmission).toBe(false);
    expect(unknown.blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "unknown-data" })]),
    );
    const unreadablePaymentProof = evaluateCaseReadiness({
      ...BASE,
      paymentEvidenceState: "unknown",
    });
    expect(unreadablePaymentProof.paymentConfirmed).toBe(false);
    expect(unreadablePaymentProof.canRecordSubmission).toBe(false);
    expect(unreadablePaymentProof.blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "unknown-data" })]),
    );

    const superseded = evaluateCaseReadiness({
      ...BASE,
      manifestResult: {
        kind: "blocked",
        blockers: [
          {
            kind: "evidence-superseded",
            requirement: "director-id",
            documentVersionId: "version-old",
          },
        ],
      },
    });
    expect(superseded.documentsComplete).toBe(true);
    expect(superseded.canApprovePackage).toBe(false);
    expect(superseded.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "stale-version", targetId: "version-old" }),
      ]),
    );
  });

  it("requires the current manifest approval, verified submission, and matched return in order", () => {
    expect(evaluateCaseReadiness(BASE)).toMatchObject({
      documentsComplete: true,
      paymentConfirmed: true,
      canApprovePackage: true,
      canRecordSubmission: false,
      canComplete: true,
    });
    const beforeSubmission = evaluateCaseReadiness({
      ...BASE,
      submission: null,
      returnReconciliation: null,
    });
    expect(beforeSubmission.canRecordSubmission).toBe(true);
    expect(beforeSubmission.canComplete).toBe(false);
    const filed = evaluateCaseReadiness({ ...BASE, currentStatus: "Filed" });
    expect(filed.canApprovePackage).toBe(false);
    expect(filed.canRecordSubmission).toBe(false);
    expect(filed.canComplete).toBe(true);
    const changed = evaluateCaseReadiness({
      ...BASE,
      approval: { manifestHash: "hash-old", approverId: "reviewer-1" },
    });
    expect(changed.canRecordSubmission).toBe(false);
    expect(changed.blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "manifest-changed" })]),
    );
    const unresolved = evaluateCaseReadiness({
      ...BASE,
      returnReconciliation: { ...BASE.returnReconciliation!, status: "exception" },
    });
    expect(unresolved.canRecordSubmission).toBe(false);
    expect(unresolved.canComplete).toBe(false);
    expect(unresolved.blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "return-unresolved" })]),
    );
  });

  it("t03_review requires an accepted and confirmed return before completion", () => {
    const rejectedReturn = {
      ...BASE.returnReconciliation!,
      outcome: "rejected" as const,
      decision: "confirm" as const,
    };
    const rejected = evaluateCaseReadiness({
      ...BASE,
      returnReconciliation: rejectedReturn,
    });
    expect(rejected.canComplete).toBe(false);
    expect(rejected.blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "return-unresolved" })]),
    );

    const unconfirmedReturn = {
      ...BASE.returnReconciliation!,
      outcome: "accepted" as const,
      decision: "mark-unmatched" as const,
    };
    const unconfirmed = evaluateCaseReadiness({
      ...BASE,
      returnReconciliation: unconfirmedReturn,
    });
    expect(unconfirmed.canComplete).toBe(false);
    expect(unconfirmed.blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "return-unresolved" })]),
    );
  });

  it("t03_active_handoff never offers a second external submission", () => {
    const result = evaluateCaseReadiness({
      ...BASE,
      submission: null,
      returnReconciliation: null,
      activeHandoffId: "handoff-in-progress",
    });
    expect(result.canRecordSubmission).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "case-locked", targetId: "handoff-in-progress" }),
      ]),
    );
  });
});
