import { useSyncExternalStore } from "react";

import { clients, daysUntil, findEnquiryForClient } from "./app-data";

export type AnnualReturnStatus =
  | "preparing"
  | "waiting-documents"
  | "payment-pending"
  | "internal-review"
  | "ready-to-file"
  | "filed";

export type AnnualReturnRiskLevel =
  "overdue" | "due-soon" | "blocked" | "healthy" | "ready-to-file" | "filed";

export type AnnualReturnPaymentStatus = "pending" | "paid" | "overdue";
export type AnnualReturnSignatureStatus = "missing" | "requested" | "received";
export type AnnualReturnReviewStatus = "not-started" | "in-review" | "approved";

export type AnnualReturnDocument = {
  id: string;
  label: string;
  received: boolean;
  required: boolean;
};

export type AnnualReturnChecklistItem = {
  id: string;
  label: string;
  complete: boolean;
};

export type AnnualReturnNote = {
  id: string;
  author: string;
  body: string;
  createdAt: string;
};

export type AnnualReturnTimelineEvent = {
  id: string;
  label: string;
  detail: string;
  createdAt: string;
};

export type AnnualReturnCase = {
  id: string;
  clientId: string;
  enquiryId?: string;
  companyName: string;
  contactName: string;
  phone: string;
  owner: string;
  basisDate: string;
  dueDate: string;
  status: AnnualReturnStatus;
  documents: AnnualReturnDocument[];
  checklist: AnnualReturnChecklistItem[];
  signatureStatus: AnnualReturnSignatureStatus;
  paymentStatus: AnnualReturnPaymentStatus;
  reviewStatus: AnnualReturnReviewStatus;
  notes: AnnualReturnNote[];
  timeline: AnnualReturnTimelineEvent[];
};

export type AnnualReturnBlocker = {
  id: string;
  type: "document" | "payment" | "signature" | "review" | "owner";
  label: string;
  action: string;
};

export type AnnualReturnMetrics = {
  overdue: number;
  dueSoon: number;
  blocked: number;
  readyToFile: number;
  filed: number;
};

export type AnnualReturnTask = {
  id: string;
  caseId: string;
  companyName: string;
  owner: string;
  title: string;
  dueDate: string;
  riskLevel: AnnualReturnRiskLevel;
};

export type AnnualReturnAiContext = {
  companyName: string;
  status: AnnualReturnStatus;
  owner: string;
  dueDate: string;
  daysToDue: number;
  readinessScore: number;
  paymentStatus: AnnualReturnPaymentStatus;
  blockers: AnnualReturnBlocker[];
  nextAction: string;
};

function nowStamp(): string {
  return new Date().toISOString();
}

function cloneAnnualReturnCase(caseItem: AnnualReturnCase): AnnualReturnCase {
  return {
    ...caseItem,
    documents: caseItem.documents.map((document) => ({ ...document })),
    checklist: caseItem.checklist.map((item) => ({ ...item })),
    notes: caseItem.notes.map((note) => ({ ...note })),
    timeline: caseItem.timeline.map((event) => ({ ...event })),
  };
}

function cloneAnnualReturnCases(caseList: AnnualReturnCase[]): AnnualReturnCase[] {
  return caseList.map(cloneAnnualReturnCase);
}

function daysUntilDate(date: string, today = new Date()): number {
  const target = new Date(`${date}T00:00:00`);
  const start = new Date(today);
  start.setHours(0, 0, 0, 0);
  return Math.ceil((target.getTime() - start.getTime()) / 86_400_000);
}

function requiredDocumentsReceived(caseItem: AnnualReturnCase): boolean {
  return caseItem.documents.filter((doc) => doc.required).every((doc) => doc.received);
}

function deriveAnnualReturnStatus(caseItem: AnnualReturnCase): AnnualReturnStatus {
  if (caseItem.status === "filed") return "filed";
  if (getReadinessScore(caseItem) === 100) return "ready-to-file";
  if (!requiredDocumentsReceived(caseItem)) return "waiting-documents";
  if (caseItem.paymentStatus !== "paid") return "payment-pending";
  if (caseItem.reviewStatus !== "approved") return "internal-review";
  return "preparing";
}

function withDerivedStatus(caseItem: AnnualReturnCase): AnnualReturnCase {
  const status = deriveAnnualReturnStatus(caseItem);
  return status === caseItem.status ? caseItem : { ...caseItem, status };
}

function buildCaseFromClient(clientId: string, owner: string): AnnualReturnCase {
  const client = clients.find((candidate) => candidate.id === clientId);

  if (!client) {
    throw new Error(`Unknown client ${clientId}`);
  }

  const enquiry = findEnquiryForClient(client.id);
  const docLabels = ["Signed NAR1", "Updated significant controller register"];
  const requiredMissing = new Set(client.missingDocs);
  const createdAt = `${client.basisDate}T09:00:00.000Z`;
  const checklistItems = [
    "Confirm company particulars",
    "Collect signed NAR1",
    "Verify significant controller register",
    "Confirm filing fee payment",
    "Submit to Companies Registry",
  ];

  const paymentStatus: AnnualReturnPaymentStatus =
    client.paymentStatus === "Paid"
      ? "paid"
      : client.paymentStatus === "Overdue"
        ? "overdue"
        : "pending";

  const documents = docLabels.map((label) => ({
    id: label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
    label,
    received: !requiredMissing.has(label),
    required: true,
  }));

  const allDocsReceived = documents.every((doc) => doc.received);
  const checklist = checklistItems.map((label) => ({
    id: label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
    label,
    complete:
      label === "Confirm company particulars" ||
      (label === "Collect signed NAR1" && allDocsReceived) ||
      (label === "Verify significant controller register" &&
        documents.some(
          (doc) => doc.label === "Updated significant controller register" && doc.received,
        )) ||
      (label === "Confirm filing fee payment" && paymentStatus === "paid") ||
      client.status === "Ready to file" ||
      client.status === "Filed",
  }));

  const caseItem: AnnualReturnCase = {
    id: client.annualReturnCaseId,
    clientId: client.id,
    enquiryId: enquiry?.id,
    companyName: client.companyName,
    contactName: client.contactName,
    phone: client.phone,
    owner,
    basisDate: client.basisDate,
    dueDate: client.dueDate,
    status: client.status === "Filed" ? "filed" : "preparing",
    documents,
    checklist,
    signatureStatus: allDocsReceived ? "received" : "requested",
    paymentStatus,
    reviewStatus:
      client.status === "Filed" || client.status === "Ready to file" ? "approved" : "in-review",
    notes: [],
    timeline: [
      {
        id: `timeline-${client.annualReturnCaseId}-seed`,
        label: "Case seeded",
        detail: `Annual return case loaded for ${client.companyName}`,
        createdAt,
      },
    ],
  };

  return withDerivedStatus(caseItem);
}

function appendTimeline(
  caseItem: AnnualReturnCase,
  label: string,
  detail: string,
): AnnualReturnCase {
  return {
    ...caseItem,
    timeline: [
      {
        id: `timeline-${caseItem.id}-${Date.now()}-${caseItem.timeline.length + 1}`,
        label,
        detail,
        createdAt: nowStamp(),
      },
      ...caseItem.timeline,
    ],
  };
}

function replaceCase(
  caseId: string,
  updater: (caseItem: AnnualReturnCase) => AnnualReturnCase,
): AnnualReturnCase | undefined {
  let updatedCase: AnnualReturnCase | undefined;
  let changed = false;

  cases = cases.map((caseItem) => {
    if (caseItem.id !== caseId) {
      return caseItem;
    }
    updatedCase = updater(caseItem);
    changed = updatedCase !== caseItem;
    return updatedCase;
  });

  if (changed) {
    emit();
  }

  return updatedCase;
}

const seedAnnualReturnCases: AnnualReturnCase[] = [
  {
    id: "ar-crestview",
    clientId: "c-crestview",
    enquiryId: "wa-crestview",
    companyName: "Crestview Logistics Limited",
    contactName: "Samuel Cheng",
    phone: "+852 9555 1122",
    owner: "Calvin Ho",
    basisDate: "2026-05-01",
    dueDate: "2026-06-10",
    status: "waiting-documents",
    documents: [
      { id: "signed-nar1", label: "Signed NAR1", received: false, required: true },
      {
        id: "scr",
        label: "Updated significant controller register",
        received: true,
        required: true,
      },
    ],
    checklist: [
      { id: "confirm-particulars", label: "Confirm company particulars", complete: true },
      { id: "collect-signed-nar1", label: "Collect signed NAR1", complete: false },
      { id: "verify-scr", label: "Verify significant controller register", complete: true },
      { id: "confirm-payment", label: "Confirm filing fee payment", complete: false },
      { id: "submit-registry", label: "Submit to Companies Registry", complete: false },
    ],
    signatureStatus: "missing",
    paymentStatus: "overdue",
    reviewStatus: "not-started",
    notes: [],
    timeline: [
      {
        id: "timeline-ar-crestview-seed",
        label: "Case seeded",
        detail: "Overdue case awaiting missing signed NAR1 and payment.",
        createdAt: "2026-06-11T09:00:00.000Z",
      },
    ],
  },
  {
    id: "ar-delta",
    clientId: "c-delta",
    enquiryId: "wa-delta",
    companyName: "Delta Bloom Ventures Limited",
    contactName: "Joanna Poon",
    phone: "+852 9333 2211",
    owner: "Iris Wong",
    basisDate: "2026-06-04",
    dueDate: "2026-07-15",
    status: "waiting-documents",
    documents: [
      { id: "signed-nar1", label: "Signed NAR1", received: false, required: true },
      {
        id: "scr",
        label: "Updated significant controller register",
        received: false,
        required: true,
      },
    ],
    checklist: [
      { id: "confirm-particulars", label: "Confirm company particulars", complete: true },
      { id: "collect-signed-nar1", label: "Collect signed NAR1", complete: false },
      { id: "verify-scr", label: "Verify significant controller register", complete: false },
      { id: "confirm-payment", label: "Confirm filing fee payment", complete: false },
      { id: "submit-registry", label: "Submit to Companies Registry", complete: false },
    ],
    signatureStatus: "requested",
    paymentStatus: "pending",
    reviewStatus: "not-started",
    notes: [],
    timeline: [
      {
        id: "timeline-ar-delta-seed",
        label: "Case seeded",
        detail: "Due-soon case blocked by documents, payment, and review.",
        createdAt: "2026-07-01T09:00:00.000Z",
      },
    ],
  },
  buildCaseFromClient("c-aurora", "Mandy Lee"),
  buildCaseFromClient("c-harbour", "Iris Wong"),
  buildCaseFromClient("c-summit", "Calvin Ho"),
];

let cases = seedAnnualReturnCases;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): AnnualReturnCase[] {
  return cases;
}

export function useAnnualReturnCases(): AnnualReturnCase[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useAnnualReturnCase(caseId: string): AnnualReturnCase | undefined {
  return useAnnualReturnCases().find((caseItem) => caseItem.id === caseId);
}

export function getAnnualReturnCaseById(caseId: string): AnnualReturnCase | undefined {
  const caseItem = cases.find((candidate) => candidate.id === caseId);
  return caseItem ? cloneAnnualReturnCase(caseItem) : undefined;
}

export function resetAnnualReturnCasesForTest(): void {
  cases = cloneAnnualReturnCases(seedAnnualReturnCases);
  emit();
}

export function subscribeAnnualReturnCasesForTest(listener: () => void): () => void {
  return subscribe(listener);
}

export function getBlockers(caseItem: AnnualReturnCase): AnnualReturnBlocker[] {
  const documentBlockers = caseItem.documents
    .filter((doc) => doc.required && !doc.received)
    .map((doc) => ({
      id: `document-${doc.id}`,
      type: "document" as const,
      label: doc.label,
      action: `Request ${doc.label}`,
    }));

  const blockers: AnnualReturnBlocker[] = [...documentBlockers];

  if (caseItem.paymentStatus !== "paid") {
    blockers.push({
      id: "payment",
      type: "payment",
      label: caseItem.paymentStatus === "overdue" ? "Payment overdue" : "Payment pending",
      action: "Follow up payment",
    });
  }

  if (caseItem.signatureStatus !== "received") {
    blockers.push({
      id: "signature",
      type: "signature",
      label: caseItem.signatureStatus === "requested" ? "Signature requested" : "Signature missing",
      action: "Collect signature",
    });
  }

  if (caseItem.reviewStatus !== "approved") {
    blockers.push({
      id: "review",
      type: "review",
      label:
        caseItem.reviewStatus === "in-review"
          ? "Internal review in progress"
          : "Internal review not started",
      action: "Complete internal review",
    });
  }

  if (!caseItem.owner.trim()) {
    blockers.push({
      id: "owner",
      type: "owner",
      label: "No owner assigned",
      action: "Assign owner",
    });
  }

  return blockers;
}

export function getReadinessScore(caseItem: AnnualReturnCase): number {
  let score = 0;

  if (caseItem.documents.filter((doc) => doc.required).every((doc) => doc.received)) score += 20;
  if (caseItem.paymentStatus === "paid") score += 20;
  if (caseItem.signatureStatus === "received") score += 20;
  if (caseItem.checklist.every((item) => item.complete)) score += 20;
  if (caseItem.reviewStatus === "approved") score += 20;

  return score;
}

export function getRiskLevel(
  caseItem: AnnualReturnCase,
  today = new Date(),
): AnnualReturnRiskLevel {
  if (caseItem.status === "filed") return "filed";
  if (getReadinessScore(caseItem) === 100) return "ready-to-file";
  if (daysUntilDate(caseItem.dueDate, today) < 0) return "overdue";
  if (daysUntilDate(caseItem.dueDate, today) <= 14) return "due-soon";
  if (getBlockers(caseItem).length > 0) return "blocked";
  return "healthy";
}

export function getNextAction(caseItem: AnnualReturnCase, today = new Date()): string {
  const blockers = getBlockers(caseItem);
  if (caseItem.status === "filed") return "No action needed";
  const documentBlocker = blockers.find((blocker) => blocker.type === "document");
  if (documentBlocker) return documentBlocker.action;
  const paymentBlocker = blockers.find((blocker) => blocker.type === "payment");
  if (paymentBlocker) return paymentBlocker.action;
  const signatureBlocker = blockers.find((blocker) => blocker.type === "signature");
  if (signatureBlocker) return signatureBlocker.action;
  const reviewBlocker = blockers.find((blocker) => blocker.type === "review");
  if (reviewBlocker) return reviewBlocker.action;
  if (getReadinessScore(caseItem) === 100) return "File with Companies Registry";
  return daysUntilDate(caseItem.dueDate, today) <= 14 ? "Review due-soon case" : "Monitor case";
}

export function getCaseMetrics(
  caseList: AnnualReturnCase[],
  today = new Date(),
): AnnualReturnMetrics {
  return caseList.reduce<AnnualReturnMetrics>(
    (metrics, caseItem) => {
      const riskLevel = getRiskLevel(caseItem, today);

      if (riskLevel === "overdue") metrics.overdue += 1;
      if (riskLevel === "due-soon") metrics.dueSoon += 1;
      if (getBlockers(caseItem).length > 0) metrics.blocked += 1;
      if (riskLevel === "ready-to-file") metrics.readyToFile += 1;
      if (riskLevel === "filed") metrics.filed += 1;

      return metrics;
    },
    { overdue: 0, dueSoon: 0, blocked: 0, readyToFile: 0, filed: 0 },
  );
}

export function getCaseTasks(caseItem: AnnualReturnCase, today = new Date()): AnnualReturnTask[] {
  if (caseItem.status === "filed") {
    return [];
  }

  const riskLevel = getRiskLevel(caseItem, today);
  const blockers = getBlockers(caseItem);

  if (blockers.length === 0) {
    return [
      {
        id: `task-${caseItem.id}-next`,
        caseId: caseItem.id,
        companyName: caseItem.companyName,
        owner: caseItem.owner,
        title: getNextAction(caseItem, today),
        dueDate: caseItem.dueDate,
        riskLevel,
      },
    ];
  }

  return blockers.map((blocker) => ({
    id: `task-${caseItem.id}-${blocker.id}`,
    caseId: caseItem.id,
    companyName: caseItem.companyName,
    owner: caseItem.owner,
    title: blocker.action,
    dueDate: caseItem.dueDate,
    riskLevel,
  }));
}

export function getAnnualReturnAiContext(
  caseItem: AnnualReturnCase,
  today?: Date,
): AnnualReturnAiContext {
  const daysToDue = today ? daysUntilDate(caseItem.dueDate, today) : daysUntil(caseItem.dueDate);

  return {
    companyName: caseItem.companyName,
    status: caseItem.status,
    owner: caseItem.owner,
    dueDate: caseItem.dueDate,
    daysToDue,
    readinessScore: getReadinessScore(caseItem),
    paymentStatus: caseItem.paymentStatus,
    blockers: getBlockers(caseItem),
    nextAction: getNextAction(caseItem, today ?? new Date()),
  };
}

export function markDocumentReceived(caseId: string, documentId: string): void {
  replaceCase(caseId, (caseItem) => {
    const document = caseItem.documents.find((item) => item.id === documentId);
    if (caseItem.status === "filed") return caseItem;
    if (!document || document.received) return caseItem;

    return appendTimeline(
      withDerivedStatus({
        ...caseItem,
        documents: caseItem.documents.map((item) =>
          item.id === documentId ? { ...item, received: true } : item,
        ),
      }),
      "Document received",
      `${document.label} marked as received.`,
    );
  });
}

export function markDocumentMissing(caseId: string, documentId: string): void {
  replaceCase(caseId, (caseItem) => {
    const document = caseItem.documents.find((item) => item.id === documentId);
    if (caseItem.status === "filed") return caseItem;
    if (!document || !document.received) return caseItem;

    return appendTimeline(
      withDerivedStatus({
        ...caseItem,
        documents: caseItem.documents.map((item) =>
          item.id === documentId ? { ...item, received: false } : item,
        ),
      }),
      "Document missing",
      `${document.label} marked as missing.`,
    );
  });
}

export function updatePaymentStatus(
  caseId: string,
  paymentStatus: AnnualReturnPaymentStatus,
): void {
  replaceCase(caseId, (caseItem) => {
    if (caseItem.status === "filed") return caseItem;
    if (caseItem.paymentStatus === paymentStatus) return caseItem;

    return appendTimeline(
      withDerivedStatus({ ...caseItem, paymentStatus }),
      "Payment status updated",
      `Payment status changed to ${paymentStatus}.`,
    );
  });
}

export function completeChecklistItem(caseId: string, checklistItemId: string): void {
  replaceCase(caseId, (caseItem) => {
    const checklistItem = caseItem.checklist.find((item) => item.id === checklistItemId);
    if (caseItem.status === "filed") return caseItem;
    if (!checklistItem || checklistItem.complete) return caseItem;

    return appendTimeline(
      withDerivedStatus({
        ...caseItem,
        checklist: caseItem.checklist.map((item) =>
          item.id === checklistItemId ? { ...item, complete: true } : item,
        ),
      }),
      "Checklist completed",
      `${checklistItem.label} completed.`,
    );
  });
}

export function reopenChecklistItem(caseId: string, checklistItemId: string): void {
  replaceCase(caseId, (caseItem) => {
    const checklistItem = caseItem.checklist.find((item) => item.id === checklistItemId);
    if (caseItem.status === "filed") return caseItem;
    if (!checklistItem || !checklistItem.complete) return caseItem;

    return appendTimeline(
      withDerivedStatus({
        ...caseItem,
        checklist: caseItem.checklist.map((item) =>
          item.id === checklistItemId ? { ...item, complete: false } : item,
        ),
      }),
      "Checklist reopened",
      `${checklistItem.label} reopened.`,
    );
  });
}

export function updateSignatureStatus(
  caseId: string,
  signatureStatus: AnnualReturnSignatureStatus,
): void {
  replaceCase(caseId, (caseItem) => {
    if (caseItem.status === "filed") return caseItem;
    if (caseItem.signatureStatus === signatureStatus) return caseItem;

    return appendTimeline(
      withDerivedStatus({ ...caseItem, signatureStatus }),
      "Signature status updated",
      `Signature status changed to ${signatureStatus}.`,
    );
  });
}

export function updateReviewStatus(caseId: string, reviewStatus: AnnualReturnReviewStatus): void {
  replaceCase(caseId, (caseItem) => {
    if (caseItem.status === "filed") return caseItem;
    if (caseItem.reviewStatus === reviewStatus) return caseItem;

    return appendTimeline(
      withDerivedStatus({ ...caseItem, reviewStatus }),
      "Review status updated",
      `Review status changed to ${reviewStatus}.`,
    );
  });
}

export function assignOwner(caseId: string, owner: string): void {
  replaceCase(caseId, (caseItem) => {
    if (caseItem.owner === owner) return caseItem;

    return appendTimeline(
      { ...caseItem, owner },
      "Owner assigned",
      `Owner assigned to ${owner || "unassigned"}.`,
    );
  });
}

export function addCaseNote(caseId: string, author: string, body: string): void {
  replaceCase(caseId, (caseItem) => {
    const note: AnnualReturnNote = {
      id: `note-${caseItem.id}-${Date.now()}`,
      author,
      body,
      createdAt: nowStamp(),
    };

    return appendTimeline(
      { ...caseItem, notes: [note, ...caseItem.notes] },
      "Note added",
      `${author} added a case note.`,
    );
  });
}

export function markFiled(caseId: string): { ok: false; reason: string } | { ok: true } {
  const caseItem = cases.find((candidate) => candidate.id === caseId);

  if (!caseItem) {
    return { ok: false, reason: "Case not found" };
  }

  if (getReadinessScore(caseItem) < 100) {
    return { ok: false, reason: "Case is not ready to file" };
  }

  replaceCase(caseId, (currentCase) =>
    appendTimeline(
      { ...currentCase, status: "filed" },
      "Case filed",
      "Annual return filed with Companies Registry.",
    ),
  );

  return { ok: true };
}
