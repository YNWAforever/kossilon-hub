import { beforeEach, describe, expect, it } from "vitest";

import {
  acceptFilingReceipt,
  addCaseNote,
  assignOwner,
  canSendFollowUp,
  completeChecklistItem,
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
  markDocumentMissing,
  markDocumentReceived,
  markFiled,
  appendClientPortalTimelineEvent,
  reopenChecklistItem,
  resetAnnualReturnCasesForTest,
  sendFollowUpNow,
  submitFilingPacket,
  subscribeAnnualReturnCasesForTest,
  togglePacketRequirement,
  type AnnualReturnCase,
  updatePaymentStatus,
  updateReviewStatus,
  updateSignatureStatus,
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

function makeDeltaReadyForPacketSubmission(): void {
  markDocumentReceived("ar-delta", "signed-nar1");
  markDocumentReceived("ar-delta", "scr");
  updatePaymentStatus("ar-delta", "paid");
  updateSignatureStatus("ar-delta", "received");
  completeChecklistItem("ar-delta", "collect-signed-nar1");
  completeChecklistItem("ar-delta", "verify-scr");
  completeChecklistItem("ar-delta", "confirm-payment");
  completeChecklistItem("ar-delta", "submit-registry");
  updateReviewStatus("ar-delta", "approved");

  for (const requirementId of [
    "nar1-draft",
    "company-particulars",
    "scr-confirmed",
    "signed-nar1-attached",
    "payment-proof-checked",
    "internal-filing-review",
  ]) {
    togglePacketRequirement("ar-delta", requirementId);
  }
}

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

describe("annual return store mutations", () => {
  beforeEach(() => {
    resetAnnualReturnCasesForTest();
  });

  it("appends client portal timeline events without changing filing state", () => {
    const before = getAnnualReturnCaseById("ar-delta");

    expect(
      appendClientPortalTimelineEvent(
        "ar-delta",
        "Client document uploaded",
        "Joanna Poon uploaded Signed NAR1 from the client portal.",
      ),
    ).toEqual({ ok: true });

    const after = getAnnualReturnCaseById("ar-delta");

    expect(after?.status).toBe(before?.status);
    expect(after?.timeline[0]).toMatchObject({
      label: "Client document uploaded",
      detail: "Joanna Poon uploaded Signed NAR1 from the client portal.",
    });
  });

  it("returns a stable error for missing client portal timeline cases", () => {
    expect(
      appendClientPortalTimelineEvent(
        "ar-missing",
        "Client document uploaded",
        "Missing case should not mutate state.",
      ),
    ).toEqual({
      ok: false,
      reason: "Case not found",
    });
  });

  it("marks a document as received, appends a timeline event, and emits once", () => {
    let notifications = 0;
    const unsubscribe = subscribeAnnualReturnCasesForTest(() => {
      notifications += 1;
    });

    markDocumentReceived("ar-delta", "signed-nar1");
    markDocumentReceived("ar-delta", "signed-nar1");

    unsubscribe();

    const caseItem = getAnnualReturnCaseById("ar-delta");

    expect(caseItem?.documents.find((document) => document.id === "signed-nar1")?.received).toBe(
      true,
    );
    expect(caseItem?.timeline[0]).toMatchObject({
      label: "Document received",
      detail: "Signed NAR1 marked as received.",
    });
    expect(notifications).toBe(1);
  });

  it("updates payment status and appends a timeline event", () => {
    updatePaymentStatus("ar-delta", "paid");

    const caseItem = getAnnualReturnCaseById("ar-delta");

    expect(caseItem?.paymentStatus).toBe("paid");
    expect(caseItem?.timeline[0]).toMatchObject({
      label: "Payment status updated",
      detail: "Payment status changed to paid.",
    });
  });

  it("recomputes status when readiness mutations make a case ready to file", () => {
    markDocumentReceived("ar-delta", "signed-nar1");
    markDocumentReceived("ar-delta", "scr");
    updatePaymentStatus("ar-delta", "paid");
    updateSignatureStatus("ar-delta", "received");
    completeChecklistItem("ar-delta", "collect-signed-nar1");
    completeChecklistItem("ar-delta", "verify-scr");
    completeChecklistItem("ar-delta", "confirm-payment");
    completeChecklistItem("ar-delta", "submit-registry");
    updateReviewStatus("ar-delta", "approved");

    const caseItem = getAnnualReturnCaseById("ar-delta");

    expect(caseItem && getReadinessScore(caseItem)).toBe(100);
    expect(caseItem?.status).toBe("ready-to-file");
  });

  it("refuses to file a case when readiness is below 100", () => {
    expect(markFiled("ar-delta")).toEqual({
      ok: false,
      reason: "Case is not ready to file",
    });
  });

  it("refuses to file a ready case directly before a receipt is accepted", () => {
    makeDeltaReadyForPacketSubmission();

    const readyCase = getAnnualReturnCaseById("ar-delta");
    expect(readyCase && getReadinessScore(readyCase)).toBe(100);

    expect(markFiled("ar-delta")).toEqual({
      ok: false,
      reason: "Filing receipt must be accepted before marking filed",
    });
  });

  it("blocks receipt acceptance before packet submission", () => {
    expect(acceptFilingReceipt("ar-delta")).toEqual({
      ok: false,
      reason: "Packet must be submitted before receipt acceptance",
    });
  });

  it("marks a case filed once a receipt has been accepted", () => {
    makeDeltaReadyForPacketSubmission();

    const submitted = submitFilingPacket("ar-delta");
    expect(submitted.ok).toBe(true);

    const accepted = acceptFilingReceipt("ar-delta");
    expect(accepted.ok).toBe(true);

    expect(markFiled("ar-delta")).toEqual({ ok: true });

    const filedCase = getAnnualReturnCaseById("ar-delta");

    expect(filedCase?.status).toBe("filed");
    expect(filedCase?.timeline[0]).toMatchObject({
      label: "Filing receipt accepted",
    });
  });

  it("ignores readiness mutations after a case is filed", () => {
    makeDeltaReadyForPacketSubmission();
    submitFilingPacket("ar-delta");
    acceptFilingReceipt("ar-delta");

    const before = getAnnualReturnCaseById("ar-delta");
    const timelineLength = before?.timeline.length;

    markDocumentMissing("ar-delta", "signed-nar1");
    updatePaymentStatus("ar-delta", "overdue");
    updateSignatureStatus("ar-delta", "missing");
    reopenChecklistItem("ar-delta", "confirm-payment");
    updateReviewStatus("ar-delta", "not-started");

    const after = getAnnualReturnCaseById("ar-delta");

    expect(after?.status).toBe("filed");
    expect(after && getReadinessScore(after)).toBe(100);
    expect(after?.documents.find((document) => document.id === "signed-nar1")?.received).toBe(true);
    expect(after?.paymentStatus).toBe("paid");
    expect(after?.signatureStatus).toBe("received");
    expect(after?.checklist.find((item) => item.id === "confirm-payment")?.complete).toBe(true);
    expect(after?.reviewStatus).toBe("approved");
    expect(after?.timeline.length).toBe(timelineLength);
  });

  it("toggles packet requirements, updates readiness, and appends timeline events", () => {
    togglePacketRequirement("ar-delta", "nar1-draft");

    const caseItem = getAnnualReturnCaseById("ar-delta");

    expect(caseItem?.packetRequirements.find((item) => item.id === "nar1-draft")?.complete).toBe(
      true,
    );
    expect(caseItem && getPacketReadiness(caseItem)).toBeGreaterThan(0);
    expect(caseItem?.timeline[0]).toMatchObject({
      label: "Packet requirement updated",
      detail: "NAR1 draft prepared marked complete.",
    });
  });

  it("mock-sends a follow-up and appends a timeline event", () => {
    const before = getAnnualReturnCaseById("ar-delta");
    const draft = before ? getFollowUpDrafts(before)[0] : undefined;

    expect(draft).toBeDefined();
    expect(draft && sendFollowUpNow("ar-delta", draft.id)).toEqual({ ok: true });

    const after = getAnnualReturnCaseById("ar-delta");

    expect(after?.sentFollowUpIds).toContain(draft?.id);
    expect(after?.timeline[0]?.label).toBe("WhatsApp reminder sent");
  });

  it("refuses to send the same follow-up twice", () => {
    const before = getAnnualReturnCaseById("ar-delta");
    const draft = before ? getFollowUpDrafts(before)[0] : undefined;

    expect(draft).toBeDefined();
    expect(draft && sendFollowUpNow("ar-delta", draft.id)).toEqual({ ok: true });
    expect(draft && sendFollowUpNow("ar-delta", draft.id)).toEqual({
      ok: false,
      reason: "Follow-up has already been sent",
    });
  });

  it("keeps sent follow-ups visible after the original blocker is resolved", () => {
    const before = getAnnualReturnCaseById("ar-delta");
    const draft = before?.documents[0]
      ? getFollowUpDrafts(before).find(
          (candidate) => candidate.id === "follow-up-ar-delta-document-signed-nar1",
        )
      : undefined;

    expect(draft).toBeDefined();
    expect(draft && sendFollowUpNow("ar-delta", draft.id)).toEqual({ ok: true });

    markDocumentReceived("ar-delta", "signed-nar1");

    const after = getAnnualReturnCaseById("ar-delta");
    const persistedDraft = after
      ? getFollowUpDrafts(after).find((candidate) => candidate.id === draft?.id)
      : undefined;

    expect(persistedDraft).toMatchObject({
      id: draft?.id,
      status: "sent",
      recipientName: draft?.recipientName,
      messagePreview: draft?.messagePreview,
    });
  });

  it("blocks packet submission until case and packet are complete", () => {
    expect(submitFilingPacket("ar-delta")).toEqual({
      ok: false,
      reason:
        "Packet is not ready: case readiness is below 100%; NAR1 draft prepared; Company particulars checked; Significant controller register confirmed; Signed NAR1 attached; Payment proof checked; Internal filing review approved",
    });
  });

  it("submits a complete packet, accepts the receipt, and marks the case filed", () => {
    makeDeltaReadyForPacketSubmission();

    const submitted = submitFilingPacket("ar-delta");
    expect(submitted.ok).toBe(true);

    const submittedCase = getAnnualReturnCaseById("ar-delta");
    expect(submittedCase && getPacketStatus(submittedCase)).toBe("submitted");

    const accepted = acceptFilingReceipt("ar-delta");
    expect(accepted.ok).toBe(true);

    const filedCase = getAnnualReturnCaseById("ar-delta");
    expect(filedCase?.status).toBe("filed");
    expect(filedCase && getPacketStatus(filedCase)).toBe("accepted");
    expect(filedCase?.timeline[0]).toMatchObject({
      label: "Filing receipt accepted",
    });
  });

  it("locks packet requirements once a packet has been submitted", () => {
    makeDeltaReadyForPacketSubmission();
    submitFilingPacket("ar-delta");

    const before = getAnnualReturnCaseById("ar-delta");
    const timelineLength = before?.timeline.length;

    togglePacketRequirement("ar-delta", "nar1-draft");

    const after = getAnnualReturnCaseById("ar-delta");

    expect(after?.packetRequirements.find((item) => item.id === "nar1-draft")?.complete).toBe(true);
    expect(after?.timeline.length).toBe(timelineLength);
  });

  it("ignores packet and follow-up mutations after a case is filed", () => {
    makeDeltaReadyForPacketSubmission();
    submitFilingPacket("ar-delta");
    acceptFilingReceipt("ar-delta");

    const before = getAnnualReturnCaseById("ar-delta");
    const timelineLength = before?.timeline.length;

    togglePacketRequirement("ar-delta", "nar1-draft");
    const sendResult = sendFollowUpNow("ar-delta", "follow-up-ar-delta-document-signed-nar1");
    const submitResult = submitFilingPacket("ar-delta");

    const after = getAnnualReturnCaseById("ar-delta");

    expect(sendResult).toEqual({
      ok: false,
      reason: "Filed cases cannot send follow-ups",
    });
    expect(submitResult).toEqual({
      ok: false,
      reason: "Filed cases cannot be submitted",
    });
    expect(after?.timeline.length).toBe(timelineLength);
  });

  it("ignores owner and note mutations after a case is filed", () => {
    makeDeltaReadyForPacketSubmission();
    submitFilingPacket("ar-delta");
    acceptFilingReceipt("ar-delta");

    const before = getAnnualReturnCaseById("ar-delta");
    const timelineLength = before?.timeline.length;

    assignOwner("ar-delta", "Operations");
    addCaseNote("ar-delta", "Operations", "Filed follow-up note");

    const after = getAnnualReturnCaseById("ar-delta");

    expect(after?.owner).toBe(before?.owner);
    expect(after?.notes).toEqual(before?.notes);
    expect(after?.timeline.length).toBe(timelineLength);
  });
});
