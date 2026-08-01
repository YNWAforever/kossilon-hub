import { beforeEach, describe, expect, it } from "vitest";

import { getAnnualReturnCaseById, resetAnnualReturnCasesForTest } from "./annual-return-store";
import {
  clientPortalReviewReasons,
  getClientPortalProgress,
  getClientPortalRequiredActions,
  getClientPortalReviewReason,
  getDocumentReviewFollowUpDrafts,
  resetClientPortalStoreForTest,
} from "./client-portal-store";

function requireCase(caseId: string) {
  const caseItem = getAnnualReturnCaseById(caseId);
  if (!caseItem) throw new Error(`Missing fixture ${caseId}`);
  return caseItem;
}

// The seed carries a rejected Signed NAR1 for ar-delta; the follow-up
// derivations below read it directly instead of writing their way into it.
const REJECTED_SIGNED_NAR1 = "doc-delta-signed-nar1-rejected";

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
      "action-ar-delta-payment-proof",
      "action-ar-delta-packet-approval",
    ]);
    // The seed carries an accepted SCR and an accepted payment proof, so two of
    // the six are already done, and the rejected Signed NAR1 asks to be replaced
    // rather than uploaded.
    expect(getClientPortalProgress(requireCase("ar-delta"))).toMatchObject({
      completed: 2,
      total: 6,
      nextAction: "Replace Signed NAR1",
      percentage: 33,
      isReadOnly: false,
    });
  });

  it("derives one rejected-document follow-up draft for a current rejected document", () => {
    const documentId = REJECTED_SIGNED_NAR1;

    expect(getDocumentReviewFollowUpDrafts([requireCase("ar-delta")])).toEqual([
      expect.objectContaining({
        id: `document-review-follow-up-${documentId}`,
        caseId: "ar-delta",
        documentId,
        companyName: "Delta Bloom Ventures Limited",
        recipientName: "Joanna Poon",
        phone: "+852 9333 2211",
        documentTitle: "Signed NAR1",
        reasonCode: "missing-signature",
        reasonLabel: "Required signature is missing",
        note: "Director signature is missing on page 2.",
        status: "draft",
        suggestedTiming: "Send now",
      }),
    ]);

    expect(getDocumentReviewFollowUpDrafts([requireCase("ar-delta")])[0].messagePreview).toContain(
      "need a replacement because the required signature is missing",
    );
  });

  it("marks rejected-document follow-up drafts blocked when the supplied case is filed", () => {
    const documentId = REJECTED_SIGNED_NAR1;
    const filedCase = { ...requireCase("ar-delta"), status: "filed" as const };

    expect(getDocumentReviewFollowUpDrafts([filedCase])).toEqual([
      expect.objectContaining({
        id: `document-review-follow-up-${documentId}`,
        status: "blocked",
        blockedReason: "Filed cases cannot send follow-ups",
      }),
    ]);
  });

  it("publishes the supported review reason list", () => {
    expect(clientPortalReviewReasons.map((reason) => reason.code)).toEqual([
      "wrong-file",
      "expired",
      "unclear-scan",
      "name-mismatch",
      "missing-signature",
      "missing-page",
      "other",
    ]);
    expect(getClientPortalReviewReason("missing-signature")).toEqual({
      code: "missing-signature",
      label: "Required signature is missing",
    });
    expect(getClientPortalReviewReason(undefined)).toBeUndefined();
  });
});
