export type EvidenceBatchAction = "classifyDocuments" | "assignReview" | "retryAnalysis";

const reasons: Record<EvidenceBatchAction, string> = {
  classifyDocuments: "NO_AUTHORIZED_SINGLE_ITEM_CLASSIFICATION_SERVICE",
  assignReview: "NO_AUTHORIZED_SINGLE_ITEM_REVIEW_ASSIGNMENT_SERVICE",
  retryAnalysis: "NO_AUTHORIZED_SINGLE_ITEM_ANALYSIS_RETRY_SERVICE",
};

/** Keep unimplemented evidence writes outside the live bulk action registry. */
export function evidenceActionAvailability(action: EvidenceBatchAction): {
  enabled: false;
  reasonCode: string;
} {
  return { enabled: false, reasonCode: reasons[action] };
}
