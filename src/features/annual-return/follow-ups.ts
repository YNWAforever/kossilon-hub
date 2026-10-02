import type { DocumentCategory } from "@/features/documents/types";
import type { NotificationStatus } from "@/features/notifications/types";
import type { AnnualReturnCase } from "./types";
import { buildReminderDraft } from "./workflow";
import { shouldChaseClient } from "./outstanding";

export const PRODUCTION_FOLLOW_UP_SOURCES = [
  "annual-return",
  "document-review",
  "payment-proof-review",
] as const;

export type ProductionFollowUpSource = (typeof PRODUCTION_FOLLOW_UP_SOURCES)[number];

export type ProductionFollowUpIdentity = {
  source: ProductionFollowUpSource;
  caseId: string;
  entityId: string;
};

export type PersistedFollowUpRecipient = {
  caseId: string;
  recipientName: string;
  recipientPhone: string;
  recordedAt: string;
};

export type PersistedFollowUpEvidence = {
  documentId: string;
  documentVersionId?: string | null;
  caseId: string;
  companyId: string;
  source: "document-review" | "payment-proof-review";
  category: DocumentCategory;
  fileName: string;
  reviewStatus: "pending" | "verified" | "rejected";
  uploadStatus: "available";
  uploadedAt: string;
  rejectionReason: string | null;
};

export type PersistedFollowUpDelivery = {
  idempotencyKey: string;
  status: NotificationStatus;
  delivery?: "provider" | "simulated" | null;
  providerMessageId?: string | null;
  messageStatus?: "queued" | "sent" | "delivered" | "read" | "failed" | null;
  lastErrorCode?: string | null;
  dispatchStarted?: boolean;
};

export type PersistedFollowUpState = {
  recipients: PersistedFollowUpRecipient[];
  evidence: PersistedFollowUpEvidence[];
  deliveries: PersistedFollowUpDelivery[];
};

export type ProductionFollowUpDraft = {
  /** Canonical observed facts, compared again by the server before queueing. */
  version: string;
  id: string;
  entityId: string;
  source: ProductionFollowUpSource;
  caseId: string;
  companyId: string;
  companyName: string;
  ownerName: string;
  recipientName: string | null;
  phone: string | null;
  reasonLabel: string;
  messagePreview: string;
  /**
   * `queued` is separate from `sent` on purpose. A row the dispatcher has not
   * finished is not a message the client has: it may be seconds old, or stranded
   * mid-dispatch awaiting the fifteen-minute reclaim, and in local or simulated
   * mode nothing will ever contact the client at all. Collapsing the two told a
   * staff member the chase had gone out when nothing had left the building.
   */
  status: "draft" | "queued" | "provider_accepted" | "delivered" | "failed" | "unknown" | "blocked";
};

export function stableFollowUpIdempotencyKey(identity: ProductionFollowUpIdentity): string {
  return `follow-up:${identity.source}:${identity.caseId}:${identity.entityId}`;
}

function latestRecipientByCase(
  recipients: readonly PersistedFollowUpRecipient[],
): Map<string, PersistedFollowUpRecipient> {
  const latest = new Map<string, PersistedFollowUpRecipient>();
  for (const recipient of recipients) {
    const current = latest.get(recipient.caseId);
    if (!current || Date.parse(recipient.recordedAt) > Date.parse(current.recordedAt)) {
      latest.set(recipient.caseId, recipient);
    }
  }
  return latest;
}

function currentEvidence(
  evidence: readonly PersistedFollowUpEvidence[],
): PersistedFollowUpEvidence[] {
  const current = new Map<string, PersistedFollowUpEvidence>();
  for (const document of evidence) {
    const key = `${document.source}:${document.caseId}:${document.documentId}`;
    if (!current.has(key)) current.set(key, document);
  }
  return [...current.values()].filter((document) => document.reviewStatus === "rejected");
}

function deliveryStatus(
  identity: ProductionFollowUpIdentity,
  state: PersistedFollowUpState,
  hasRecipient: boolean,
): ProductionFollowUpDraft["status"] {
  const stableKey = stableFollowUpIdempotencyKey(identity);
  const delivery = state.deliveries.find((candidate) => candidate.idempotencyKey === stableKey);
  if (
    delivery?.lastErrorCode === "dispatch_outcome_unknown" ||
    delivery?.lastErrorCode === "woztell_accepted_without_message_id" ||
    delivery?.dispatchStarted
  )
    return "unknown";
  if (delivery?.status === "sent") {
    if (delivery.delivery !== "provider" || !delivery.providerMessageId) return "unknown";
    return delivery.messageStatus === "delivered" || delivery.messageStatus === "read"
      ? "delivered"
      : "provider_accepted";
  }
  if (delivery?.status === "failed") return "failed";
  if (delivery && ["pending", "processing"].includes(delivery.status)) return "queued";
  if (delivery) return "blocked";
  return hasRecipient ? "draft" : "blocked";
}

function evidenceBody(
  source: "document-review" | "payment-proof-review",
  fileName: string,
  reason: string | null,
): string {
  const evidenceLabel = source === "payment-proof-review" ? "payment proof" : "document";
  const reasonText = reason ? ` Reason: ${reason}` : "";
  return `Please replace the rejected ${evidenceLabel} ${fileName}.${reasonText}`;
}

export function deriveProductionFollowUpDrafts(
  cases: readonly AnnualReturnCase[],
  state: PersistedFollowUpState,
  today: string,
): ProductionFollowUpDraft[] {
  const recipients = latestRecipientByCase(state.recipients);
  const mutableCases = cases.filter(
    (caseItem) =>
      caseItem.dataOrigin === "client" &&
      caseItem.currentStatus !== "Filed" &&
      caseItem.currentStatus !== "Completed" &&
      !caseItem.lockedAt &&
      !caseItem.completedAt,
  );
  const casesById = new Map(mutableCases.map((caseItem) => [caseItem.id, caseItem]));
  const drafts: ProductionFollowUpDraft[] = [];

  for (const caseItem of mutableCases) {
    // The loop had no outstanding-work test whatsoever, so every mutable case
    // produced a chase draft -- including cases whose client had already sent
    // everything, whose draft then listed nothing to send.
    if (!shouldChaseClient(caseItem)) continue;
    const recipient = recipients.get(caseItem.id);
    const identity: ProductionFollowUpIdentity = {
      source: "annual-return",
      caseId: caseItem.id,
      entityId: caseItem.id,
    };
    drafts.push({
      version: "",
      id: caseItem.id,
      entityId: caseItem.id,
      source: identity.source,
      caseId: caseItem.id,
      companyId: caseItem.companyId,
      companyName: caseItem.companyName,
      ownerName: caseItem.ownerName,
      recipientName: recipient?.recipientName ?? null,
      phone: recipient?.recipientPhone ?? null,
      reasonLabel: "Annual return follow-up",
      messagePreview: buildReminderDraft(caseItem, recipient?.recipientName ?? "貴公司", today),
      status: deliveryStatus(identity, state, Boolean(recipient)),
    });
  }

  for (const evidence of currentEvidence(state.evidence)) {
    const caseItem = casesById.get(evidence.caseId);
    if (!caseItem || evidence.companyId !== caseItem.companyId) continue;
    const source = evidence.source;
    const identity: ProductionFollowUpIdentity = {
      source,
      caseId: caseItem.id,
      entityId: evidence.documentId,
    };
    const recipient = recipients.get(caseItem.id);
    drafts.push({
      version: "",
      id: evidence.documentId,
      entityId: evidence.documentId,
      source,
      caseId: caseItem.id,
      companyId: caseItem.companyId,
      companyName: caseItem.companyName,
      ownerName: caseItem.ownerName,
      recipientName: recipient?.recipientName ?? null,
      phone: recipient?.recipientPhone ?? null,
      reasonLabel: evidence.rejectionReason ?? "Replacement required",
      messagePreview: evidenceBody(source, evidence.fileName, evidence.rejectionReason),
      status: deliveryStatus(identity, state, Boolean(recipient)),
    });
  }

  return drafts.map((draft) => {
    const caseItem = casesById.get(draft.caseId)!;
    const recipient = recipients.get(draft.caseId);
    const evidence =
      draft.source === "annual-return"
        ? undefined
        : state.evidence.find(
            (candidate) =>
              candidate.documentId === draft.entityId &&
              candidate.caseId === draft.caseId &&
              candidate.source === draft.source,
          );
    return {
      ...draft,
      version: JSON.stringify({
        caseVersion: caseItem.readiness?.sourceVersion ?? null,
        scope: [caseItem.companyId, caseItem.companyTeamId, caseItem.ownerId, caseItem.reviewerId],
        draft: [
          draft.source,
          draft.entityId,
          draft.recipientName,
          draft.phone,
          draft.reasonLabel,
          draft.messagePreview,
        ],
        recipientRecord: recipient?.recordedAt ?? null,
        evidence: evidence
          ? [evidence.documentVersionId ?? null, evidence.reviewStatus, evidence.uploadedAt]
          : null,
      }),
    };
  });
}
