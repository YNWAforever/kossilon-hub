import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import {
  Sparkles,
  RefreshCw,
  ClipboardCopy,
  ArrowDown,
  FileText,
  MessageSquare,
  ClipboardList,
  Briefcase,
  Send,
  ExternalLink,
} from "lucide-react";
import type { Enquiry } from "@/lib/mock-data";
import { cases, companies, daysUntil, formatDate } from "@/lib/mock-data";
import { templateForService } from "@/lib/templates";
import {
  retrieveContext,
  draftReply,
  suggestedFaqs,
  type CaseContext,
  type DraftSource,
} from "@/lib/ai-agent";
import { useFaqs } from "@/lib/knowledge-base";
import { StatusPill } from "@/components/status-pill";
import { DeadlinePill } from "@/components/deadline-pill";
import { cn } from "@/lib/utils";

type Props = {
  enquiry: Enquiry;
  onInsert: (text: string) => void;
  onSend: (text: string) => void;
};

export function AiAssistantPanel({ enquiry, onInsert, onSend }: Props) {
  // Force re-run when regenerating (deterministic outputs otherwise).
  const [nonce, setNonce] = useState(0);
  // Ensure the panel re-renders when the KB changes.
  useFaqs();

  const caseCtx: CaseContext | undefined = useMemo(() => {
    // Match by phone across contacts of any company
    const company = companies.find((c) =>
      c.contacts.some((ct) => ct.phone.replace(/\s+/g, "") === enquiry.phone.replace(/\s+/g, "")),
    );
    if (!company) return undefined;
    const c = cases.find((k) => k.companyId === company.id);
    if (!c) return undefined;
    return { company, case: c, template: templateForService("Annual Return — Private Ltd") };
    // `companies` is a module-level import now, not reactive state, so it is not a dependency.
  }, [enquiry.phone]);

  const context = useMemo(() => {
    void nonce;
    return retrieveContext(enquiry);
  }, [enquiry, nonce]);
  const draft = useMemo(() => {
    void nonce;
    return draftReply(enquiry, context, caseCtx);
  }, [enquiry, context, caseCtx, nonce]);
  const relatedFaqs = useMemo(() => {
    void nonce;
    return suggestedFaqs(enquiry);
  }, [enquiry, nonce]);

  const copy = () => {
    navigator.clipboard?.writeText(draft.markdown);
    toast.success("Draft copied to clipboard");
  };

  return (
    <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-border bg-card lg:block">
      <div className="space-y-5 p-5">
        {/* Draft reply */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">AI draft reply</p>
                <p className="text-[10px] text-muted-foreground">
                  Kossilon AI · mocked · {(draft.confidence * 100).toFixed(0)}% match
                </p>
              </div>
            </div>
            <button
              onClick={() => setNonce((n) => n + 1)}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Regenerate"
              title="Regenerate"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="rounded-lg border border-border bg-background p-3">
            <div className="prose prose-sm max-w-none text-foreground [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_strong]:text-foreground">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft.markdown}</ReactMarkdown>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            <button
              onClick={() => {
                onInsert(draft.markdown);
                toast.success("Inserted into composer");
              }}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
            >
              <ArrowDown className="h-3 w-3" /> Insert
            </button>
            <button
              onClick={() => {
                onSend(draft.markdown);
                toast.success("Reply sent");
              }}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium hover:bg-accent"
            >
              <Send className="h-3 w-3" /> Send as-is
            </button>
            <button
              onClick={copy}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[11px] font-medium hover:bg-accent"
            >
              <ClipboardCopy className="h-3 w-3" /> Copy
            </button>
          </div>
        </section>

        {/* Sources */}
        <section>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Sources used ({draft.sources.length})
          </p>
          {draft.sources.length === 0 ? (
            <p className="text-xs text-muted-foreground">No matches — draft is generic.</p>
          ) : (
            <ul className="flex flex-wrap gap-1.5">
              {draft.sources.map((s, i) => (
                <SourceChip key={i} s={s} />
              ))}
            </ul>
          )}
        </section>

        {/* Live case context */}
        {caseCtx && (
          <section>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Live case context
            </p>
            <div className="rounded-lg border border-border bg-background p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-foreground">{caseCtx.company.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {caseCtx.company.package} · {caseCtx.company.team}
                  </p>
                </div>
                <Briefcase className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                <Stat label="Due" value={formatDate(caseCtx.case.dueDate)} />
                <Stat label="Days left" value={`${daysUntil(caseCtx.case.dueDate)}d`} />
                <Stat
                  label="Missing docs"
                  value={String(caseCtx.case.checklist.filter((i) => !i.received).length)}
                />
                <Stat label="Payment" value={caseCtx.company.paymentStatus} />
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <DeadlinePill dueDate={caseCtx.case.dueDate} />
                <Link
                  to="/annual-returns"
                  className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                >
                  Open board <ExternalLink className="h-3 w-3" />
                </Link>
              </div>
            </div>
          </section>
        )}

        {/* Related FAQs */}
        <section>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Related FAQs
          </p>
          {relatedFaqs.length === 0 ? (
            <p className="text-xs text-muted-foreground">No related FAQs.</p>
          ) : (
            <ul className="space-y-1.5">
              {relatedFaqs.map((f) => (
                <li key={f.id} className="rounded-md border border-border bg-background p-2">
                  <p className="text-xs font-medium text-foreground">{f.question}</p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-[10px] text-muted-foreground">{f.category}</span>
                    <button
                      onClick={() => {
                        onInsert(f.answer);
                        toast.success("Inserted answer");
                      }}
                      className="text-[10px] font-medium text-primary hover:underline"
                    >
                      Use answer →
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="border-t border-border pt-3 text-[10px] text-muted-foreground">
          Manage FAQs and reference documents in{" "}
          <Link to="/settings" className="text-primary hover:underline">
            Settings
          </Link>
          .
        </p>
      </div>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 font-medium tabular-nums text-foreground">{value}</p>
    </div>
  );
}

function SourceChip({ s }: { s: DraftSource }) {
  const meta =
    s.kind === "faq"
      ? { Icon: MessageSquare, tone: "green" as const, label: "FAQ" }
      : s.kind === "doc"
        ? { Icon: FileText, tone: "blue" as const, label: "Doc" }
        : s.kind === "template"
          ? { Icon: ClipboardList, tone: "yellow" as const, label: "Template" }
          : { Icon: Briefcase, tone: "orange" as const, label: "Case" };
  const { Icon } = meta;
  return (
    <li
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[10px]",
      )}
      title={s.label}
    >
      <Icon className="h-3 w-3 text-muted-foreground" />
      <span className="font-semibold text-muted-foreground">{meta.label}</span>
      <span className="truncate text-foreground">{s.label}</span>
    </li>
  );
}
