import { beforeEach, describe, expect, it } from "vitest";

import {
  acceptFilingReceipt,
  completeChecklistItem,
  getAnnualReturnCaseById,
  resetAnnualReturnCasesForTest,
  submitFilingPacket,
  togglePacketRequirement,
  updatePaymentStatus,
  updateReviewStatus,
  updateSignatureStatus,
} from "./annual-return-store";
import {
  acknowledgePaymentInstructions,
  approveClientPacket,
  getClientPortalActivity,
  getClientPortalProgress,
  getClientPortalRequiredActions,
  getCurrentClientDocument,
  getDocumentArchiveRows,
  recordReceiptViewed,
  replaceClientDocument,
  resetClientPortalStoreForTest,
  reviewClientDocument,
  uploadClientDocument,
} from "./client-portal-store";

function requireCase(caseId: string) {
  const caseItem = getAnnualReturnCaseById(caseId);
  if (!caseItem) throw new Error(`Missing fixture ${caseId}`);
  return caseItem;
}

function timelineLabels(caseId: string, label: string) {
  return requireCase(caseId).timeline.filter((event) => event.label === label);
}

function makeDeltaReadyForReceipt(): void {
  const signed = uploadClientDocument(
    requireCase("ar-delta"),
    "signed-nar1",
    "signed-nar1.pdf",
    "Joanna Poon",
  );
  const scr = uploadClientDocument(
    requireCase("ar-delta"),
    "scr",
    "updated-scr.pdf",
    "Joanna Poon",
  );
  if (!signed.ok || !scr.ok) throw new Error("Expected fixture uploads to succeed");
  reviewClientDocument(signed.documentId, "accepted", "Operations");
  reviewClientDocument(scr.documentId, "accepted", "Operations");
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

describe("client portal store", () => {
  beforeEach(() => {
    resetAnnualReturnCasesForTest();
    resetClientPortalStoreForTest();
  });

  it("derives required actions from missing case documents and payment acknowledgement", () => {
    const actions = getClientPortalRequiredActions(requireCase("ar-delta"));

    expect(actions.map((action) => action.id)).toEqual([
      "action-ar-delta-document-signed-nar1",
      "action-ar-delta-document-scr",
      "action-ar-delta-payment-acknowledgement",
      "action-ar-delta-packet-approval",
    ]);
    expect(getClientPortalProgress(requireCase("ar-delta"))).toMatchObject({
      completed: 0,
      total: 5,
      nextAction: "Upload Signed NAR1",
      percentage: 0,
      isReadOnly: false,
    });
  });

  it("uploads a current client document, leaves annual-return readiness pending review, and appends activity", () => {
    const result = uploadClientDocument(
      requireCase("ar-delta"),
      "signed-nar1",
      "signed-nar1.pdf",
      "Joanna Poon",
    );

    expect(result).toMatchObject({ ok: true });
    expect(getCurrentClientDocument("ar-delta", "signed-nar1")).toMatchObject({
      filename: "signed-nar1.pdf",
      status: "uploaded",
      source: "client-portal",
    });
    expect(
      requireCase("ar-delta").documents.find((document) => document.id === "signed-nar1"),
    ).toMatchObject({ received: false });
    expect(getClientPortalActivity("ar-delta")[0]).toMatchObject({
      type: "upload-document",
      summary: "Joanna Poon uploaded Signed NAR1.",
    });
  });

  it("replaces documents by superseding the previous upload and keeping both archive rows", () => {
    uploadClientDocument(requireCase("ar-delta"), "signed-nar1", "signed-nar1.pdf", "Joanna Poon");
    const replacement = replaceClientDocument(
      requireCase("ar-delta"),
      "signed-nar1",
      "signed-nar1-v2.pdf",
      "Joanna Poon",
    );
    const rows = getDocumentArchiveRows([requireCase("ar-delta")]).filter(
      (row) => row.requirementId === "signed-nar1" && row.source === "client-portal",
    );

    expect(replacement).toMatchObject({ ok: true });
    expect(getCurrentClientDocument("ar-delta", "signed-nar1")).toMatchObject({
      filename: "signed-nar1-v2.pdf",
      status: "uploaded",
    });
    expect(rows.map((row) => row.status).sort()).toEqual(["superseded", "uploaded"]);
  });

  it("scopes client-uploaded archive rows to the requested cases", () => {
    uploadClientDocument(requireCase("ar-delta"), "signed-nar1", "signed-nar1.pdf", "Joanna Poon");
    uploadClientDocument(
      requireCase("ar-crestview"),
      "signed-nar1",
      "crestview-signed.pdf",
      "Samuel Cheng",
    );

    const rows = getDocumentArchiveRows([requireCase("ar-delta")]).filter(
      (row) => row.source === "client-portal",
    );

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          caseId: "ar-delta",
          filename: "signed-nar1.pdf",
        }),
      ]),
    );
    expect(rows).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          caseId: "ar-crestview",
          filename: "crestview-signed.pdf",
        }),
      ]),
    );
  });

  it("rejects invalid replacement inputs without creating archive rows", () => {
    expect(
      replaceClientDocument(requireCase("ar-delta"), "missing-doc", "named.pdf", "Joanna Poon"),
    ).toEqual({
      ok: false,
      reason: "Document requirement not found",
    });
    expect(
      replaceClientDocument(requireCase("ar-delta"), "signed-nar1", "   ", "Joanna Poon"),
    ).toEqual({
      ok: false,
      reason: "Filename is required",
    });

    expect(getCurrentClientDocument("ar-delta", "signed-nar1")).toBeUndefined();
    expect(
      getDocumentArchiveRows([requireCase("ar-delta")]).filter(
        (row) => row.caseId === "ar-delta" && row.source === "client-portal",
      ),
    ).toHaveLength(0);
    expect(getClientPortalActivity("ar-delta")).toHaveLength(0);
  });

  it("records payment acknowledgement without marking payment paid", () => {
    expect(acknowledgePaymentInstructions(requireCase("ar-delta"), "Joanna Poon")).toEqual({
      ok: true,
    });

    expect(requireCase("ar-delta").paymentStatus).toBe("pending");
    expect(
      getClientPortalRequiredActions(requireCase("ar-delta")).map((action) => action.id),
    ).not.toContain("action-ar-delta-payment-acknowledgement");
  });

  it("blocks packet approval until portal-visible documents are uploaded", () => {
    expect(approveClientPacket(requireCase("ar-delta"), "Joanna Poon")).toEqual({
      ok: false,
      reason: "Packet approval blocked: Signed NAR1; Updated significant controller register",
    });
  });

  it("shows waiting for staff review when uploads are pending review", () => {
    acknowledgePaymentInstructions(requireCase("ar-delta"), "Joanna Poon");
    uploadClientDocument(requireCase("ar-delta"), "signed-nar1", "signed-nar1.pdf", "Joanna Poon");
    uploadClientDocument(requireCase("ar-delta"), "scr", "updated-scr.pdf", "Joanna Poon");

    expect(
      getClientPortalRequiredActions(requireCase("ar-delta")).find(
        (action) => action.kind === "packet",
      ),
    ).toMatchObject({ status: "blocked" });
    expect(getClientPortalProgress(requireCase("ar-delta"))).toMatchObject({
      nextAction: "Waiting for staff review",
    });
  });

  it("approves a packet after portal-visible documents are present", () => {
    const signed = uploadClientDocument(
      requireCase("ar-delta"),
      "signed-nar1",
      "signed-nar1.pdf",
      "Joanna Poon",
    );
    const scr = uploadClientDocument(
      requireCase("ar-delta"),
      "scr",
      "updated-scr.pdf",
      "Joanna Poon",
    );

    if (!signed.ok || !scr.ok) throw new Error("Expected fixture uploads to succeed");
    expect(reviewClientDocument(signed.documentId, "accepted", "Operations")).toEqual({
      ok: true,
      documentId: signed.documentId,
    });
    expect(reviewClientDocument(scr.documentId, "accepted", "Operations")).toEqual({
      ok: true,
      documentId: scr.documentId,
    });

    expect(approveClientPacket(requireCase("ar-delta"), "Joanna Poon")).toEqual({ ok: true });
    expect(getClientPortalActivity("ar-delta")[0]).toMatchObject({
      type: "approve-packet",
      summary: "Joanna Poon approved the filing packet.",
    });
    expect(
      getDocumentArchiveRows([requireCase("ar-delta")]).some(
        (row) => row.id === "archive-ar-delta-client-packet-approval",
      ),
    ).toBe(true);
  });

  it("derives generated submission and receipt archive rows", () => {
    makeDeltaReadyForReceipt();
    expect(submitFilingPacket("ar-delta").ok).toBe(true);
    expect(acceptFilingReceipt("ar-delta").ok).toBe(true);

    const rows = getDocumentArchiveRows([requireCase("ar-delta")]);

    expect(rows.map((row) => row.source)).toContain("filing-submission");
    expect(rows.map((row) => row.source)).toContain("filing-receipt");
    expect(recordReceiptViewed(requireCase("ar-delta"), "Joanna Poon")).toEqual({ ok: true });
  });

  it("blocks portal mutations for filed or receipt-accepted cases", () => {
    const filedCase = requireCase("ar-summit");

    expect(uploadClientDocument(filedCase, "signed-nar1", "signed.pdf", "Carmen Ng")).toEqual({
      ok: false,
      reason: "Filed cases are read-only in the client portal",
    });
    expect(approveClientPacket(filedCase, "Carmen Ng")).toEqual({
      ok: false,
      reason: "Filed cases are read-only in the client portal",
    });
    expect(getClientPortalProgress(filedCase)).toMatchObject({ isReadOnly: true });
  });

  it("keeps payment acknowledgement idempotent without duplicating activity or timeline", () => {
    expect(acknowledgePaymentInstructions(requireCase("ar-delta"), "Joanna Poon")).toEqual({
      ok: true,
    });
    expect(acknowledgePaymentInstructions(requireCase("ar-delta"), "Joanna Poon")).toEqual({
      ok: true,
    });

    expect(
      getClientPortalActivity("ar-delta").filter(
        (action) => action.type === "acknowledge-payment",
      ),
    ).toHaveLength(1);
    expect(timelineLabels("ar-delta", "Payment instructions acknowledged")).toHaveLength(1);
  });

  it("blocks packet approval until required client uploads are accepted by staff", () => {
    uploadClientDocument(requireCase("ar-delta"), "signed-nar1", "signed-nar1.pdf", "Joanna Poon");
    uploadClientDocument(requireCase("ar-delta"), "scr", "updated-scr.pdf", "Joanna Poon");

    expect(approveClientPacket(requireCase("ar-delta"), "Joanna Poon")).toEqual({
      ok: false,
      reason:
        "Packet approval blocked: Signed NAR1 pending staff review; Updated significant controller register pending staff review",
    });

    for (const row of getDocumentArchiveRows([requireCase("ar-delta")]).filter(
      (candidate) => candidate.source === "client-portal",
    )) {
      expect(reviewClientDocument(row.documentId ?? row.id, "accepted", "Operations")).toMatchObject({
        ok: true,
      });
    }

    expect(approveClientPacket(requireCase("ar-delta"), "Joanna Poon")).toEqual({ ok: true });
  });

  it("keeps packet approval idempotent after it succeeds", () => {
    const signed = uploadClientDocument(
      requireCase("ar-delta"),
      "signed-nar1",
      "signed-nar1.pdf",
      "Joanna Poon",
    );
    const scr = uploadClientDocument(requireCase("ar-delta"), "scr", "updated-scr.pdf", "Joanna Poon");

    if (!signed.ok || !scr.ok) throw new Error("Expected fixture uploads to succeed");

    reviewClientDocument(signed.documentId, "accepted", "Operations");
    reviewClientDocument(scr.documentId, "accepted", "Operations");

    expect(approveClientPacket(requireCase("ar-delta"), "Joanna Poon")).toEqual({ ok: true });
    expect(approveClientPacket(requireCase("ar-delta"), "Joanna Poon")).toEqual({ ok: true });

    expect(
      getClientPortalActivity("ar-delta").filter((action) => action.type === "approve-packet"),
    ).toHaveLength(1);
    expect(timelineLabels("ar-delta", "Client packet approved")).toHaveLength(1);
  });

  it("keeps receipt viewing idempotent after a receipt exists", () => {
    makeDeltaReadyForReceipt();
    expect(submitFilingPacket("ar-delta").ok).toBe(true);
    expect(acceptFilingReceipt("ar-delta").ok).toBe(true);

    expect(recordReceiptViewed(requireCase("ar-delta"), "Joanna Poon")).toEqual({ ok: true });
    expect(recordReceiptViewed(requireCase("ar-delta"), "Joanna Poon")).toEqual({ ok: true });

    expect(
      getClientPortalActivity("ar-delta").filter((action) => action.type === "view-receipt"),
    ).toHaveLength(1);
    expect(timelineLabels("ar-delta", "Client viewed receipt")).toHaveLength(1);
  });

  it("reopens rejected required documents for replacement", () => {
    const upload = uploadClientDocument(
      requireCase("ar-delta"),
      "signed-nar1",
      "signed-nar1.pdf",
      "Joanna Poon",
    );
    if (!upload.ok) throw new Error("Expected fixture upload to succeed");

    expect(reviewClientDocument(upload.documentId, "rejected", "Operations")).toEqual({
      ok: true,
      documentId: upload.documentId,
    });

    expect(getCurrentClientDocument("ar-delta", "signed-nar1")).toMatchObject({
      status: "rejected",
      reviewedBy: "Operations",
    });
    expect(
      requireCase("ar-delta").documents.find((document) => document.id === "signed-nar1"),
    ).toMatchObject({ received: false });
    expect(
      getClientPortalRequiredActions(requireCase("ar-delta")).find(
        (action) => action.requirementId === "signed-nar1",
      ),
    ).toMatchObject({
      label: "Replace Signed NAR1",
      status: "open",
      documentAction: "replace",
    });
  });

  it("rejects invalid document review attempts without changing archive state", () => {
    const upload = uploadClientDocument(
      requireCase("ar-delta"),
      "signed-nar1",
      "signed-nar1.pdf",
      "Joanna Poon",
    );
    if (!upload.ok) throw new Error("Expected fixture upload to succeed");

    const replacement = replaceClientDocument(
      requireCase("ar-delta"),
      "signed-nar1",
      "signed-nar1-v2.pdf",
      "Joanna Poon",
    );
    if (!replacement.ok || !replacement.supersededDocumentId) {
      throw new Error("Expected fixture replacement to supersede the first document");
    }

    expect(reviewClientDocument("missing-document", "accepted", "Operations")).toEqual({
      ok: false,
      reason: "Document not found",
    });
    expect(reviewClientDocument(replacement.supersededDocumentId, "accepted", "Operations")).toEqual({
      ok: false,
      reason: "Superseded documents cannot be reviewed",
    });
    expect(reviewClientDocument(replacement.documentId, "accepted", "Operations")).toEqual({
      ok: true,
      documentId: replacement.documentId,
    });
    expect(reviewClientDocument(replacement.documentId, "rejected", "Operations")).toEqual({
      ok: false,
      reason: "Document has already been reviewed",
    });
  });
});
