import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "@tanstack/react-router";

import { draftReply, retrieveContext, suggestedFaqs, type DraftReply } from "../lib/ai-agent";
import { daysUntil, type ClientCase, type Enquiry } from "../lib/app-data";
import { getAnnualReturnAiContext, useAnnualReturnCase } from "../lib/annual-return-store";
import { getPaymentProofAiContext, useClientPortalSnapshot } from "../lib/client-portal-store";
import { useKnowledgeBase } from "../lib/knowledge-base";

type AiAssistantPanelProps = {
  enquiry: Enquiry;
  clientCase?: ClientCase;
  onInsert: (draft: string) => void;
  onSend: (draft: string) => void;
};

const annualReturnStatusLabels = {
  preparing: "Preparing",
  "waiting-documents": "Waiting documents",
  "payment-pending": "Payment pending",
  "internal-review": "Internal review",
  "ready-to-file": "Ready to file",
  filed: "Filed",
} as const;

const annualReturnPaymentStatusLabels = {
  pending: "Pending",
  paid: "Paid",
  overdue: "Overdue",
} as const;

export function AiAssistantPanel({ enquiry, clientCase, onInsert, onSend }: AiAssistantPanelProps) {
  const { faqs, referenceDocs } = useKnowledgeBase();
  const [generation, setGeneration] = useState(1);
  const [expandedSource, setExpandedSource] = useState<string | undefined>();
  const annualReturnCase = useAnnualReturnCase(clientCase ? clientCase.annualReturnCaseId : "");
  const portalSnapshot = useClientPortalSnapshot();
  const annualReturnContext = annualReturnCase
    ? getAnnualReturnAiContext(annualReturnCase)
    : undefined;
  const paymentProofContext = clientCase
    ? getPaymentProofAiContext(clientCase.annualReturnCaseId, portalSnapshot)
    : undefined;
  const liveStatusLabel = annualReturnContext
    ? annualReturnStatusLabels[annualReturnContext.status]
    : clientCase?.status;
  const livePaymentStatusLabel = annualReturnContext
    ? annualReturnPaymentStatusLabels[annualReturnContext.paymentStatus]
    : clientCase?.paymentStatus;
  const paymentProofStatusLabel = paymentProofContext
    ? paymentProofContext.status === "not-uploaded"
      ? "Not uploaded"
      : paymentProofContext.status === "rejected"
        ? `Rejected${paymentProofContext.reasonLabel ? `: ${paymentProofContext.reasonLabel}` : ""}`
        : paymentProofContext.status === "pending-review"
          ? "Pending review"
          : paymentProofContext.status === "accepted"
            ? "Accepted"
            : "Superseded"
    : undefined;

  const context = useMemo(
    () => retrieveContext(enquiry, faqs, referenceDocs, clientCase),
    [clientCase, enquiry, faqs, referenceDocs],
  );
  const draft = useMemo(
    () =>
      tweakDraft(
        draftReply(enquiry, context, clientCase, annualReturnContext, paymentProofContext),
        generation,
      ),
    [annualReturnContext, clientCase, context, enquiry, generation, paymentProofContext],
  );
  const relatedFaqs = useMemo(() => suggestedFaqs(enquiry, faqs), [enquiry, faqs]);

  return (
    <aside className="space-y-4">
      <section className="rounded-lg border bg-card">
        <div className="flex items-start justify-between gap-3 border-b p-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">AI Assistant</h2>
              <span className="rounded-full bg-status-blue-soft px-2 py-1 text-xs font-medium text-status-blue">
                Kossilon AI mocked
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Confidence {draft.confidence}%</p>
          </div>
          <button
            className="rounded-md border px-3 py-2 text-sm"
            onClick={() => setGeneration((value) => value + 1)}
          >
            Regenerate
          </button>
        </div>

        <div className="max-w-none space-y-2 p-4 text-sm leading-6 text-foreground">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft.markdown}</ReactMarkdown>
        </div>

        <div className="flex flex-wrap gap-2 border-t p-4">
          <button
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
            onClick={() => onInsert(draft.markdown)}
          >
            Insert into composer
          </button>
          <button
            className="rounded-md border px-3 py-2 text-sm"
            onClick={() => onSend(draft.markdown)}
          >
            Send as-is
          </button>
          <button
            className="rounded-md border px-3 py-2 text-sm"
            onClick={() => void navigator.clipboard?.writeText(draft.markdown)}
          >
            Copy
          </button>
        </div>
      </section>

      {clientCase ? (
        <section className="rounded-lg border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">Live case context</h3>
              <p className="text-sm text-muted-foreground">{clientCase.companyName}</p>
            </div>
            <Link
              className="rounded-md border px-3 py-2 text-sm"
              to="/annual-returns/$id"
              params={{ id: clientCase.annualReturnCaseId }}
            >
              Open
            </Link>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Status</dt>
              <dd className="font-medium">{liveStatusLabel}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Days to due</dt>
              <dd className="font-medium">
                {annualReturnContext?.daysToDue ?? daysUntil(clientCase.dueDate)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Readiness</dt>
              <dd className="font-medium">
                {annualReturnContext
                  ? `${annualReturnContext.readinessScore}%`
                  : `${Math.max(0, 100 - clientCase.missingDocs.length * 25)}%`}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Payment</dt>
              <dd className="font-medium">{livePaymentStatusLabel}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Payment proof</dt>
              <dd className="font-medium">{paymentProofStatusLabel}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Blockers</dt>
              <dd className="font-medium">
                {annualReturnContext?.blockers.length ?? clientCase.missingDocs.length}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Next action</dt>
              <dd className="font-medium">
                {annualReturnContext?.nextAction ?? "Follow up with client"}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className="rounded-lg border bg-card p-4">
        <h3 className="font-semibold">Sources used</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {draft.sources.map((source) => (
            <button
              key={source.id}
              className="rounded-full border px-3 py-1 text-left text-xs"
              onClick={() =>
                setExpandedSource(expandedSource === source.id ? undefined : source.id)
              }
            >
              {source.type}: {source.label}
            </button>
          ))}
        </div>
        {expandedSource ? (
          <p className="mt-3 rounded-md bg-muted p-3 text-sm text-muted-foreground">
            {draft.sources.find((source) => source.id === expandedSource)?.preview}
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border bg-card p-4">
        <h3 className="font-semibold">Related FAQs</h3>
        <div className="mt-3 space-y-2">
          {relatedFaqs.map((faq) => (
            <button
              key={faq.id}
              className="w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={() =>
                onSend(`Hi ${enquiry.name},\n\n${faq.answer}\n\nRegards,\nKossilon team`)
              }
            >
              {faq.question}
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}

function tweakDraft(draft: DraftReply, generation: number): DraftReply {
  if (generation <= 1) return draft;
  const variants = [
    "\n\nI can keep this moving once you confirm the above.",
    "\n\nIf helpful, we can also summarise the outstanding items in one checklist.",
    "\n\nWe will keep the filing timeline visible while the remaining items come in.",
  ];
  const variant = variants[(generation - 2) % variants.length];
  return {
    ...draft,
    confidence: Math.max(68, draft.confidence - ((generation - 1) % 4)),
    markdown: draft.markdown.replace(
      "\n\nRegards,\nKossilon team",
      `${variant}\n\nRegards,\nKossilon team`,
    ),
  };
}
