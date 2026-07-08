import { useSyncExternalStore } from "react";

import {
  type AnnualReturnCase,
  appendClientPortalTimelineEvent,
  getPacketStatus,
  markDocumentReceived,
} from "./annual-return-store";

export type ClientPortalDocumentCategory =
  | "identity"
  | "registry"
  | "signature"
  | "payment"
  | "packet"
  | "submission"
  | "receipt"
  | "other";

export type ClientPortalDocumentSource =
  | "client-portal"
  | "staff-packet"
  | "filing-submission"
  | "filing-receipt";

export type ClientPortalDocumentStatus =
  | "required"
  | "uploaded"
  | "superseded"
  | "accepted"
  | "rejected"
  | "generated";

export type ClientPortalActionType =
  | "upload-document"
  | "replace-document"
  | "acknowledge-payment"
  | "approve-packet"
  | "view-receipt";

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
};

export type ClientPortalAction = {
  id: string;
  caseId: string;
  type: ClientPortalActionType;
  actor: string;
  status: ClientPortalActionStatus;
  summary: string;
  createdAt: string;
};

export type ClientPortalArchiveRow = {
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
  readonly: boolean;
};

export type ClientPortalRequiredAction = {
  id: string;
  caseId: string;
  kind: "document" | "payment" | "packet" | "receipt";
  label: string;
  status: "open" | "complete" | "blocked";
  detail: string;
  requirementId?: string;
};

export type ClientPortalProgress = {
  completed: number;
  total: number;
  percentage: number;
  nextAction: string;
  isReadOnly: boolean;
};

export type ClientPortalSnapshot = {
  documents: ClientPortalDocument[];
  actions: ClientPortalAction[];
};

const initialSnapshot: ClientPortalSnapshot = {
  documents: [],
  actions: [],
};

let snapshot: ClientPortalSnapshot = cloneSnapshot(initialSnapshot);
const listeners = new Set<() => void>();

function cloneSnapshot(value: ClientPortalSnapshot): ClientPortalSnapshot {
  return {
    documents: value.documents.map((document) => ({ ...document })),
    actions: value.actions.map((action) => ({ ...action })),
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
  const action: ClientPortalAction = {
    id: `portal-action-${caseItem.id}-${type}-${Date.now()}-${snapshot.actions.length + 1}`,
    caseId: caseItem.id,
    type,
    actor,
    status: "completed",
    summary,
    createdAt: nowStamp(),
  };

  snapshot = { ...snapshot, actions: [action, ...snapshot.actions] };
  return action;
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
        document.status === "uploaded",
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
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
      return {
        id: `action-${caseItem.id}-document-${document.id}`,
        caseId: caseItem.id,
        kind: "document" as const,
        label: currentDocument ? `Replace ${document.label}` : `Upload ${document.label}`,
        status: isReadOnlyCase(caseItem)
          ? ("blocked" as const)
          : currentDocument
            ? ("complete" as const)
            : ("open" as const),
        detail: currentDocument
          ? `${currentDocument.filename} is the current uploaded file.`
          : `${document.label} is required before the annual return filing can proceed.`,
        requirementId: document.id,
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
          status: isReadOnlyCase(caseItem) ? ("blocked" as const) : ("open" as const),
          detail: "Confirm the client has reviewed the prepared packet details.",
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
    getCurrentClientDocument(caseItem.id, document.id, currentSnapshot),
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
  const nextOpen = getClientPortalRequiredActions(caseItem, currentSnapshot).find(
    (action) => action.status === "open",
  );

  return {
    completed,
    total,
    percentage: total === 0 ? 100 : Math.round((completed / total) * 100),
    nextAction: nextOpen?.label ?? "No client action needed",
    isReadOnly: isReadOnlyCase(caseItem),
  };
}

function rowFromDocument(document: ClientPortalDocument): ClientPortalArchiveRow {
  return {
    id: `archive-${document.id}`,
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
    readonly: document.source !== "client-portal" || document.status === "superseded",
  };
}

function generatedRowsForCase(
  caseItem: AnnualReturnCase,
  currentSnapshot: ClientPortalSnapshot,
): ClientPortalArchiveRow[] {
  const rows = caseItem.packetRequirements
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
    });
  }

  return rows;
}

export function getDocumentArchiveRows(
  cases: AnnualReturnCase[],
  currentSnapshot = snapshot,
): ClientPortalArchiveRow[] {
  const caseIds = new Set(cases.map((caseItem) => caseItem.id));

  return [
    ...currentSnapshot.documents
      .filter((document) => caseIds.has(document.caseId))
      .map(rowFromDocument),
    ...cases.flatMap((caseItem) => generatedRowsForCase(caseItem, currentSnapshot)),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
  };
}

function blockReadOnlyCase(caseItem: AnnualReturnCase): { ok: false; reason: string } | undefined {
  if (!isReadOnlyCase(caseItem)) return undefined;
  return { ok: false, reason: "Filed cases are read-only in the client portal" };
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
  markDocumentReceived(caseItem.id, requirementId);
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
  const summary = `${actor} replaced ${requirement.label}.`;
  addAction(caseItem, "replace-document", actor, summary);
  markDocumentReceived(caseItem.id, requirementId);
  appendClientPortalTimelineEvent(caseItem.id, "Client document replaced", summary);
  emit();

  return { ok: true, documentId: document.id, supersededDocumentId: current?.id };
}

export function acknowledgePaymentInstructions(
  caseItem: AnnualReturnCase,
  actor = caseItem.contactName,
): { ok: true } | { ok: false; reason: string } {
  const readOnly = blockReadOnlyCase(caseItem);
  if (readOnly) return readOnly;

  const summary = `${actor} acknowledged payment instructions.`;
  addAction(caseItem, "acknowledge-payment", actor, summary);
  appendClientPortalTimelineEvent(caseItem.id, "Payment instructions acknowledged", summary);
  emit();

  return { ok: true };
}

export function approveClientPacket(
  caseItem: AnnualReturnCase,
  actor = caseItem.contactName,
): { ok: true } | { ok: false; reason: string } {
  const readOnly = blockReadOnlyCase(caseItem);
  if (readOnly) return readOnly;

  const missingDocuments = caseItem.documents
    .filter((document) => document.required && !getCurrentClientDocument(caseItem.id, document.id))
    .map((document) => document.label);
  if (missingDocuments.length > 0) {
    return { ok: false, reason: `Packet approval blocked: ${missingDocuments.join("; ")}` };
  }

  const summary = `${actor} approved the filing packet.`;
  addAction(caseItem, "approve-packet", actor, summary);
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
  addAction(caseItem, "view-receipt", actor, summary);
  appendClientPortalTimelineEvent(caseItem.id, "Client viewed receipt", summary);
  emit();

  return { ok: true };
}
