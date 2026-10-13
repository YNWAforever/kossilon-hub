import { pageTitle } from "@/lib/page-title";
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
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/whatsapp/automation")({
  head: () => ({ meta: [{ title: pageTitle("WhatsApp 追件") }] }),
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
  const { dataMode, actor } = Route.useRouteContext();
  return dataMode === "demo" ? (
    <DemoWhatsAppAutomationRoute />
  ) : (
    <ProductionWhatsAppAutomation
      actorScope={JSON.stringify(actor)}
      canBulk={actor?.active === true && (actor.role === "Admin" || actor.role === "Manager")}
    />
  );
}

function DemoWhatsAppAutomationRoute() {
  const cases = useAnnualReturnCases();
  const portalSnapshot = useClientPortalSnapshot();
  const [filter, setFilter] = useState<"open" | "sent" | "all">("open");

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
        eyebrow="通訊"
        title="WhatsApp 追件"
        actions={(["open", "sent", "all"] as const).map((value) => (
          <Button
            key={value}
            variant={filter === value ? "primary" : "outline"}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            type="button"
          >
            {value === "open" ? "待發送" : value === "sent" ? "已發送" : "全部"}
          </Button>
        ))}
      />

      {/* Said once, up front: a live-looking Send button that only answered
          with a warning read as a failed send rather than a read-only demo. */}
      <p
        className="rounded-md bg-status-yellow-soft px-3 py-2 text-sm text-status-yellow-text"
        role="status"
      >
        唯讀示範。正式環境的跟進訊息由通知發送佇列派發。
      </p>

      <section className="rounded-lg border bg-card">
        <div className="hidden grid-cols-[1.2fr_1fr_140px_120px_110px_minmax(0,1.5fr)_120px] gap-3 border-b px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:grid">
          <span>公司</span>
          <span>收件人</span>
          <span>類型</span>
          <span>時間</span>
          <span>狀態</span>
          <span>預覽</span>
          <span className="text-right">操作</span>
        </div>

        <div className="divide-y">
          {visibleRows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">沒有符合此篩選條件的跟進。</p>
          ) : (
            visibleRows.map((row) => <AutomationRow key={`${row.source}-${row.id}`} row={row} />)
          )}
        </div>
      </section>
    </main>
  );
}

function AutomationRow({ row }: { row: AutomationQueueRow }) {
  const { caseItem, draft } = row;
  const reasonLabel = "reasonLabel" in draft ? draft.reasonLabel : "周年申報跟進";

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
      <Field label="收件人" value={`${draft.recipientName} / ${draft.phone}`} />
      <Field label="類型" value={automationTypeLabel(row)} />
      <Field
        label="時間"
        value={row.source === "annual-return" ? draft.suggestedTiming : reasonLabel}
      />
      <Field
        label="狀態"
        value={
          <span
            className={`inline-flex rounded-md px-2 py-1 text-xs font-medium ${statusToneClass(draft.status)}`}
          >
            {statusLabel(draft.status)}
          </span>
        }
      />
      <Field label="預覽" value={draft.messagePreview} />
      <div className="flex justify-start lg:justify-end">
        <Button disabled type="button">
          {draft.status === "sent" ? "已發送" : draft.status === "blocked" ? "受阻" : "立即發送"}
        </Button>
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
  if (row.source === "payment-proof-review") return "更換付款證明";
  if (row.source === "document-review") return "更換文件";
  return followUpTypeLabel(row.draft.type);
}

function followUpTypeLabel(type: AnnualReturnFollowUpDraft["type"]): string {
  return {
    "missing-document": "文件",
    "payment-reminder": "付款",
    "signature-nudge": "簽署",
    "review-escalation": "覆核",
    "packet-reminder": "交件套件",
  }[type];
}

function statusLabel(status: AnnualReturnFollowUpDraft["status"]): string {
  return {
    draft: "草稿",
    sent: "已發送",
    blocked: "受阻",
  }[status];
}

function statusToneClass(status: AnnualReturnFollowUpDraft["status"]): string {
  return {
    draft: "bg-slate-100 text-slate-700",
    sent: "bg-green-100 text-green-700",
    blocked: "bg-yellow-100 text-yellow-800",
  }[status];
}
