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
  | "overdue"
  | "due-soon"
  | "blocked"
  | "healthy"
  | "ready-to-file"
  | "filed";

export type AnnualReturnPaymentStatus = "pending" | "paid" | "overdue";
export type AnnualReturnSignatureStatus = "missing" | "requested" | "received";
export type AnnualReturnReviewStatus = "not-started" | "in-review" | "approved";
export type AnnualReturnPacketStatus =
  | "not-started"
  | "building"
  | "ready-for-review"
  | "approved"
  | "submitted"
  | "accepted";

export type AnnualReturnPacketRequirement = {
  id: string;
  label: string;
  complete: boolean;
  required: boolean;
};

export type AnnualReturnSubmission = {
  reference: string;
  submittedAt: string;
  submittedBy: string;
};

export type AnnualReturnReceipt = {
  receiptNumber: string;
  acceptedAt: string;
  acceptedBy: string;
};

export type AnnualReturnFollowUpType =
  | "missing-document"
  | "payment-reminder"
  | "signature-nudge"
  | "review-escalation"
  | "packet-reminder";

export type AnnualReturnFollowUpStatus = "draft" | "sent" | "blocked";

export type AnnualReturnFollowUpDraft = {
  id: string;
  caseId: string;
  companyName: string;
  type: AnnualReturnFollowUpType;
  recipientName: string;
  phone: string;
  suggestedTiming: string;
  messagePreview: string;
  status: AnnualReturnFollowUpStatus;
  blockedReason?: string;
};

export type AnnualReturnSentFollowUp = Omit<
  AnnualReturnFollowUpDraft,
  "status" | "blockedReason"
> & {
  sentAt: string;
};

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
  packetRequirements: AnnualReturnPacketRequirement[];
  submission?: AnnualReturnSubmission;
  receipt?: AnnualReturnReceipt;
  sentFollowUpIds: string[];
  sentFollowUps: AnnualReturnSentFollowUp[];
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

export type AnnualReturnMutationResult = { ok: true } | { ok: false; reason: string };

function cloneAnnualReturnCase(caseItem: AnnualReturnCase): AnnualReturnCase {
  return {
    ...caseItem,
    documents: caseItem.documents.map((document) => ({ ...document })),
    checklist: caseItem.checklist.map((item) => ({ ...item })),
    packetRequirements: caseItem.packetRequirements.map((requirement) => ({ ...requirement })),
    submission: caseItem.submission ? { ...caseItem.submission } : undefined,
    receipt: caseItem.receipt ? { ...caseItem.receipt } : undefined,
    sentFollowUpIds: [...caseItem.sentFollowUpIds],
    sentFollowUps: caseItem.sentFollowUps.map((followUp) => ({ ...followUp })),
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

function createDefaultPacketRequirements(
  overrides: Partial<Record<string, boolean>> = {},
): AnnualReturnPacketRequirement[] {
  const requirements = [
    ["nar1-draft", "NAR1 draft prepared"],
    ["company-particulars", "Company particulars checked"],
    ["scr-confirmed", "Significant controller register confirmed"],
    ["signed-nar1-attached", "Signed NAR1 attached"],
    ["payment-proof-checked", "Payment proof checked"],
    ["internal-filing-review", "Internal filing review approved"],
  ] as const;

  return requirements.map(([id, label]) => ({
    id,
    label,
    complete: overrides[id] ?? false,
    required: true,
  }));
}

function createReadyPacketRequirements(): AnnualReturnPacketRequirement[] {
  return createDefaultPacketRequirements({
    "nar1-draft": true,
    "company-particulars": true,
    "scr-confirmed": true,
    "signed-nar1-attached": true,
    "payment-proof-checked": true,
    "internal-filing-review": true,
  });
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
    packetRequirements:
      client.status === "Filed" || client.status === "Ready to file"
        ? createReadyPacketRequirements()
        : createDefaultPacketRequirements(),
    submission:
      client.status === "Filed"
        ? {
            reference: `NAR1-${client.annualReturnCaseId.toUpperCase()}-2026`,
            submittedAt: `${client.dueDate}T10:00:00.000Z`,
            submittedBy: owner,
          }
        : undefined,
    receipt:
      client.status === "Filed"
        ? {
            receiptNumber: `CR-${client.annualReturnCaseId.toUpperCase()}-2026`,
            acceptedAt: `${client.dueDate}T16:00:00.000Z`,
            acceptedBy: owner,
          }
        : undefined,
    sentFollowUpIds: [],
    sentFollowUps: [],
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
    packetRequirements: createDefaultPacketRequirements(),
    sentFollowUpIds: [],
    sentFollowUps: [],
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
    packetRequirements: createDefaultPacketRequirements(),
    sentFollowUpIds: [],
    sentFollowUps: [],
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

// Non-hook read for route loaders, which are not components. Returns a copy so
// a caller cannot mutate store state through the result — demo mode is
// read-only (docs/adr/0001-demo-mode-is-read-only.md).
export function getAnnualReturnCases(): AnnualReturnCase[] {
  return cloneAnnualReturnCases(cases);
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

export function removeAnnualReturnCaseForTest(caseId: string): void {
  cases = cases.filter((caseItem) => caseItem.id !== caseId);
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

export function getPacketReadiness(caseItem: AnnualReturnCase): number {
  const required = caseItem.packetRequirements.filter((requirement) => requirement.required);
  if (required.length === 0) return 100;
  const complete = required.filter((requirement) => requirement.complete).length;
  return Math.round((complete / required.length) * 100);
}

export function getPacketBlockers(caseItem: AnnualReturnCase): string[] {
  if (caseItem.status === "filed") return [];
  return caseItem.packetRequirements
    .filter((requirement) => requirement.required && !requirement.complete)
    .map((requirement) => requirement.label);
}

export function getPacketStatus(caseItem: AnnualReturnCase): AnnualReturnPacketStatus {
  if (caseItem.receipt) return "accepted";
  if (caseItem.submission) return "submitted";
  const readiness = getPacketReadiness(caseItem);
  if (readiness === 0) return "not-started";
  if (readiness === 100 && getReadinessScore(caseItem) === 100) return "approved";
  if (readiness >= 80) return "ready-for-review";
  return "building";
}

function followUpTypeForBlocker(blocker: AnnualReturnBlocker): AnnualReturnFollowUpType {
  if (blocker.type === "payment") return "payment-reminder";
  if (blocker.type === "signature") return "signature-nudge";
  if (blocker.type === "review" || blocker.type === "owner") return "review-escalation";
  return "missing-document";
}

function followUpTiming(type: AnnualReturnFollowUpType): string {
  return {
    "missing-document": "Send today",
    "payment-reminder": "Send today",
    "signature-nudge": "Send before 5pm",
    "review-escalation": "Escalate internally",
    "packet-reminder": "Review before submission",
  }[type];
}

function followUpMessagePreview(
  caseItem: AnnualReturnCase,
  type: AnnualReturnFollowUpType,
  label: string,
): string {
  if (type === "review-escalation") {
    return `${caseItem.owner}, please clear "${label}" for ${caseItem.companyName} before filing.`;
  }

  return `Hi ${caseItem.contactName}, this is Kossilon. For ${caseItem.companyName}, we still need ${label.toLowerCase()} before we can complete the annual return filing.`;
}

function hasSentFollowUp(caseItem: AnnualReturnCase, draftId: string): boolean {
  return (
    caseItem.sentFollowUpIds.includes(draftId) ||
    caseItem.sentFollowUps.some((followUp) => followUp.id === draftId)
  );
}

function toSentFollowUpDraft(followUp: AnnualReturnSentFollowUp): AnnualReturnFollowUpDraft {
  return {
    id: followUp.id,
    caseId: followUp.caseId,
    companyName: followUp.companyName,
    type: followUp.type,
    recipientName: followUp.recipientName,
    phone: followUp.phone,
    suggestedTiming: followUp.suggestedTiming,
    messagePreview: followUp.messagePreview,
    status: "sent",
  };
}

export function getFollowUpDrafts(caseItem: AnnualReturnCase): AnnualReturnFollowUpDraft[] {
  const sentFollowUpsById = new Map(
    caseItem.sentFollowUps.map((followUp) => [followUp.id, followUp] as const),
  );

  const caseBlockerDrafts = getBlockers(caseItem).map((blocker) => {
    const type = followUpTypeForBlocker(blocker);
    const id = `follow-up-${caseItem.id}-${blocker.id}`;
    const sent = hasSentFollowUp(caseItem, id);
    const blockedReason =
      caseItem.status === "filed" ? "Filed cases cannot send follow-ups" : undefined;
    const sentFollowUp = sentFollowUpsById.get(id);

    return sentFollowUp
      ? toSentFollowUpDraft(sentFollowUp)
      : ({
          id,
          caseId: caseItem.id,
          companyName: caseItem.companyName,
          type,
          recipientName: type === "review-escalation" ? caseItem.owner : caseItem.contactName,
          phone: caseItem.phone,
          suggestedTiming: followUpTiming(type),
          messagePreview: followUpMessagePreview(caseItem, type, blocker.label),
          status: sent ? "sent" : blockedReason ? "blocked" : "draft",
          blockedReason,
        } satisfies AnnualReturnFollowUpDraft);
  });

  const packetDrafts = getPacketBlockers(caseItem).map((label) => {
    const id = `follow-up-${caseItem.id}-packet-${label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")}`;
    const sent = hasSentFollowUp(caseItem, id);
    const blockedReason =
      caseItem.status === "filed" ? "Filed cases cannot send follow-ups" : undefined;
    const sentFollowUp = sentFollowUpsById.get(id);

    return sentFollowUp
      ? toSentFollowUpDraft(sentFollowUp)
      : ({
          id,
          caseId: caseItem.id,
          companyName: caseItem.companyName,
          type: "packet-reminder",
          recipientName: caseItem.owner,
          phone: caseItem.phone,
          suggestedTiming: followUpTiming("packet-reminder"),
          messagePreview: `${caseItem.owner}, packet item "${label}" is still open for ${caseItem.companyName}.`,
          status: sent ? "sent" : blockedReason ? "blocked" : "draft",
          blockedReason,
        } satisfies AnnualReturnFollowUpDraft);
  });

  const activeDraftIds = new Set([...caseBlockerDrafts, ...packetDrafts].map((draft) => draft.id));
  const historicalSentDrafts = caseItem.sentFollowUps
    .filter((followUp) => !activeDraftIds.has(followUp.id))
    .map(toSentFollowUpDraft);

  return [...caseBlockerDrafts, ...packetDrafts, ...historicalSentDrafts];
}

export function canSendFollowUp(
  caseItem: AnnualReturnCase,
  draft: AnnualReturnFollowUpDraft,
): { ok: true } | { ok: false; reason: string } {
  if (caseItem.status === "filed")
    return { ok: false, reason: "Filed cases cannot send follow-ups" };
  if (hasSentFollowUp(caseItem, draft.id) || draft.status === "sent") {
    return { ok: false, reason: "Follow-up has already been sent" };
  }
  const activeDraft = getFollowUpDrafts(caseItem).find((candidate) => candidate.id === draft.id);
  if (!activeDraft) return { ok: false, reason: "The original blocker has been resolved" };
  if (activeDraft.status === "blocked") {
    return { ok: false, reason: activeDraft.blockedReason ?? "Follow-up is blocked" };
  }
  return { ok: true };
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
