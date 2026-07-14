import type { DocumentCategory } from "@/features/documents/types";
import type { NotificationStatus } from "@/features/notifications/types";
import type { AnnualReturnCase } from "./types";
import { buildReminderDraft } from "./workflow";

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
  caseId: string;
  companyId: string;
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
};

export type PersistedFollowUpState = {
  recipients: PersistedFollowUpRecipient[];
  evidence: PersistedFollowUpEvidence[];
  deliveries: PersistedFollowUpDelivery[];
};

export type ProductionFollowUpDraft = {
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
  status: "draft" | "sent" | "blocked";
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
    const key = `${document.caseId}:${document.category}`;
    const candidate = current.get(key);
    if (
      !candidate ||
      Date.parse(document.uploadedAt) > Date.parse(candidate.uploadedAt) ||
      (document.uploadedAt === candidate.uploadedAt && document.documentId > candidate.documentId)
    ) {
      current.set(key, document);
    }
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
  if (delivery && ["pending", "processing", "sent"].includes(delivery.status)) return "sent";
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
): ProductionFollowUpDraft[] {
  const recipients = latestRecipientByCase(state.recipients);
  const mutableCases = cases.filter(
    (caseItem) =>
      caseItem.currentStatus !== "Filed" &&
      caseItem.currentStatus !== "Completed" &&
      !caseItem.lockedAt &&
      !caseItem.completedAt,
  );
  const casesById = new Map(mutableCases.map((caseItem) => [caseItem.id, caseItem]));
  const drafts: ProductionFollowUpDraft[] = [];

  for (const caseItem of mutableCases) {
    const recipient = recipients.get(caseItem.id);
    const identity: ProductionFollowUpIdentity = {
      source: "annual-return",
      caseId: caseItem.id,
      entityId: caseItem.id,
    };
    drafts.push({
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
      messagePreview: buildReminderDraft(caseItem),
      status: deliveryStatus(identity, state, Boolean(recipient)),
    });
  }

  for (const evidence of currentEvidence(state.evidence)) {
    const caseItem = casesById.get(evidence.caseId);
    if (!caseItem || evidence.companyId !== caseItem.companyId) continue;
    const source = evidence.category === "payment" ? "payment-proof-review" : "document-review";
    const identity: ProductionFollowUpIdentity = {
      source,
      caseId: caseItem.id,
      entityId: evidence.documentId,
    };
    const recipient = recipients.get(caseItem.id);
    drafts.push({
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

  return drafts;
}
