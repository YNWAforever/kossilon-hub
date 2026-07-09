import { useSyncExternalStore } from "react";

import {
  type AnnualReturnCase,
  appendClientPortalTimelineEvent,
  getAnnualReturnCaseById,
  getPacketStatus,
  markDocumentMissing,
  markDocumentReceived,
} from "./annual-return-store";

export type ClientPortalDocumentCategory =
  "identity" | "registry" | "signature" | "payment" | "packet" | "submission" | "receipt" | "other";

export type ClientPortalDocumentSource =
  "client-portal" | "staff-packet" | "filing-submission" | "filing-receipt";

export type ClientPortalDocumentStatus =
  "required" | "uploaded" | "superseded" | "accepted" | "rejected" | "generated";

export type ClientPortalActionType =
  | "upload-document"
  | "replace-document"
  | "acknowledge-payment"
  | "approve-packet"
  | "view-receipt"
  | "accept-document"
  | "reject-document"
  | "send-document-review-follow-up";

export type ClientPortalDocumentReviewDecision = "accepted" | "rejected";

export const clientPortalReviewReasons = [
  { code: "wrong-file", label: "Wrong document uploaded" },
  { code: "expired", label: "Document is expired or outdated" },
  { code: "unclear-scan", label: "Scan is unreadable or incomplete" },
  { code: "name-mismatch", label: "Name or company details do not match" },
  { code: "missing-signature", label: "Required signature is missing" },
  { code: "missing-page", label: "Required page or attachment is missing" },
  { code: "other", label: "Other issue" },
] as const;

export type ClientPortalReviewReasonCode = (typeof clientPortalReviewReasons)[number]["code"];

export type ClientPortalDocumentReviewRequest =
  | {
      decision: "accepted";
      actor?: string;
    }
  | {
      decision: "rejected";
      reasonCode?: ClientPortalReviewReasonCode;
      note?: string;
      actor?: string;
    };

type NormalizedClientPortalReviewRequest =
  | {
      ok: true;
      decision: "accepted";
      actor: string;
    }
  | {
      ok: true;
      decision: "rejected";
      actor: string;
      reasonCode: ClientPortalReviewReasonCode;
      reasonLabel: string;
      note?: string;
    }
  | { ok: false; reason: string };

export type ClientPortalActionStatus = "completed" | "blocked";

export type ClientPortalDocument = {
  id: string;
  caseId: string;
  requirementId?: string;
  companyName: string;
  contactName: string;
  title: string;
  filename: string;
  category: ClientPortalDocumentCategory;
  source: ClientPortalDocumentSource;
  status: ClientPortalDocumentStatus;
  actor: string;
  createdAt: string;
  supersedesDocumentId?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewSummary?: string;
  reviewReasonCode?: ClientPortalReviewReasonCode;
  reviewReasonLabel?: string;
  reviewNote?: string;
};

export type ClientPortalAction = {
  id: string;
  caseId: string;
  type: ClientPortalActionType;
  actor: string;
  status: ClientPortalActionStatus;
  summary: string;
  createdAt: string;
  documentId?: string;
  draftId?: string;
};

export type ClientPortalArchiveRow = {
  id: string;
  documentId?: string;
  caseId: string;
  requirementId?: string;
  companyName: string;
  contactName: string;
  title: string;
  filename: string;
  category: ClientPortalDocumentCategory;
  source: ClientPortalDocumentSource;
  status: ClientPortalDocumentStatus;
  actor: string;
  createdAt: string;
  readonly: boolean;
  reviewable: boolean;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewSummary?: string;
  reviewReasonCode?: ClientPortalReviewReasonCode;
  reviewReasonLabel?: string;
  reviewNote?: string;
};

export type ClientPortalRequiredActionStatus = "open" | "complete" | "blocked" | "pending-review";

export type ClientPortalRequiredAction = {
  id: string;
  caseId: string;
  kind: "document" | "payment" | "packet" | "receipt";
  label: string;
  status: ClientPortalRequiredActionStatus;
  detail: string;
  requirementId?: string;
  documentAction?: "upload" | "replace";
};

export type ClientPortalProgress = {
  completed: number;
  total: number;
  percentage: number;
  nextAction: string;
  isReadOnly: boolean;
};

export type ClientPortalDocumentReviewFollowUpStatus = "draft" | "sent" | "blocked";

export type ClientPortalDocumentReviewFollowUpDraft = {
  id: string;
  caseId: string;
  documentId: string;
  requirementId?: string;
  companyName: string;
  recipientName: string;
  phone: string;
  documentTitle: string;
  reasonCode: ClientPortalReviewReasonCode;
  reasonLabel: string;
  note?: string;
  suggestedTiming: string;
  messagePreview: string;
  status: ClientPortalDocumentReviewFollowUpStatus;
  blockedReason?: string;
  sentAt?: string;
};

export type ClientPortalDocumentReviewFollowUpSend = {
  id: string;
  draftId: string;
  documentId: string;
  caseId: string;
  actor: string;
  sentAt: string;
};

export type ClientPortalSnapshot = {
  documents: ClientPortalDocument[];
  actions: ClientPortalAction[];
  documentReviewFollowUps: ClientPortalDocumentReviewFollowUpSend[];
};

const initialSnapshot: ClientPortalSnapshot = {
  documents: [],
  actions: [],
  documentReviewFollowUps: [],
};

let snapshot: ClientPortalSnapshot = cloneSnapshot(initialSnapshot);
const listeners = new Set<() => void>();

function cloneSnapshot(value: ClientPortalSnapshot): ClientPortalSnapshot {
  return {
    documents: value.documents.map((document) => ({ ...document })),
    actions: value.actions.map((action) => ({ ...action })),
    documentReviewFollowUps: value.documentReviewFollowUps.map((followUp) => ({ ...followUp })),
  };
}

function nowStamp(): string {
  return new Date().toISOString();
}

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshotInternal(): ClientPortalSnapshot {
  return snapshot;
}

export function useClientPortalSnapshot(): ClientPortalSnapshot {
  return useSyncExternalStore(subscribe, getSnapshotInternal, getSnapshotInternal);
}

export function getClientPortalSnapshot(): ClientPortalSnapshot {
  return cloneSnapshot(snapshot);
}

export function getClientPortalReviewReason(
  code: ClientPortalReviewReasonCode | string | undefined,
): { code: ClientPortalReviewReasonCode; label: string } | undefined {
  return clientPortalReviewReasons.find((reason) => reason.code === code);
}

export function resetClientPortalStoreForTest(): void {
  snapshot = cloneSnapshot(initialSnapshot);
  emit();
}

function documentCategoryForRequirement(requirementId: string): ClientPortalDocumentCategory {
  if (requirementId.includes("payment")) return "payment";
  if (requirementId.includes("signed") || requirementId.includes("nar1")) return "signature";
  if (requirementId.includes("scr")) return "registry";
  return "registry";
}

function isReadOnlyCase(caseItem: AnnualReturnCase): boolean {
  return caseItem.status === "filed" || getPacketStatus(caseItem) === "accepted";
}

function hasCompletedAction(
  caseId: string,
  type: ClientPortalActionType,
  currentSnapshot = snapshot,
): boolean {
  return currentSnapshot.actions.some(
    (action) => action.caseId === caseId && action.type === type && action.status === "completed",
  );
}

function addAction(
  caseItem: AnnualReturnCase,
  type: ClientPortalActionType,
  actor: string,
  summary: string,
): ClientPortalAction {
  return addActionForCase(caseItem.id, type, actor, summary);
}

function addActionForCase(
  caseId: string,
  type: ClientPortalActionType,
  actor: string,
  summary: string,
  metadata: Pick<ClientPortalAction, "documentId" | "draftId"> = {},
): ClientPortalAction {
  const action: ClientPortalAction = {
    id: `portal-action-${caseId}-${type}-${Date.now()}-${snapshot.actions.length + 1}`,
    caseId,
    type,
    actor,
    status: "completed",
    summary,
    createdAt: nowStamp(),
    ...metadata,
  };

  snapshot = { ...snapshot, actions: [action, ...snapshot.actions] };
  return action;
}

function addActionOnce(
  caseItem: AnnualReturnCase,
  type: ClientPortalActionType,
  actor: string,
  summary: string,
): { action: ClientPortalAction; inserted: boolean } {
  const existing = snapshot.actions.find(
    (action) =>
      action.caseId === caseItem.id && action.type === type && action.status === "completed",
  );
  if (existing) return { action: existing, inserted: false };

  return { action: addActionForCase(caseItem.id, type, actor, summary), inserted: true };
}

export function getCurrentClientDocument(
  caseId: string,
  requirementId: string,
  currentSnapshot = snapshot,
): ClientPortalDocument | undefined {
  return currentSnapshot.documents
    .filter(
      (document) =>
        document.caseId === caseId &&
        document.requirementId === requirementId &&
        document.source === "client-portal" &&
        document.status !== "superseded",
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
}

function isAcceptedClientDocument(
  caseId: string,
  requirementId: string,
  currentSnapshot = snapshot,
): boolean {
  return getCurrentClientDocument(caseId, requirementId, currentSnapshot)?.status === "accepted";
}

function documentActionForCurrentDocument(
  document: ClientPortalDocument | undefined,
): "upload" | "replace" | undefined {
  if (!document) return "upload";
  if (document.status === "rejected") return "replace";
  return undefined;
}

function requiredDocumentLabel(documentLabel: string, document?: ClientPortalDocument): string {
  if (!document) return `Upload ${documentLabel}`;
  if (document.status === "rejected") return `Replace ${documentLabel}`;
  return documentLabel;
}

function requiredDocumentDetail(documentLabel: string, document?: ClientPortalDocument): string {
  if (!document) {
    return `${documentLabel} is required before the annual return filing can proceed.`;
  }
  if (document.status === "uploaded") {
    return `${document.filename} is uploaded and waiting for staff review.`;
  }
  if (document.status === "accepted") {
    return `${document.filename} has been accepted by staff.`;
  }
  if (document.status === "rejected") {
    const reason = document.reviewReasonLabel ? ` Reason: ${document.reviewReasonLabel}.` : "";
    const note = document.reviewNote ? ` Note: ${document.reviewNote}` : "";
    return `${document.filename} was rejected by staff.${reason}${note} Please upload a replacement.`;
  }
  return `${documentLabel} is required before the annual return filing can proceed.`;
}

export function getClientPortalActivity(
  caseId: string,
  currentSnapshot = snapshot,
): ClientPortalAction[] {
  return currentSnapshot.actions.filter((action) => action.caseId === caseId);
}

export function getClientPortalRequiredActions(
  caseItem: AnnualReturnCase,
  currentSnapshot = snapshot,
): ClientPortalRequiredAction[] {
  const documentActions = caseItem.documents
    .filter((document) => document.required)
    .map((document) => {
      const currentDocument = getCurrentClientDocument(caseItem.id, document.id, currentSnapshot);
      const status: ClientPortalRequiredActionStatus = isReadOnlyCase(caseItem)
        ? "blocked"
        : currentDocument?.status === "accepted"
          ? "complete"
          : currentDocument?.status === "uploaded"
            ? "pending-review"
            : "open";
      const documentAction = documentActionForCurrentDocument(currentDocument);

      return {
        id: `action-${caseItem.id}-document-${document.id}`,
        caseId: caseItem.id,
        kind: "document" as const,
        label: requiredDocumentLabel(document.label, currentDocument),
        status,
        detail: requiredDocumentDetail(document.label, currentDocument),
        requirementId: document.id,
        ...(documentAction ? { documentAction } : {}),
      };
    });

  const paymentAction = hasCompletedAction(caseItem.id, "acknowledge-payment", currentSnapshot)
    ? []
    : [
        {
          id: `action-${caseItem.id}-payment-acknowledgement`,
          caseId: caseItem.id,
          kind: "payment" as const,
          label: "Acknowledge payment instructions",
          status: isReadOnlyCase(caseItem) ? ("blocked" as const) : ("open" as const),
          detail:
            "Confirm the client has seen the payment instructions. Staff still controls payment status.",
        },
      ];

  const packetAction = hasCompletedAction(caseItem.id, "approve-packet", currentSnapshot)
    ? []
    : [
        {
          id: `action-${caseItem.id}-packet-approval`,
          caseId: caseItem.id,
          kind: "packet" as const,
          label: "Approve filing packet",
          status:
            isReadOnlyCase(caseItem) ||
            getPacketApprovalBlockers(caseItem, currentSnapshot).length > 0
              ? ("blocked" as const)
              : ("open" as const),
          detail:
            getPacketApprovalBlockers(caseItem, currentSnapshot).length > 0
              ? "Required documents still need staff review or replacement before packet approval is available."
              : "Confirm the client has reviewed the prepared packet details.",
        },
      ];

  const receiptAction =
    caseItem.receipt && !hasCompletedAction(caseItem.id, "view-receipt", currentSnapshot)
      ? [
          {
            id: `action-${caseItem.id}-receipt-view`,
            caseId: caseItem.id,
            kind: "receipt" as const,
            label: "View filing receipt",
            status: "open" as const,
            detail: `Receipt ${caseItem.receipt.receiptNumber} is ready to view.`,
          },
        ]
      : [];

  return [...documentActions, ...paymentAction, ...packetAction, ...receiptAction];
}

export function getClientPortalProgress(
  caseItem: AnnualReturnCase,
  currentSnapshot = snapshot,
): ClientPortalProgress {
  const requiredDocuments = caseItem.documents.filter((document) => document.required);
  const completedDocuments = requiredDocuments.filter((document) =>
    isAcceptedClientDocument(caseItem.id, document.id, currentSnapshot),
  ).length;
  const paymentComplete = hasCompletedAction(caseItem.id, "acknowledge-payment", currentSnapshot);
  const packetComplete = hasCompletedAction(caseItem.id, "approve-packet", currentSnapshot);
  const receiptComplete =
    Boolean(caseItem.receipt) && hasCompletedAction(caseItem.id, "view-receipt", currentSnapshot);
  const total = requiredDocuments.length + 3;
  const completed =
    completedDocuments +
    (paymentComplete ? 1 : 0) +
    (packetComplete ? 1 : 0) +
    (receiptComplete ? 1 : 0);
  const requiredActions = getClientPortalRequiredActions(caseItem, currentSnapshot);
  const nextOpen = requiredActions.find((action) => action.status === "open");
  const nextPending = requiredActions.find((action) => action.status === "pending-review");

  return {
    completed,
    total,
    percentage: total === 0 ? 100 : Math.round((completed / total) * 100),
    nextAction:
      nextOpen?.label ?? (nextPending ? "Waiting for staff review" : "No client action needed"),
    isReadOnly: isReadOnlyCase(caseItem),
  };
}

function rowFromDocument(
  document: ClientPortalDocument,
  caseItem = getAnnualReturnCaseById(document.caseId),
): ClientPortalArchiveRow {
  const reviewable =
    document.source === "client-portal" &&
    document.status === "uploaded" &&
    Boolean(caseItem) &&
    !isReadOnlyCase(caseItem);

  return {
    id: `archive-${document.id}`,
    documentId: document.id,
    caseId: document.caseId,
    requirementId: document.requirementId,
    companyName: document.companyName,
    contactName: document.contactName,
    title: document.title,
    filename: document.filename,
    category: document.category,
    source: document.source,
    status: document.status,
    actor: document.actor,
    createdAt: document.createdAt,
    readonly: !reviewable,
    reviewable,
    reviewedBy: document.reviewedBy,
    reviewedAt: document.reviewedAt,
    reviewSummary: document.reviewSummary,
    reviewReasonCode: document.reviewReasonCode,
    reviewReasonLabel: document.reviewReasonLabel,
    reviewNote: document.reviewNote,
  };
}

function generatedRowsForCase(
  caseItem: AnnualReturnCase,
  currentSnapshot: ClientPortalSnapshot,
): ClientPortalArchiveRow[] {
  const rows: ClientPortalArchiveRow[] = caseItem.packetRequirements
    .filter((requirement) => requirement.complete)
    .map((requirement) => ({
      id: `archive-${caseItem.id}-packet-${requirement.id}`,
      caseId: caseItem.id,
      requirementId: requirement.id,
      companyName: caseItem.companyName,
      contactName: caseItem.contactName,
      title: requirement.label,
      filename: `${caseItem.id}-${requirement.id}.pdf`,
      category: "packet" as const,
      source: "staff-packet" as const,
      status: "generated" as const,
      actor: caseItem.owner || "Operations",
      createdAt: `${caseItem.dueDate}T09:00:00.000Z`,
      readonly: true,
      reviewable: false,
    }));

  if (hasCompletedAction(caseItem.id, "approve-packet", currentSnapshot)) {
    const approvalAction = getClientPortalActivity(caseItem.id, currentSnapshot).find(
      (action) => action.type === "approve-packet",
    );
    rows.push({
      id: `archive-${caseItem.id}-client-packet-approval`,
      caseId: caseItem.id,
      companyName: caseItem.companyName,
      contactName: caseItem.contactName,
      title: "Client packet approval",
      filename: `${caseItem.id}-client-packet-approval.txt`,
      category: "packet",
      source: "client-portal",
      status: "generated",
      actor: approvalAction?.actor ?? caseItem.contactName,
      createdAt: approvalAction?.createdAt ?? nowStamp(),
      readonly: true,
      reviewable: false,
    });
  }

  if (caseItem.submission) {
    rows.push({
      id: `archive-${caseItem.id}-submission`,
      caseId: caseItem.id,
      companyName: caseItem.companyName,
      contactName: caseItem.contactName,
      title: "Filing submission reference",
      filename: `${caseItem.submission.reference}.txt`,
      category: "submission",
      source: "filing-submission",
      status: "generated",
      actor: caseItem.submission.submittedBy,
      createdAt: caseItem.submission.submittedAt,
      readonly: true,
      reviewable: false,
    });
  }

  if (caseItem.receipt) {
    rows.push({
      id: `archive-${caseItem.id}-receipt`,
      caseId: caseItem.id,
      companyName: caseItem.companyName,
      contactName: caseItem.contactName,
      title: "Companies Registry receipt",
      filename: `${caseItem.receipt.receiptNumber}.pdf`,
      category: "receipt",
      source: "filing-receipt",
      status: "accepted",
      actor: caseItem.receipt.acceptedBy,
      createdAt: caseItem.receipt.acceptedAt,
      readonly: true,
      reviewable: false,
    });
  }

  return rows;
}

export function getDocumentArchiveRows(
  cases: AnnualReturnCase[],
  currentSnapshot = snapshot,
): ClientPortalArchiveRow[] {
  const casesById = new Map(cases.map((caseItem) => [caseItem.id, caseItem] as const));
  const caseIds = new Set(casesById.keys());

  return [
    ...currentSnapshot.documents
      .filter((document) => caseIds.has(document.caseId))
      .map((document) => rowFromDocument(document, casesById.get(document.caseId))),
    ...cases.flatMap((caseItem) => generatedRowsForCase(caseItem, currentSnapshot)),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function documentReviewFollowUpId(documentId: string): string {
  return `document-review-follow-up-${documentId}`;
}

function isCurrentRejectedDocument(
  document: ClientPortalDocument,
  currentSnapshot = snapshot,
): boolean {
  if (document.status !== "rejected") return false;
  if (!document.requirementId) return false;
  return getCurrentClientDocument(document.caseId, document.requirementId, currentSnapshot)?.id === document.id;
}

function documentReviewFollowUpMessage(
  caseItem: AnnualReturnCase,
  document: ClientPortalDocument,
): string {
  const reason = document.reviewReasonLabel
    ? `the ${document.reviewReasonLabel.charAt(0).toLowerCase()}${document.reviewReasonLabel.slice(1)}`
    : "the document needs changes";
  const note = document.reviewNote ? ` Note: ${document.reviewNote}` : "";

  return `Hi ${caseItem.contactName}, we reviewed ${document.title} for ${caseItem.companyName} and need a replacement because ${reason}.${note} Please upload a corrected file in the portal.`;
}

function followUpBlockedReason(caseItem: AnnualReturnCase): string | undefined {
  return isReadOnlyCase(caseItem) ? "Filed cases cannot send follow-ups" : undefined;
}

export function getDocumentReviewFollowUpDrafts(
  cases: AnnualReturnCase[],
  currentSnapshot = snapshot,
): ClientPortalDocumentReviewFollowUpDraft[] {
  const casesById = new Map(cases.map((caseItem) => [caseItem.id, caseItem] as const));
  const sentByDraftId = new Map(
    currentSnapshot.documentReviewFollowUps.map((followUp) => [followUp.draftId, followUp] as const),
  );

  return currentSnapshot.documents
    .filter((document) => {
      if (document.source !== "client-portal") return false;
      if (!document.reviewReasonCode || !document.reviewReasonLabel) return false;
      if (!casesById.has(document.caseId)) return false;
      return isCurrentRejectedDocument(document, currentSnapshot);
    })
    .map((document) => {
      const caseItem = casesById.get(document.caseId);
      if (!caseItem || !document.reviewReasonCode || !document.reviewReasonLabel) {
        throw new Error("Expected rejected document follow-up inputs to be complete");
      }

      const id = documentReviewFollowUpId(document.id);
      const sent = sentByDraftId.get(id);
      const blockedReason = sent ? undefined : followUpBlockedReason(caseItem);

      return {
        id,
        caseId: caseItem.id,
        documentId: document.id,
        requirementId: document.requirementId,
        companyName: caseItem.companyName,
        recipientName: caseItem.contactName,
        phone: caseItem.phone,
        documentTitle: document.title,
        reasonCode: document.reviewReasonCode,
        reasonLabel: document.reviewReasonLabel,
        note: document.reviewNote,
        suggestedTiming: "Send now",
        messagePreview: documentReviewFollowUpMessage(caseItem, document),
        status: sent ? "sent" : blockedReason ? "blocked" : "draft",
        blockedReason,
        sentAt: sent?.sentAt,
      };
    })
    .sort((a, b) => a.companyName.localeCompare(b.companyName));
}

function createDocument(
  caseItem: AnnualReturnCase,
  requirementId: string,
  filename: string,
  actor: string,
  supersedesDocumentId?: string,
): ClientPortalDocument {
  const requirement = caseItem.documents.find((document) => document.id === requirementId);
  const title = requirement?.label ?? "Client document";

  return {
    id: `portal-doc-${caseItem.id}-${requirementId}-${Date.now()}-${snapshot.documents.length + 1}`,
    caseId: caseItem.id,
    requirementId,
    companyName: caseItem.companyName,
    contactName: caseItem.contactName,
    title,
    filename,
    category: documentCategoryForRequirement(requirementId),
    source: "client-portal",
    status: "uploaded",
    actor,
    createdAt: nowStamp(),
    supersedesDocumentId,
    reviewedBy: undefined,
    reviewedAt: undefined,
    reviewSummary: undefined,
    reviewReasonCode: undefined,
    reviewReasonLabel: undefined,
    reviewNote: undefined,
  };
}

function blockReadOnlyCase(caseItem: AnnualReturnCase): { ok: false; reason: string } | undefined {
  if (!isReadOnlyCase(caseItem)) return undefined;
  return { ok: false, reason: "Filed cases are read-only in the client portal" };
}

function getPacketApprovalBlockers(
  caseItem: AnnualReturnCase,
  currentSnapshot = snapshot,
): string[] {
  return caseItem.documents
    .filter((document) => document.required)
    .flatMap((document) => {
      const current = getCurrentClientDocument(caseItem.id, document.id, currentSnapshot);
      if (!current) return [document.label];
      if (current.status === "uploaded") return [`${document.label} pending staff review`];
      if (current.status === "rejected") return [`${document.label} rejected`];
      if (current.status !== "accepted") return [document.label];
      return [];
    });
}

function normalizeReviewInput(
  review: ClientPortalDocumentReviewDecision | ClientPortalDocumentReviewRequest,
  actor: string,
): NormalizedClientPortalReviewRequest {
  if (typeof review === "string") {
    if (review === "accepted") {
      return { ok: true, decision: "accepted", actor };
    }

    return { ok: false, reason: "Rejection reason is required" };
  }

  const reviewer = review.actor?.trim() || actor;

  if (review.decision === "accepted") {
    return { ok: true, decision: "accepted", actor: reviewer };
  }

  const reason = getClientPortalReviewReason(review.reasonCode);
  if (!reason) return { ok: false, reason: "Rejection reason is required" };

  const note = review.note?.trim();
  if (reason.code === "other" && !note) {
    return { ok: false, reason: "Review note is required when reason is Other" };
  }

  return {
    ok: true,
    decision: "rejected",
    actor: reviewer,
    reasonCode: reason.code,
    reasonLabel: reason.label,
    note,
  };
}

export function reviewClientDocument(
  documentId: string,
  review: ClientPortalDocumentReviewDecision | ClientPortalDocumentReviewRequest,
  actor = "Operations",
): { ok: true; documentId: string } | { ok: false; reason: string } {
  const normalized = normalizeReviewInput(review, actor);
  if (!normalized.ok) return normalized;

  const document = snapshot.documents.find((candidate) => candidate.id === documentId);
  if (!document) return { ok: false, reason: "Document not found" };
  if (document.source !== "client-portal") {
    return { ok: false, reason: "Only client portal documents can be reviewed" };
  }
  if (document.status === "superseded") {
    return { ok: false, reason: "Superseded documents cannot be reviewed" };
  }
  if (document.status === "accepted" || document.status === "rejected") {
    return { ok: false, reason: "Document has already been reviewed" };
  }
  if (document.status !== "uploaded") {
    return { ok: false, reason: "Document is not ready for review" };
  }
  const caseItem = getAnnualReturnCaseById(document.caseId);
  if (caseItem && isReadOnlyCase(caseItem)) {
    return { ok: false, reason: "Filed cases are read-only in the client portal" };
  }

  const reviewedAt = nowStamp();
  const status = normalized.decision;
  const actionType: ClientPortalActionType =
    normalized.decision === "accepted" ? "accept-document" : "reject-document";
  const reviewSummary =
    normalized.decision === "accepted"
      ? `Accepted by ${normalized.actor}`
      : `Rejected by ${normalized.actor}: ${normalized.reasonLabel}`;
  const summary =
    normalized.decision === "accepted"
      ? `${normalized.actor} accepted ${document.title}.`
      : `${normalized.actor} rejected ${document.title}: ${normalized.reasonLabel}.`;

  snapshot = {
    ...snapshot,
    documents: snapshot.documents.map((candidate) =>
      candidate.id === document.id
        ? {
            ...candidate,
            status,
            reviewedBy: normalized.actor,
            reviewedAt,
            reviewSummary,
            reviewReasonCode:
              normalized.decision === "rejected" ? normalized.reasonCode : undefined,
            reviewReasonLabel:
              normalized.decision === "rejected" ? normalized.reasonLabel : undefined,
            reviewNote: normalized.decision === "rejected" ? normalized.note : undefined,
          }
        : candidate,
    ),
  };

  addActionForCase(document.caseId, actionType, normalized.actor, summary);

  if (document.requirementId) {
    if (normalized.decision === "accepted") {
      markDocumentReceived(document.caseId, document.requirementId);
    } else {
      markDocumentMissing(document.caseId, document.requirementId);
    }
  }

  appendClientPortalTimelineEvent(
    document.caseId,
    normalized.decision === "accepted" ? "Client document accepted" : "Client document rejected",
    summary,
  );
  emit();

  return { ok: true, documentId: document.id };
}

export function uploadClientDocument(
  caseItem: AnnualReturnCase,
  requirementId: string,
  filename: string,
  actor = caseItem.contactName,
): { ok: true; documentId: string } | { ok: false; reason: string } {
  const readOnly = blockReadOnlyCase(caseItem);
  if (readOnly) return readOnly;

  const requirement = caseItem.documents.find((document) => document.id === requirementId);
  if (!requirement) return { ok: false, reason: "Document requirement not found" };
  if (!filename.trim()) return { ok: false, reason: "Filename is required" };

  const document = createDocument(caseItem, requirementId, filename.trim(), actor);
  snapshot = { ...snapshot, documents: [document, ...snapshot.documents] };
  const summary = `${actor} uploaded ${requirement.label}.`;
  addAction(caseItem, "upload-document", actor, summary);
  appendClientPortalTimelineEvent(caseItem.id, "Client document uploaded", summary);
  emit();

  return { ok: true, documentId: document.id };
}

export function replaceClientDocument(
  caseItem: AnnualReturnCase,
  requirementId: string,
  filename: string,
  actor = caseItem.contactName,
): { ok: true; documentId: string; supersededDocumentId?: string } | { ok: false; reason: string } {
  const readOnly = blockReadOnlyCase(caseItem);
  if (readOnly) return readOnly;

  const requirement = caseItem.documents.find((document) => document.id === requirementId);
  if (!requirement) return { ok: false, reason: "Document requirement not found" };
  if (!filename.trim()) return { ok: false, reason: "Filename is required" };

  const current = getCurrentClientDocument(caseItem.id, requirementId);
  if (!current) return { ok: false, reason: "No current document is available to replace" };
  if (current.status !== "rejected") {
    return { ok: false, reason: "Only rejected documents can be replaced" };
  }
  const document = createDocument(caseItem, requirementId, filename.trim(), actor, current?.id);
  snapshot = {
    ...snapshot,
    documents: [
      document,
      ...snapshot.documents.map((candidate) =>
        candidate.id === current?.id ? { ...candidate, status: "superseded" as const } : candidate,
      ),
    ],
  };
  markDocumentMissing(caseItem.id, requirementId);
  const summary = `${actor} replaced ${requirement.label}.`;
  addAction(caseItem, "replace-document", actor, summary);
  appendClientPortalTimelineEvent(caseItem.id, "Client document replaced", summary);
  emit();

  return { ok: true, documentId: document.id, supersededDocumentId: current?.id };
}

export function sendDocumentReviewFollowUpNow(
  draftId: string,
  actor = "Operations",
): { ok: true } | { ok: false; reason: string } {
  const documentId = draftId.replace(/^document-review-follow-up-/, "");
  const document = snapshot.documents.find((candidate) => candidate.id === documentId);
  if (!document) return { ok: false, reason: "The rejected document is no longer current" };

  const caseItem = getAnnualReturnCaseById(document.caseId);
  if (!caseItem) return { ok: false, reason: "Case not found" };

  const draft = getDocumentReviewFollowUpDrafts([caseItem]).find((candidate) => candidate.id === draftId);
  if (!draft) return { ok: false, reason: "The rejected document is no longer current" };
  if (draft.status === "sent") return { ok: false, reason: "Follow-up already sent" };
  if (draft.status === "blocked") {
    return { ok: false, reason: draft.blockedReason ?? "Follow-up cannot be sent" };
  }

  const sentAt = nowStamp();
  const sendRecord: ClientPortalDocumentReviewFollowUpSend = {
    id: `document-review-follow-up-send-${document.id}-${Date.now()}-${snapshot.documentReviewFollowUps.length + 1}`,
    draftId,
    documentId: document.id,
    caseId: caseItem.id,
    actor,
    sentAt,
  };

  snapshot = {
    ...snapshot,
    documentReviewFollowUps: [sendRecord, ...snapshot.documentReviewFollowUps],
  };

  const summary = `${actor} sent a document replacement follow-up for ${document.title}.`;
  addActionForCase(caseItem.id, "send-document-review-follow-up", actor, summary, {
    documentId: document.id,
    draftId,
  });
  appendClientPortalTimelineEvent(caseItem.id, "Document replacement follow-up sent", summary);
  emit();

  return { ok: true };
}

export function acknowledgePaymentInstructions(
  caseItem: AnnualReturnCase,
  actor = caseItem.contactName,
): { ok: true } | { ok: false; reason: string } {
  if (hasCompletedAction(caseItem.id, "acknowledge-payment")) return { ok: true };

  const readOnly = blockReadOnlyCase(caseItem);
  if (readOnly) return readOnly;

  const summary = `${actor} acknowledged payment instructions.`;
  const { inserted } = addActionOnce(caseItem, "acknowledge-payment", actor, summary);
  if (!inserted) return { ok: true };

  appendClientPortalTimelineEvent(caseItem.id, "Payment instructions acknowledged", summary);
  emit();

  return { ok: true };
}

export function approveClientPacket(
  caseItem: AnnualReturnCase,
  actor = caseItem.contactName,
): { ok: true } | { ok: false; reason: string } {
  if (hasCompletedAction(caseItem.id, "approve-packet")) return { ok: true };

  const readOnly = blockReadOnlyCase(caseItem);
  if (readOnly) return readOnly;

  const missingDocuments = getPacketApprovalBlockers(caseItem);
  if (missingDocuments.length > 0) {
    return { ok: false, reason: `Packet approval blocked: ${missingDocuments.join("; ")}` };
  }

  const summary = `${actor} approved the filing packet.`;
  const { inserted } = addActionOnce(caseItem, "approve-packet", actor, summary);
  if (!inserted) return { ok: true };

  appendClientPortalTimelineEvent(caseItem.id, "Client packet approved", summary);
  emit();

  return { ok: true };
}

export function recordReceiptViewed(
  caseItem: AnnualReturnCase,
  actor = caseItem.contactName,
): { ok: true } | { ok: false; reason: string } {
  if (!caseItem.receipt) return { ok: false, reason: "No filing receipt is available" };

  const summary = `${actor} viewed filing receipt ${caseItem.receipt.receiptNumber}.`;
  const { inserted } = addActionOnce(caseItem, "view-receipt", actor, summary);
  if (!inserted) return { ok: true };

  appendClientPortalTimelineEvent(caseItem.id, "Client viewed receipt", summary);
  emit();

  return { ok: true };
}
