import { type ReactNode, useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";

import {
  getFollowUpDrafts,
  useAnnualReturnCases,
  type AnnualReturnCase,
  type AnnualReturnFollowUpDraft,
} from "../lib/annual-return-store";
import {
  getDocumentReviewFollowUpDrafts,
  getPaymentProofFollowUpDrafts,
  useClientPortalSnapshot,
  type ClientPortalDocumentReviewFollowUpDraft,
  type ClientPortalPaymentProofFollowUpDraft,
} from "../lib/client-portal-store";
import { ProductionWhatsAppAutomation } from "../features/annual-return/components/production-whatsapp-automation";
import { PageHeader } from "@/components/page-header";

export const Route = createFileRoute("/whatsapp/automation")({
  component: WhatsAppAutomationRoute,
});

type AutomationQueueRow =
  | {
      id: string;
      source: "annual-return";
      caseItem: AnnualReturnCase;
      draft: AnnualReturnFollowUpDraft;
    }
  | {
      id: string;
      source: "document-review";
      caseItem: AnnualReturnCase;
      draft: ClientPortalDocumentReviewFollowUpDraft;
    }
  | {
      id: string;
      source: "payment-proof-review";
      caseItem: AnnualReturnCase;
      draft: ClientPortalPaymentProofFollowUpDraft;
    };

function WhatsAppAutomationRoute() {
  const { dataMode } = Route.useRouteContext();
  return dataMode === "demo" ? <DemoWhatsAppAutomationRoute /> : <ProductionWhatsAppAutomation />;
}

function DemoWhatsAppAutomationRoute() {
  const cases = useAnnualReturnCases();
  const portalSnapshot = useClientPortalSnapshot();
  const [filter, setFilter] = useState<"open" | "sent" | "all">("open");
  const [warning, setWarning] = useState<string | undefined>();

  const rows = useMemo<AutomationQueueRow[]>(() => {
    const casesById = new Map(cases.map((caseItem) => [caseItem.id, caseItem] as const));
    const annualReturnRows = cases.flatMap((caseItem) =>
      getFollowUpDrafts(caseItem).map((draft) => ({
        id: draft.id,
        source: "annual-return" as const,
        caseItem,
        draft,
      })),
    );
    const documentReviewRows = getDocumentReviewFollowUpDrafts(cases, portalSnapshot).flatMap(
      (draft) => {
        const caseItem = casesById.get(draft.caseId);
        return caseItem
          ? [
              {
                id: draft.id,
                source: "document-review" as const,
                caseItem,
                draft,
              },
            ]
          : [];
      },
    );
    const paymentProofReviewRows = getPaymentProofFollowUpDrafts(cases, portalSnapshot).flatMap(
      (draft) => {
        const caseItem = casesById.get(draft.caseId);
        return caseItem
          ? [
              {
                id: draft.id,
                source: "payment-proof-review" as const,
                caseItem,
                draft,
              },
            ]
          : [];
      },
    );

    return [...annualReturnRows, ...documentReviewRows, ...paymentProofReviewRows];
  }, [cases, portalSnapshot]);

  const visibleRows = rows.filter(({ draft }) => {
    if (filter === "open") return draft.status === "draft";
    if (filter === "sent") return draft.status === "sent";
    return true;
  });

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader
        eyebrow="Messaging"
        title="WhatsApp Automation"
        actions={(["open", "sent", "all"] as const).map((value) => (
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
      />

      {warning ? (
        <div className="rounded-md bg-status-yellow-soft px-3 py-2 text-sm text-status-yellow">
          {warning}
        </div>
      ) : null}

      <section className="rounded-lg border bg-card">
        <div className="hidden grid-cols-[1.2fr_1fr_140px_120px_110px_minmax(0,1.5fr)_120px] gap-3 border-b px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:grid">
          <span>Company</span>
          <span>Recipient</span>
          <span>Type</span>
          <span>Timing</span>
          <span>Status</span>
          <span>Preview</span>
          <span className="text-right">Action</span>
        </div>

        <div className="divide-y">
          {visibleRows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No follow-ups match this filter.</p>
          ) : (
            visibleRows.map((row) => (
              <AutomationRow
                key={`${row.source}-${row.id}`}
                row={row}
                onSend={() =>
                  setWarning("Production follow-ups are dispatched by the notification outbox.")
                }
              />
            ))
          )}
        </div>
      </section>
    </main>
  );
}

function AutomationRow({ row, onSend }: { row: AutomationQueueRow; onSend: () => void }) {
  const { caseItem, draft } = row;
  const disabled = draft.status !== "draft";
  const reasonLabel = "reasonLabel" in draft ? draft.reasonLabel : "Annual return follow-up";

  return (
    <div className="grid gap-3 px-4 py-4 text-sm lg:grid-cols-[1.2fr_1fr_140px_120px_110px_minmax(0,1.5fr)_120px] lg:items-center">
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
      <Field label="Type" value={automationTypeLabel(row)} />
      <Field
        label="Timing"
        value={row.source === "annual-return" ? draft.suggestedTiming : reasonLabel}
      />
      <Field
        label="Status"
        value={
          <span
            className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${statusToneClass(draft.status)}`}
          >
            {statusLabel(draft.status)}
          </span>
        }
      />
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

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:hidden">
        {label}
      </p>
      <p className="truncate">{value}</p>
    </div>
  );
}

function automationTypeLabel(row: AutomationQueueRow): string {
  if (row.source === "payment-proof-review") return "Payment proof replacement";
  if (row.source === "document-review") return "Document replacement";
  return followUpTypeLabel(row.draft.type);
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

function statusLabel(status: AnnualReturnFollowUpDraft["status"]): string {
  return {
    draft: "Draft",
    sent: "Sent",
    blocked: "Blocked",
  }[status];
}

function statusToneClass(status: AnnualReturnFollowUpDraft["status"]): string {
  return {
    draft: "bg-slate-100 text-slate-700",
    sent: "bg-green-100 text-green-700",
    blocked: "bg-yellow-100 text-yellow-800",
  }[status];
}
