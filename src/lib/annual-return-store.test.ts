import { beforeEach, describe, expect, it } from "vitest";

import {
  completeChecklistItem,
  getAnnualReturnCaseById,
  getBlockers,
  getCaseMetrics,
  getCaseTasks,
  getNextAction,
  getReadinessScore,
  getRiskLevel,
  markDocumentMissing,
  markDocumentReceived,
  markFiled,
  reopenChecklistItem,
  resetAnnualReturnCasesForTest,
  subscribeAnnualReturnCasesForTest,
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

describe("annual return store mutations", () => {
  beforeEach(() => {
    resetAnnualReturnCasesForTest();
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

  it("files a case once existing mutations make it ready", () => {
    markDocumentReceived("ar-delta", "signed-nar1");
    markDocumentReceived("ar-delta", "scr");
    updatePaymentStatus("ar-delta", "paid");
    updateSignatureStatus("ar-delta", "received");
    completeChecklistItem("ar-delta", "collect-signed-nar1");
    completeChecklistItem("ar-delta", "verify-scr");
    completeChecklistItem("ar-delta", "confirm-payment");
    completeChecklistItem("ar-delta", "submit-registry");
    updateReviewStatus("ar-delta", "approved");

    const readyCase = getAnnualReturnCaseById("ar-delta");
    expect(readyCase && getReadinessScore(readyCase)).toBe(100);

    expect(markFiled("ar-delta")).toEqual({ ok: true });

    const filedCase = getAnnualReturnCaseById("ar-delta");

    expect(filedCase?.status).toBe("filed");
    expect(filedCase?.timeline[0]).toMatchObject({
      label: "Case filed",
      detail: "Annual return filed with Companies Registry.",
    });
  });

  it("ignores readiness mutations after a case is filed", () => {
    markDocumentReceived("ar-delta", "signed-nar1");
    markDocumentReceived("ar-delta", "scr");
    updatePaymentStatus("ar-delta", "paid");
    updateSignatureStatus("ar-delta", "received");
    completeChecklistItem("ar-delta", "collect-signed-nar1");
    completeChecklistItem("ar-delta", "verify-scr");
    completeChecklistItem("ar-delta", "confirm-payment");
    completeChecklistItem("ar-delta", "submit-registry");
    updateReviewStatus("ar-delta", "approved");
    markFiled("ar-delta");

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
});
