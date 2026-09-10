import { describe, expect, it } from "vitest";
import {
  describeRequirement,
  outstandingRequirementsForClient,
  requirementStatusOf,
  requirementsAwaitingUs,
  summarizeRequirements,
  type RequirementEvidenceState,
  type RequirementInstanceState,
} from "./requirements";

let counter = 0;

function instance(overrides: Partial<RequirementInstanceState> = {}): RequirementInstanceState {
  counter += 1;
  return {
    id: `req-${counter}`,
    checklistItemId: "item-1",
    partyId: null,
    partyName: null,
    requirementKey: "身分證明文件",
    applicability: "required",
    evidence: [],
    ...overrides,
  };
}

const verified: RequirementEvidenceState = {
  documentId: "doc-verified",
  reviewStatus: "verified",
  safety: "verified",
};
const pendingReview: RequirementEvidenceState = {
  documentId: "doc-pending",
  reviewStatus: "pending",
  safety: "verified",
};
const quarantined: RequirementEvidenceState = {
  documentId: "doc-quarantined",
  reviewStatus: "pending",
  safety: "pending",
};
const rejected: RequirementEvidenceState = {
  documentId: "doc-rejected",
  reviewStatus: "rejected",
  safety: "verified",
};
const unverifiableScan: RequirementEvidenceState = {
  documentId: "doc-legacy",
  reviewStatus: "verified",
  safety: "unknown",
};

describe("requirementStatusOf", () => {
  it("is satisfied only when a real scan and a reviewer both agree", () => {
    expect(requirementStatusOf(instance({ evidence: [verified] }))).toBe("satisfied");
  });

  // The Phase A rule, carried through: an approval recorded against bytes whose
  // only clean verdict came from the fixture scanner does not close anything.
  it("is not satisfied by an approval over unverifiable bytes", () => {
    expect(requirementStatusOf(instance({ evidence: [unverifiableScan] }))).not.toBe("satisfied");
  });

  it("is our work while evidence sits unreviewed", () => {
    expect(requirementStatusOf(instance({ evidence: [pendingReview] }))).toBe("awaiting_review");
  });

  it("distinguishes waiting on a reviewer from waiting on the scanner", () => {
    expect(requirementStatusOf(instance({ evidence: [quarantined] }))).toBe("awaiting_scan");
  });

  it("is outstanding when the only evidence was rejected", () => {
    expect(requirementStatusOf(instance({ evidence: [rejected] }))).toBe("outstanding");
  });

  it("is outstanding when nothing has arrived", () => {
    expect(requirementStatusOf(instance())).toBe("outstanding");
  });

  it("is resolved when somebody decided it does not apply", () => {
    expect(
      requirementStatusOf(
        instance({ applicability: "not_applicable", applicabilityReason: "Sole director." }),
      ),
    ).toBe("resolved_without_evidence");
    expect(
      requirementStatusOf(
        instance({ applicability: "waived", applicabilityReason: "Approved by the partner." }),
      ),
    ).toBe("resolved_without_evidence");
  });

  it("takes the best evidence when several documents are linked", () => {
    expect(requirementStatusOf(instance({ evidence: [rejected, verified] }))).toBe("satisfied");
    expect(requirementStatusOf(instance({ evidence: [rejected, pendingReview] }))).toBe(
      "awaiting_review",
    );
  });
});

describe("the scenarios the old checklist could not express", () => {
  // The plan's first example. One row with one document_id held a document, so
  // the requirement looked answered; two instances can say whose is missing.
  it("keeps a two-director identity requirement incomplete when only one ID arrived", () => {
    const instances = [
      instance({ partyId: "p1", partyName: "陳大文", evidence: [verified] }),
      instance({ partyId: "p2", partyName: "李小明", evidence: [] }),
    ];

    const summary = summarizeRequirements(instances);
    expect(summary.satisfied).toBe(1);
    expect(summary.outstanding).toBe(1);
    expect(summary.complete).toBe(false);

    const outstanding = outstandingRequirementsForClient(instances);
    expect(outstanding).toHaveLength(1);
    // Actionable because it names the person, which is the whole point.
    expect(describeRequirement(outstanding[0])).toBe("身分證明文件（李小明）");
  });

  // The plan's second example: five files, duplicates among them, and no CDD.
  it("stays incomplete when plenty of files arrive but one requirement has none", () => {
    const duplicates = [verified, { ...verified, documentId: "doc-verified-copy" }];
    const instances = [
      instance({ requirementKey: "身分證明文件", partyName: "陳大文", evidence: duplicates }),
      instance({ requirementKey: "身分證明文件", partyName: "李小明", evidence: duplicates }),
      instance({ requirementKey: "地址證明", partyName: "陳大文", evidence: [verified] }),
      instance({ requirementKey: "CDD", evidence: [] }),
    ];

    const summary = summarizeRequirements(instances);
    expect(summary.complete).toBe(false);
    expect(outstandingRequirementsForClient(instances).map(describeRequirement)).toEqual(["CDD"]);
  });

  // A single PDF answering two requirements from different page ranges.
  it("lets one document answer two requirements through separate links", () => {
    const shared = {
      documentId: "doc-combined",
      reviewStatus: "verified",
      safety: "verified",
    } as const;
    const instances = [
      instance({ requirementKey: "NAR1", evidence: [{ ...shared, pageFrom: 1, pageTo: 2 }] }),
      instance({ requirementKey: "AGM", evidence: [{ ...shared, pageFrom: 3, pageTo: 4 }] }),
    ];
    expect(summarizeRequirements(instances).complete).toBe(true);
  });
});

describe("summarizeRequirements", () => {
  // A filing built on evidence nobody has checked is the failure this model
  // exists to prevent, so arrived-but-unreviewed is not "done".
  it("does not call a case complete while anything is unreviewed or unscanned", () => {
    expect(summarizeRequirements([instance({ evidence: [pendingReview] })]).complete).toBe(false);
    expect(summarizeRequirements([instance({ evidence: [quarantined] })]).complete).toBe(false);
  });

  it("is complete when everything is either satisfied or deliberately resolved", () => {
    const summary = summarizeRequirements([
      instance({ evidence: [verified] }),
      instance({ applicability: "waived", applicabilityReason: "Approved." }),
    ]);
    expect(summary).toMatchObject({ satisfied: 1, resolvedWithoutEvidence: 1, complete: true });
  });

  it("is complete for a case with no requirements at all", () => {
    expect(summarizeRequirements([])).toMatchObject({ total: 0, complete: true });
  });
});

describe("requirementsAwaitingUs", () => {
  it("collects exactly what has arrived and is not yet actionable", () => {
    const instances = [
      instance({ evidence: [verified] }),
      instance({ evidence: [pendingReview] }),
      instance({ evidence: [quarantined] }),
      instance({ evidence: [] }),
    ];
    expect(requirementsAwaitingUs(instances)).toHaveLength(2);
    // And none of those is something to chase the client about.
    expect(outstandingRequirementsForClient(instances)).toHaveLength(1);
  });
});
