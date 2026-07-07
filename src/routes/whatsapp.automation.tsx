import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";

import {
  getFollowUpDrafts,
  sendFollowUpNow,
  useAnnualReturnCases,
  type AnnualReturnCase,
  type AnnualReturnFollowUpDraft,
} from "../lib/annual-return-store";

export const Route = createFileRoute("/whatsapp/automation")({
  component: WhatsAppAutomationRoute,
});

function WhatsAppAutomationRoute() {
  const cases = useAnnualReturnCases();
  const [filter, setFilter] = useState<"open" | "sent" | "all">("open");
  const [warning, setWarning] = useState<string | undefined>();

  const rows = useMemo(() => {
    return cases.flatMap((caseItem) =>
      getFollowUpDrafts(caseItem).map((draft) => ({ caseItem, draft })),
    );
  }, [cases]);

  const visibleRows = rows.filter(({ draft }) => {
    if (filter === "open") return draft.status === "draft";
    if (filter === "sent") return draft.status === "sent";
    return true;
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-muted-foreground">WhatsApp</p>
          <h1 className="mt-1 text-3xl font-semibold">Automation</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {(["open", "sent", "all"] as const).map((value) => (
            <button
              key={value}
              className={`rounded-md border px-3 py-2 text-sm ${
                filter === value ? "bg-primary text-primary-foreground" : "bg-background"
              }`}
              onClick={() => setFilter(value)}
              type="button"
            >
              {value === "open" ? "Open" : value === "sent" ? "Sent" : "All"}
            </button>
          ))}
        </div>
      </div>

      {warning ? (
        <div className="rounded-md bg-status-yellow-soft px-3 py-2 text-sm text-status-yellow">
          {warning}
        </div>
      ) : null}

      <section className="rounded-lg border bg-card">
        <div className="hidden grid-cols-[1.2fr_1fr_140px_120px_minmax(0,1.5fr)_120px] gap-3 border-b px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:grid">
          <span>Company</span>
          <span>Recipient</span>
          <span>Type</span>
          <span>Timing</span>
          <span>Preview</span>
          <span className="text-right">Action</span>
        </div>

        <div className="divide-y">
          {visibleRows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No follow-ups match this filter.</p>
          ) : (
            visibleRows.map(({ caseItem, draft }) => (
              <AutomationRow
                key={draft.id}
                caseItem={caseItem}
                draft={draft}
                onSend={() => {
                  const result = sendFollowUpNow(caseItem.id, draft.id);
                  setWarning(result.ok ? undefined : result.reason);
                }}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function AutomationRow({
  caseItem,
  draft,
  onSend,
}: {
  caseItem: AnnualReturnCase;
  draft: AnnualReturnFollowUpDraft;
  onSend: () => void;
}) {
  const disabled = draft.status !== "draft";

  return (
    <div className="grid gap-3 px-4 py-4 text-sm lg:grid-cols-[1.2fr_1fr_140px_120px_minmax(0,1.5fr)_120px] lg:items-center">
      <div className="min-w-0">
        <Link
          className="font-medium hover:underline"
          to="/annual-returns/$id"
          params={{ id: caseItem.id }}
        >
          {caseItem.companyName}
        </Link>
        <p className="text-muted-foreground">{caseItem.owner}</p>
      </div>
      <Field label="Recipient" value={`${draft.recipientName} / ${draft.phone}`} />
      <Field label="Type" value={followUpTypeLabel(draft.type)} />
      <Field label="Timing" value={draft.suggestedTiming} />
      <Field label="Preview" value={draft.messagePreview} />
      <div className="flex justify-start lg:justify-end">
        <button
          className="rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
          disabled={disabled}
          onClick={onSend}
          type="button"
        >
          {draft.status === "sent" ? "Sent" : draft.status === "blocked" ? "Blocked" : "Send now"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:hidden">
        {label}
      </p>
      <p className="truncate">{value}</p>
    </div>
  );
}

function followUpTypeLabel(type: AnnualReturnFollowUpDraft["type"]): string {
  return {
    "missing-document": "Document",
    "payment-reminder": "Payment",
    "signature-nudge": "Signature",
    "review-escalation": "Review",
    "packet-reminder": "Packet",
  }[type];
}
