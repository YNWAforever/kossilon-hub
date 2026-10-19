import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

import {
  draftReply,
  retrieveContext,
  suggestedFaqs,
  type AiEnquiry,
  type DraftReply,
} from "../lib/ai-agent";
import { daysUntil, type ClientCase } from "../lib/app-data";
import { getAnnualReturnAiContext, useAnnualReturnCase } from "../lib/annual-return-store";
import { getPaymentProofAiContext, useClientPortalSnapshot } from "../lib/client-portal-store";
import { useKnowledgeBase } from "../lib/knowledge-base";

type AiAssistantPanelProps = {
  enquiry: AiEnquiry;
  clientCase?: ClientCase;
  onInsert: (draft: string) => void;
  onSend: (draft: string) => void;
};

const annualReturnStatusLabels = {
  preparing: "準備中",
  "waiting-documents": "待收文件",
  "payment-pending": "待付款",
  "internal-review": "內部覆核",
  "ready-to-file": "可遞交",
  filed: "已遞交",
} as const;

const annualReturnPaymentStatusLabels = {
  pending: "待付款",
  paid: "已付款",
  overdue: "逾期未付",
} as const;

const sourceTypeLabels: Record<DraftReply["sources"][number]["type"], string> = {
  FAQ: "常見問題",
  Document: "文件",
  Checklist: "清單",
  Case: "案件",
};

export function AiAssistantPanel({ enquiry, clientCase, onInsert, onSend }: AiAssistantPanelProps) {
  const { faqs, referenceDocs } = useKnowledgeBase();
  const contactName = enquiry.name ?? enquiry.contactName ?? "there";
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
      ? "未上載"
      : paymentProofContext.status === "rejected"
        ? `已退回${paymentProofContext.reasonLabel ? `：${paymentProofContext.reasonLabel}` : ""}`
        : paymentProofContext.status === "pending-review"
          ? "待覆核"
          : paymentProofContext.status === "accepted"
            ? "已接納"
            : "已被取代"
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
              <h2 className="font-semibold">AI 助理</h2>
              <span className="rounded-full bg-status-blue-soft px-2 py-1 text-xs font-medium text-status-blue-text">
                Kossilon AI（模擬）
              </span>
            </div>
            {draft.grounding.ungrounded ? (
              <p className="mt-1 text-sm text-status-yellow-text">
                知識庫沒有相符內容。以下為範本文字，發送前請先細閱。
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                已配對 {draft.grounding.matchedFaqs} 則常見問題及 {draft.grounding.matchedDocuments}{" "}
                份參考文件。
              </p>
            )}
          </div>
          <Button variant="outline" onClick={() => setGeneration((value) => value + 1)}>
            重新產生
          </Button>
        </div>

        <div className="max-w-none space-y-2 p-4 text-sm leading-6 text-foreground">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft.markdown}</ReactMarkdown>
        </div>

        <div className="flex flex-wrap gap-2 border-t p-4">
          <Button variant="primary" onClick={() => onInsert(draft.markdown)}>
            插入回覆框
          </Button>
          <Button variant="outline" onClick={() => onSend(draft.markdown)}>
            直接發送
          </Button>
          <Button
            variant="outline"
            onClick={() => void navigator.clipboard?.writeText(draft.markdown)}
          >
            複製
          </Button>
        </div>
      </section>

      {clientCase ? (
        <section className="rounded-lg border bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold">案件即時資料</h3>
              <p className="text-sm text-muted-foreground">{clientCase.companyName}</p>
            </div>
            <Button asChild variant="outline">
              <Link to="/annual-returns/$id" params={{ id: clientCase.annualReturnCaseId }}>
                開啟
              </Link>
            </Button>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">狀態</dt>
              <dd className="font-medium">{liveStatusLabel}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">距到期日數</dt>
              <dd className="font-medium">
                {annualReturnContext?.daysToDue ?? daysUntil(clientCase.dueDate)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">完成度</dt>
              <dd className="font-medium">
                {annualReturnContext
                  ? `${annualReturnContext.readinessScore}%`
                  : `${Math.max(0, 100 - clientCase.missingDocs.length * 25)}%`}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">付款</dt>
              <dd className="font-medium">{livePaymentStatusLabel}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">付款證明</dt>
              <dd className="font-medium">{paymentProofStatusLabel}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">阻礙事項</dt>
              <dd className="font-medium">
                {annualReturnContext?.blockers.length ?? clientCase.missingDocs.length}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">下一步</dt>
              <dd className="font-medium">{annualReturnContext?.nextAction ?? "跟進客戶"}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className="rounded-lg border bg-card p-4">
        <h3 className="font-semibold">參考來源</h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {draft.sources.map((source) => (
            <Button
              key={source.id}
              variant={expandedSource === source.id ? "primary" : "outline"}
              size="sm"
              aria-expanded={expandedSource === source.id}
              className="h-auto max-w-full shrink whitespace-normal rounded-full py-1 text-left"
              onClick={() =>
                setExpandedSource(expandedSource === source.id ? undefined : source.id)
              }
            >
              {sourceTypeLabels[source.type]}：{source.label}
            </Button>
          ))}
        </div>
        {expandedSource ? (
          <p className="mt-3 rounded-md bg-muted p-3 text-sm text-muted-foreground">
            {draft.sources.find((source) => source.id === expandedSource)?.preview}
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border bg-card p-4">
        <h3 className="font-semibold">相關常見問題</h3>
        <div className="mt-3 space-y-2">
          {relatedFaqs.map((faq) => (
            <Button
              key={faq.id}
              variant="outline"
              className="h-auto w-full justify-start whitespace-normal py-2 text-left"
              onClick={() =>
                onSend(`Hi ${contactName},\n\n${faq.answer}\n\nRegards,\nKossilon team`)
              }
            >
              {faq.question}
            </Button>
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
    // Grounding is carried through unchanged on purpose: Regenerate only
    // rewords the closing line, it does not run retrieval again. The old code
    // decremented a confidence score here, which made a cosmetic edit look
    // like a fresh evaluation.
    markdown: draft.markdown.replace(
      "\n\nRegards,\nKossilon team",
      `${variant}\n\nRegards,\nKossilon team`,
    ),
  };
}
