import { describe, expect, it } from "vitest";

import {
  canSendFollowUp,
  getAnnualReturnCaseById,
  getBlockers,
  getCaseMetrics,
  getCaseTasks,
  getFollowUpDrafts,
  getNextAction,
  getPacketBlockers,
  getPacketReadiness,
  getPacketStatus,
  getReadinessScore,
  getRiskLevel,
  resetAnnualReturnCasesForTest,
  type AnnualReturnCase,
} from "./annual-return-store";

const baseCase: AnnualReturnCase = {
  id: "ar-test",
  clientId: "c-test",
  enquiryId: "wa-test",
  companyName: "Test Company Limited",
  contactName: "Ada Staff",
  phone: "+852 6000 0000",
  owner: "Iris Wong",
  basisDate: "2026-06-01",
  dueDate: "2026-07-13",
  status: "waiting-documents",
  documents: [
    { id: "signed-nar1", label: "Signed NAR1", received: false, required: true },
    { id: "scr", label: "Updated significant controller register", received: true, required: true },
  ],
  checklist: [
    { id: "confirm-particulars", label: "Confirm company particulars", complete: true },
    { id: "submit-registry", label: "Submit to Companies Registry", complete: false },
  ],
  signatureStatus: "missing",
  paymentStatus: "pending",
  reviewStatus: "not-started",
  packetRequirements: [
    { id: "nar1-draft", label: "NAR1 draft prepared", complete: false, required: true },
    {
      id: "company-particulars",
      label: "Company particulars checked",
      complete: false,
      required: true,
    },
    {
      id: "scr-confirmed",
      label: "Significant controller register confirmed",
      complete: false,
      required: true,
    },
    { id: "signed-nar1-attached", label: "Signed NAR1 attached", complete: false, required: true },
    {
      id: "payment-proof-checked",
      label: "Payment proof checked",
      complete: false,
      required: true,
    },
    {
      id: "internal-filing-review",
      label: "Internal filing review approved",
      complete: false,
      required: true,
    },
  ],
  sentFollowUpIds: [],
  sentFollowUps: [],
  notes: [],
  timeline: [],
};

describe("annual return derived helpers", () => {
  it("prioritizes overdue risk before blocker risk", () => {
    expect(getRiskLevel(baseCase, new Date("2026-07-20T00:00:00"))).toBe("overdue");
  });

  it("calculates readiness from documents, payment, signatures, checklist, and review", () => {
    expect(getReadinessScore(baseCase)).toBe(0);
  });

  it("normalizes blockers across documents, payment, signatures, and review", () => {
    expect(getBlockers(baseCase).map((blocker) => blocker.label)).toEqual([
      "Signed NAR1",
      "Payment pending",
      "Signature missing",
      "Internal review not started",
    ]);
  });

  it("selects the most useful next action", () => {
    expect(getNextAction(baseCase, new Date("2026-07-07T00:00:00"))).toBe("Request Signed NAR1");
  });

  it("aggregates command center metrics", () => {
    const metrics = getCaseMetrics([baseCase], new Date("2026-07-20T00:00:00"));
    expect(metrics).toEqual({ overdue: 1, dueSoon: 0, blocked: 1, readyToFile: 0, filed: 0 });
  });

  it("derives task rows from blockers", () => {
    expect(getCaseTasks(baseCase, new Date("2026-07-07T00:00:00"))[0]).toMatchObject({
      caseId: "ar-test",
      companyName: "Test Company Limited",
      owner: "Iris Wong",
      title: "Request Signed NAR1",
    });
  });

  it("omits filed cases from task rows", () => {
    expect(
      getCaseTasks(
        {
          ...baseCase,
          status: "filed",
          documents: baseCase.documents.map((document) => ({ ...document, received: true })),
          checklist: baseCase.checklist.map((item) => ({ ...item, complete: true })),
          signatureStatus: "received",
          paymentStatus: "paid",
          reviewStatus: "approved",
        },
        new Date("2026-07-07T00:00:00"),
      ),
    ).toEqual([]);
  });

  it("seeds at least one genuinely ready-to-file case", () => {
    resetAnnualReturnCasesForTest();
    const harbourCase = getAnnualReturnCaseById("ar-harbour");

    expect(harbourCase).toBeDefined();
    expect(harbourCase?.status).toBe("ready-to-file");
    expect(harbourCase && getReadinessScore(harbourCase)).toBe(100);
    expect(
      harbourCase && getCaseMetrics([harbourCase], new Date("2026-07-07T00:00:00")).readyToFile,
    ).toBe(1);
  });
});

describe("annual return filing packet helpers", () => {
  it("calculates packet readiness from packet requirements", () => {
    expect(getPacketReadiness(baseCase)).toBe(0);
    expect(getPacketBlockers(baseCase)).toEqual([
      "NAR1 draft prepared",
      "Company particulars checked",
      "Significant controller register confirmed",
      "Signed NAR1 attached",
      "Payment proof checked",
      "Internal filing review approved",
    ]);
  });

  it("derives packet status from packet requirements and filing state", () => {
    expect(getPacketStatus(baseCase)).toBe("not-started");
    expect(
      getPacketStatus({
        ...baseCase,
        packetRequirements: [
          { id: "nar1-draft", label: "NAR1 draft prepared", complete: true, required: true },
          {
            id: "company-particulars",
            label: "Company particulars checked",
            complete: false,
            required: true,
          },
        ],
      }),
    ).toBe("building");
  });

  it("generates follow-up drafts from case and packet blockers", () => {
    const drafts = getFollowUpDrafts(baseCase);

    expect(drafts.map((draft) => draft.type)).toContain("missing-document");
    expect(drafts.map((draft) => draft.type)).toContain("payment-reminder");
    expect(drafts.map((draft) => draft.type)).toContain("signature-nudge");
    expect(drafts.map((draft) => draft.type)).toContain("review-escalation");
    expect(drafts.map((draft) => draft.type)).toContain("packet-reminder");
    expect(drafts[0]).toMatchObject({
      caseId: "ar-test",
      companyName: "Test Company Limited",
      recipientName: "Ada Staff",
      phone: "+852 6000 0000",
      status: "draft",
    });
  });

  it("blocks follow-up sends for filed cases", () => {
    const filedCase: AnnualReturnCase = {
      ...baseCase,
      status: "filed",
      sentFollowUpIds: [],
      sentFollowUps: [],
    };
    const [draft] = getFollowUpDrafts(baseCase);

    expect(canSendFollowUp(filedCase, draft)).toEqual({
      ok: false,
      reason: "Filed cases cannot send follow-ups",
    });
  });
});
