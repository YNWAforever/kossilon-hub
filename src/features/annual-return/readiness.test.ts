import { describe, expect, it } from "vitest";
import { computeReadiness, type ReadinessInput, type ReadinessDocument } from "./readiness";
import type { AnnualReturnCase } from "./types";

function input(): ReadinessInput {
  const case_ = {
    id: "case",
    returnYear: 2026,
    companyId: "company",
    currentStatus: "Payment received",
    lockedAt: null,
    completedAt: null,
    checklist: [
      {
        id: "item",
        itemLabel: "CDD",
        required: true,
        status: "Verified",
        documentId: "doc",
        receivedAt: "2026-09-01",
        verifiedAt: "2026-09-02",
      },
    ],
    payment: { status: "Payment received", paidAt: "2026-09-02", paymentProofDocumentId: "proof" },
  } as AnnualReturnCase;
  const doc: ReadinessDocument = {
    id: "doc",
    companyId: "company",
    caseId: "case",
    category: "registry",
    reviewStatus: "verified" as const,
    reviewedBy: "reviewer",
    reviewedAt: "2026-09-02T00:00:00Z",
    versionCreatedAt: "2026-09-01T00:00:00Z",
    uploadStatus: "available",
    scanVerdictSource: "provider",
    currentSourceMatches: true,
    version: {
      id: "v1",
      documentId: "doc",
      versionNumber: 1,
      declaredChecksum: "a".repeat(64),
      verifiedChecksum: "a".repeat(64),
      supersededByVersionId: null,
    },
  };
  return {
    case_,
    sourceVersion: "a".repeat(32),
    partiesKnown: true,
    destinationConfigured: false,
    approvedPayload: null,
    documents: [
      doc,
      {
        ...doc,
        id: "proof",
        category: "payment",
        version: { ...doc.version!, id: "pv1", documentId: "proof" },
      },
    ],
    requirements: [
      {
        instance: {
          id: "r1",
          checklistItemId: "item",
          partyId: null,
          partyName: null,
          requirementKey: "cdd",
          applicability: "required",
          evidence: [],
        },
        templateVersion: "v1",
        authorizedBy: null,
        documentIds: ["doc"],
      },
    ],
    findings: [],
  };
}

const codes = (value: ReadinessInput) =>
  computeReadiness(value).blockers.map((blocker) => blocker.code);

describe("stage-specific current evidence readiness", () => {
  it("respects attributable not-applicable decisions without fabricating a file", () => {
    const value = input();
    const requirement = value.requirements[0];
    requirement.instance.applicability = "not_applicable";
    requirement.instance.applicabilityReason = "Confirmed company requirement exclusion";
    requirement.authorizedBy = "reviewer";
    requirement.decisionAt = "2026-09-02T00:00:00Z";
    requirement.documentIds = [];
    value.case_.checklist[0].status = "Missing";
    value.case_.checklist[0].documentId = null;
    expect(computeReadiness(value).readyToPrepare).toBe(true);
    expect(computeReadiness(value).readyForApproval).toBe(true);
  });
  it("binds payment evidence identity to the approved package, including a replaced proof", () => {
    const value = input();
    value.destinationConfigured = true;
    value.approvedPayload = computeReadiness(value).manifestPayload;
    value.documents[1].version!.id = "proof-v2";
    expect(computeReadiness(value).readyToTransmit).toBe(false);
    expect(codes(value)).toContain("package_approval_stale");
  });
  it("does not prepare while a second party evidence is received but awaits internal review", () => {
    const value = input();
    value.requirements.push({
      ...value.requirements[0],
      instance: {
        ...value.requirements[0].instance,
        id: "r2",
        partyId: "party2",
        partyName: "Second director",
      },
      documentIds: ["received"],
    });
    value.documents.push({
      ...value.documents[0],
      id: "received",
      reviewStatus: "pending",
      reviewedAt: null,
      reviewedBy: null,
    });
    expect(computeReadiness(value).readyToPrepare).toBe(false);
    expect(codes(value)).toContain("internal_review_pending");
  });
  it("holds a payment proof with unresolved deterministic critical finding", () => {
    const value = input();
    value.findings = [
      {
        id: "finding",
        resolvedByUserId: null,
        resolvedAt: null,
        finding: {
          ruleKey: "proof",
          ruleVersion: "1",
          tier: "cross-check",
          outcome: "issue",
          severity: "critical",
          detail: "Contradictory receipt identity",
          citation: { kind: "version", documentVersionId: "pv1", pageFrom: null, pageTo: null },
        },
      },
    ];
    expect(computeReadiness(value).readyToPrepare).toBe(false);
  });
  it("allows preparation/approval with actual evidence but no claim of transmission or receipt", () => {
    const snapshot = computeReadiness(input());
    expect(snapshot.readyToPrepare).toBe(true);
    expect(snapshot.readyForApproval).toBe(true);
    expect(snapshot.readyToTransmit).toBe(false);
    expect(snapshot.blockers.filter((b) => b.stage === "prepare")).toEqual([]);
    expect(snapshot.blockers.map((b) => b.code)).not.toContain("filing_reference_missing");
    expect(snapshot.blockers.map((b) => b.code)).toContain("package_not_approved");
  });
  it("excludes a Kowloon-style documents-complete but unpaid case", () => {
    const value = input();
    value.case_.payment!.status = "Payment pending";
    const snapshot = computeReadiness(value);
    expect(snapshot.readyToPrepare).toBe(false);
    expect(snapshot.readyForApproval).toBe(false);
    expect(codes(value)).toContain("payment_not_received");
    expect(snapshot.blockers.find((b) => b.code === "payment_not_received")?.action).toContain(
      "payments",
    );
  });
  it.each(["quarantined", "rejected", "created"] as const)(
    "refuses unsafe/unknown proof: %s",
    (status) => {
      const value = input();
      value.documents[1].uploadStatus = status;
      expect(codes(value)).toContain("payment_proof_unverified");
    },
  );
  it("refuses verified business records with no current version/source or human decision", () => {
    const value = input();
    value.documents[0].version = null;
    expect(codes(value)).toContain("required_evidence_unverified");
    value.documents[0].version = input().documents[0].version;
    value.documents[0].reviewedBy = null;
    expect(computeReadiness(value).readyForApproval).toBe(false);
  });
  it("keeps Received on the internal review stage and never labels it client missing", () => {
    const value = input();
    value.case_.checklist[0].status = "Received";
    expect(codes(value)).toContain("internal_review_pending");
    expect(codes(value)).not.toContain("required_document_missing");
  });
  it("refuses unknown party/applicability and unauthorized waivers", () => {
    const value = input();
    value.partiesKnown = false;
    expect(codes(value)).toContain("party_applicability_unknown");
    value.partiesKnown = true;
    value.requirements[0].instance.applicability = "waived";
    expect(codes(value)).toContain("applicability_not_authorized");
  });
  it("does not inherit a V1 review when V2 is current", () => {
    const value = input();
    value.documents[0].versionCreatedAt = "2026-09-03T00:00:00Z";
    expect(codes(value)).toContain("required_evidence_unverified");
  });
  it("requires approval over the current canonical manifest, never a stale hash", () => {
    const value = input();
    value.destinationConfigured = true;
    value.approvedPayload = computeReadiness(value).manifestPayload;
    expect(computeReadiness(value).readyToTransmit).toBe(true);
    value.documents[0].version!.id = "v2";
    expect(codes(value)).toContain("package_approval_stale");
    expect(computeReadiness(value).readyToTransmit).toBe(false);
  });
  it.each(["Filed", "Completed"] as const)("never advertises a %s case ready", (currentStatus) => {
    const value = input();
    value.case_.currentStatus = currentStatus;
    expect(computeReadiness(value).readyToPrepare).toBe(false);
    expect(codes(value)).toContain("case_closed_or_locked");
  });
  it("never advertises a locked case ready or an unknown evidence set complete", () => {
    const value = input();
    value.case_.lockedAt = "2026-09-02";
    expect(computeReadiness(value).readyToPrepare).toBe(false);
    value.case_.lockedAt = null;
    value.requirements = [];
    expect(codes(value)).toContain("requirements_unknown");
  });
});
