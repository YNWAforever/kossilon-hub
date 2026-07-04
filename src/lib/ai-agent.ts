// Mocked retrieval + drafting engine for the client-facing AI assistant.
// Pure functions — no network calls. Uses the knowledge base, checklist templates,
// and live case state to compose a believable draft reply.

import {
  daysUntil,
  formatDate,
  type Company,
  type Enquiry,
  type AnnualReturnCase,
} from "@/lib/mock-data";
import {
  getActiveFaqs,
  getActiveDocs,
  type FaqEntry,
  type ReferenceDoc,
} from "@/lib/knowledge-base";
import { templateForService, type ChecklistTemplate, type ServiceType } from "@/lib/templates";

export type FaqMatch = { faq: FaqEntry; score: number };
export type DocMatch = { doc: ReferenceDoc; score: number; snippet?: string };

export type CaseContext = {
  company: Company;
  case: AnnualReturnCase;
  template?: ChecklistTemplate;
};

export type RetrievedContext = {
  faqs: FaqMatch[];
  docs: DocMatch[];
  intentServiceType: ServiceType;
};

// ---- helpers ----
const tokenize = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);

const scoreOverlap = (haystack: string[], needle: string[]): number => {
  const set = new Set(haystack);
  let score = 0;
  for (const w of needle) if (set.has(w)) score += 1;
  return score;
};

const intentToService = (intent: Enquiry["intent"]): ServiceType => {
  switch (intent) {
    case "New Incorporation":
      return "Incorporation — HK Ltd";
    case "Change of Director":
      return "Change of Director";
    case "Deregistration":
      return "Deregistration";
    case "Annual Return":
    default:
      return "Annual Return — Private Ltd";
  }
};

// ---- retrieval ----
export function retrieveContext(enquiry: Enquiry): RetrievedContext {
  const query = tokenize(`${enquiry.intent} ${enquiry.lastMessage}`);

  const faqs: FaqMatch[] = getActiveFaqs()
    .map((f) => {
      const hay = tokenize(`${f.question} ${f.answer} ${f.tags.join(" ")} ${f.category}`);
      const score = scoreOverlap(hay, query) + (f.category.toLowerCase().includes(enquiry.intent.toLowerCase().split(" ")[0]) ? 1 : 0);
      return { faq: f, score };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const docs: DocMatch[] = getActiveDocs()
    .map((d) => {
      const hay = tokenize(`${d.title} ${d.summary} ${d.category}`);
      const score = scoreOverlap(hay, query);
      return { doc: d, score };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  return { faqs, docs, intentServiceType: intentToService(enquiry.intent) };
}

export function suggestedFaqs(enquiry: Enquiry): FaqEntry[] {
  return retrieveContext(enquiry).faqs.slice(0, 3).map((m) => m.faq);
}

// ---- drafting ----
export function draftReply(
  enquiry: Enquiry,
  context: RetrievedContext,
  caseCtx?: CaseContext,
): { markdown: string; confidence: number; sources: DraftSource[] } {
  const firstName = enquiry.contactName.split(" ")[0];
  const topFaq = context.faqs[0]?.faq;
  const template =
    caseCtx?.template ?? templateForService(context.intentServiceType);
  const sources: DraftSource[] = [];

  const parts: string[] = [];
  parts.push(`Hi ${firstName}, thanks for reaching out! 👋`);

  // Intent-specific opener
  if (topFaq) {
    parts.push(topFaq.answer);
    sources.push({ kind: "faq", id: topFaq.id, label: topFaq.question });
  } else {
    parts.push(
      `Happy to help with your **${enquiry.intent.toLowerCase()}** enquiry — one of our team will confirm the details shortly.`,
    );
  }

  // Live case context
  if (caseCtx) {
    const dLeft = daysUntil(caseCtx.case.dueDate);
    const missing = caseCtx.case.checklist.filter((i) => !i.received).length;
    const caseBits: string[] = [];
    caseBits.push(
      `Looking at **${caseCtx.company.name}**, your annual return is due on **${formatDate(caseCtx.case.dueDate)}** (${dLeft >= 0 ? `${dLeft} day${dLeft === 1 ? "" : "s"} to go` : `${Math.abs(dLeft)} day${Math.abs(dLeft) === 1 ? "" : "s"} overdue`}).`,
    );
    if (missing > 0) {
      caseBits.push(
        `We're still waiting on **${missing} document${missing === 1 ? "" : "s"}** from you — I can share the checklist link if that's easier.`,
      );
    } else {
      caseBits.push(`All documents are in — we're preparing the filing now. ✅`);
    }
    if (caseCtx.company.paymentStatus === "Overdue") {
      caseBits.push(`Please note the invoice (HKD ${caseCtx.company.invoiceAmount.toLocaleString()}) is overdue — we can resend it via FPS.`);
    }
    parts.push(caseBits.join(" "));
    sources.push({ kind: "case", id: caseCtx.case.id, label: `Case ${caseCtx.case.id.toUpperCase()}` });
  }

  // Template docs (if we know the service and no case context)
  if (!caseCtx && template && template.documents.length > 0) {
    const top = template.documents.slice(0, 3).map((d) => `- ${d.label}`).join("\n");
    parts.push(`To get started we'll need:\n\n${top}\n\nI can WhatsApp you the full checklist.`);
    sources.push({ kind: "template", id: template.id, label: template.name });
  }

  // Document citations
  for (const dm of context.docs.slice(0, 2)) {
    sources.push({ kind: "doc", id: dm.doc.id, label: dm.doc.title });
  }

  // CTA
  const cta =
    enquiry.intent === "New Incorporation"
      ? "Would you like me to send our incorporation package quote?"
      : enquiry.intent === "Annual Return"
        ? "Shall I share the document checklist so we can get filing?"
        : enquiry.intent === "Payment Query"
          ? "Would you like me to resend the invoice with a payment link?"
          : "Let me know how you'd like to proceed and we'll take it from there.";
  parts.push(cta);

  parts.push(`— Kossilon team`);

  const confidence = Math.min(
    0.95,
    0.55 + context.faqs.reduce((s, m) => s + m.score, 0) * 0.05 + (caseCtx ? 0.15 : 0),
  );

  return { markdown: parts.join("\n\n"), confidence, sources };
}

export type DraftSource =
  | { kind: "faq"; id: string; label: string }
  | { kind: "doc"; id: string; label: string }
  | { kind: "template"; id: string; label: string }
  | { kind: "case"; id: string; label: string };
