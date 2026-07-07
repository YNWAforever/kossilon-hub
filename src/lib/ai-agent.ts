import { checklistTemplates, daysUntil, type ClientCase, type Enquiry } from "./app-data";
import { type AnnualReturnAiContext } from "./annual-return-store";
import { type FaqEntry, type ReferenceDocument } from "./knowledge-base";

export type RetrievalContext = {
  faqs: Array<{ item: FaqEntry; score: number }>;
  documents: Array<{ item: ReferenceDocument; score: number }>;
  checklistItems: string[];
  caseFields: string[];
};

export type DraftReply = {
  markdown: string;
  confidence: number;
  sources: Array<{
    id: string;
    label: string;
    type: "FAQ" | "Document" | "Checklist" | "Case";
    preview: string;
  }>;
};

const categoryBoost: Record<Enquiry["intent"], string[]> = {
  "Annual Return": ["annual", "return", "nar1", "deadline", "registry"],
  Incorporation: ["incorporation", "company", "setup", "kyc", "fees"],
  Payment: ["payment", "invoice", "fps", "bank", "receipt"],
  Deregistration: ["deregistration", "tax", "clearance", "liabilities"],
  KYC: ["kyc", "identity", "address", "owner"],
  General: ["company", "secretary", "service", "documents"],
};

const annualReturnStatusLabels: Record<AnnualReturnAiContext["status"], string> = {
  preparing: "Preparing",
  "waiting-documents": "Waiting documents",
  "payment-pending": "Payment pending",
  "internal-review": "Internal review",
  "ready-to-file": "Ready to file",
  filed: "Filed",
};

const annualReturnPaymentStatusLabels: Record<AnnualReturnAiContext["paymentStatus"], string> = {
  pending: "Pending",
  paid: "Paid",
  overdue: "Overdue",
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((word) => word.length > 2);
}

function scoreText(query: string[], target: string, boosts: string[]): number {
  const targetWords = new Set(tokenize(target));
  const queryScore = query.reduce((sum, word) => sum + (targetWords.has(word) ? 2 : 0), 0);
  const boostScore = boosts.reduce((sum, word) => sum + (targetWords.has(word) ? 1 : 0), 0);
  return queryScore + boostScore;
}

export function retrieveContext(
  enquiry: Enquiry,
  faqs: FaqEntry[],
  docs: ReferenceDocument[],
  clientCase?: ClientCase,
): RetrievalContext {
  const boosts = categoryBoost[enquiry.intent];
  const query = tokenize(`${enquiry.intent} ${enquiry.lastMessage} ${boosts.join(" ")}`);

  const scoredFaqs = faqs
    .filter((faq) => faq.active)
    .map((faq) => ({
      item: faq,
      score: scoreText(
        query,
        `${faq.question} ${faq.answer} ${faq.category} ${faq.tags.join(" ")}`,
        boosts,
      ),
    }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  const scoredDocs = docs
    .filter((doc) => doc.active)
    .map((doc) => ({
      item: doc,
      score: scoreText(
        query,
        `${doc.title} ${doc.filename} ${doc.category} ${doc.summary}`,
        boosts,
      ),
    }))
    .filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const checklistItems = clientCase
    ? (
        checklistTemplates.find((template) => template.id === clientCase.checklistTemplateId)
          ?.items ?? []
      ).slice(0, 4)
    : (checklistTemplates
        .find((template) =>
          template.name.toLowerCase().includes(enquiry.intent.toLowerCase().split(" ")[0]),
        )
        ?.items.slice(0, 3) ?? []);

  const caseFields = clientCase
    ? [
        `${clientCase.companyName} status: ${clientCase.status}`,
        `Due date: ${clientCase.dueDate}`,
        `Payment: ${clientCase.paymentStatus}`,
        `Missing documents: ${clientCase.missingDocs.length || "none"}`,
      ]
    : [];

  return { faqs: scoredFaqs, documents: scoredDocs, checklistItems, caseFields };
}

export function draftReply(
  enquiry: Enquiry,
  context: RetrievalContext,
  clientCase?: ClientCase,
  annualReturnContext?: AnnualReturnAiContext,
): DraftReply {
  const topFaq = context.faqs[0]?.item;
  const topDoc = context.documents[0]?.item;
  const annualReturnStatusLabel = annualReturnContext
    ? annualReturnStatusLabels[annualReturnContext.status]
    : undefined;
  const annualReturnPaymentStatusLabel = annualReturnContext
    ? annualReturnPaymentStatusLabels[annualReturnContext.paymentStatus]
    : undefined;
  const existingBasicClientCaseLine = clientCase
    ? `\n\nFor **${clientCase.companyName}**, the current case status is **${clientCase.status}**. The filing due date is **${clientCase.dueDate}** (${daysUntil(clientCase.dueDate)} days from today). ${
        clientCase.missingDocs.length
          ? `We are still missing: **${clientCase.missingDocs.join(", ")}**.`
          : "All required documents are currently marked as received."
      } Payment status: **${clientCase.paymentStatus}**.`
    : "";
  const enrichedCaseLine = annualReturnContext
    ? `\n\nFor **${annualReturnContext.companyName}**, owner **${annualReturnContext.owner}** is currently tracking **${annualReturnStatusLabel}**. The filing due date is **${annualReturnContext.dueDate}** (${annualReturnContext.daysToDue} days from today), readiness is **${annualReturnContext.readinessScore}%**, and the next action is **${annualReturnContext.nextAction}**. ${
        annualReturnContext.blockers.length
          ? `Current blockers: **${annualReturnContext.blockers.map((blocker) => blocker.label).join(", ")}**.`
          : "No blockers are currently open."
      } Payment status: **${annualReturnPaymentStatusLabel}**.`
    : "";
  const caseLine = enrichedCaseLine || existingBasicClientCaseLine;

  const ctaByIntent: Record<Enquiry["intent"], string> = {
    "Annual Return":
      "Please send the remaining documents or confirm the particulars, and we can continue the NAR1 filing.",
    Incorporation:
      "Share the preferred company name and director/shareholder details, and we can prepare a fixed quote.",
    Payment: "Please send the payment proof after transfer so we can match it against the invoice.",
    Deregistration:
      "We can first check tax clearance and outstanding liabilities, then confirm the deregistration steps.",
    KYC: "Please send the KYC documents and we will review them before the next filing step.",
    General: "Send us the latest details and we will route this to the right compliance workflow.",
  };

  const markdown = `Hi ${enquiry.name},\n\n${topFaq?.answer ?? "Thanks for your message. We can help review the company record and confirm the next compliance step."}${caseLine}\n\n${topDoc ? `I also checked our **${topDoc.title}** reference for the current handling notes. ` : ""}${ctaByIntent[enquiry.intent]}\n\nRegards,\nKossilon team`;

  const sources: DraftReply["sources"] = [
    ...context.faqs.slice(0, 3).map(({ item }) => ({
      id: item.id,
      type: "FAQ" as const,
      label: item.question,
      preview: item.answer,
    })),
    ...context.documents.slice(0, 2).map(({ item }) => ({
      id: item.id,
      type: "Document" as const,
      label: item.title,
      preview: item.summary,
    })),
    ...context.checklistItems.slice(0, 2).map((item, index) => ({
      id: `checklist-${index}`,
      type: "Checklist" as const,
      label: item,
      preview: "Checklist template item used to shape the next-step request.",
    })),
    ...(annualReturnContext
      ? annualReturnContext.blockers.slice(0, 4).map((blocker) => ({
          id: `annual-return-${blocker.id}`,
          type: "Case" as const,
          label: blocker.label,
          preview: blocker.action,
        }))
      : []),
    ...context.caseFields.slice(0, 4).map((field, index) => ({
      id: `case-${index}`,
      type: "Case" as const,
      label: field,
      preview: "Live case field from the linked client record.",
    })),
  ];

  const confidence = Math.min(
    96,
    70 +
      context.faqs.length * 4 +
      context.documents.length * 3 +
      (annualReturnContext || clientCase ? 8 : 0),
  );

  return { markdown, confidence, sources };
}

export function suggestedFaqs(enquiry: Enquiry, faqs: FaqEntry[]): FaqEntry[] {
  return retrieveContext(enquiry, faqs, [], undefined)
    .faqs.slice(0, 3)
    .map((match) => match.item);
}
