import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { annualReturnQueryKeys } from "../query-keys";
import type { ProductionFollowUpDraft } from "../follow-ups";
import type { ProductionFollowUpPreview } from "../follow-up-preview";
import {
  listProductionFollowUpDrafts,
  previewProductionFollowUp,
  sendProductionFollowUp,
} from "../follow-up-server-fns";
import { getWhatsAppIntegrationStatus } from "@/features/whatsapp/server-fns";
import { PageHeader } from "@/components/page-header";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to review follow-up.";
}
function typeLabel(source: ProductionFollowUpDraft["source"]): string {
  if (source === "document-review") return "Document replacement";
  if (source === "payment-proof-review") return "Payment proof replacement";
  return "Annual return";
}
function sameIdentity(draft: ProductionFollowUpDraft, preview: ProductionFollowUpPreview | null) {
  return Boolean(
    preview &&
    preview.identity.source === draft.source &&
    preview.identity.caseId === draft.caseId &&
    preview.identity.entityId === draft.entityId,
  );
}

export function ProductionWhatsAppAutomation() {
  const queryClient = useQueryClient();
  const [review, setReview] = useState<ProductionFollowUpPreview | null>(null);
  const draftsQuery = useQuery({
    queryKey: annualReturnQueryKeys.automationNotifications,
    queryFn: () => listProductionFollowUpDrafts(),
  });
  const integrationQuery = useQuery({
    queryKey: ["whatsapp-integration-status"],
    queryFn: () => getWhatsAppIntegrationStatus(),
  });
  const previewMutation = useMutation({
    mutationFn: (draft: ProductionFollowUpDraft) =>
      previewProductionFollowUp({
        data: { source: draft.source, caseId: draft.caseId, entityId: draft.entityId },
      }),
    onSuccess: setReview,
  });
  const sendMutation = useMutation({
    mutationFn: (preview: ProductionFollowUpPreview) =>
      sendProductionFollowUp({
        data: { ...preview.identity, previewHash: preview.previewHash },
      }),
    onSuccess: (_result, preview) => {
      setReview(null);
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: annualReturnQueryKeys.automationNotifications }),
        queryClient.invalidateQueries({
          queryKey: annualReturnQueryKeys.notifications(preview.caseId),
        }),
      ]);
    },
  });

  const drafts = draftsQuery.data ?? [];
  const canQueue =
    integrationQuery.data?.deliveryMode === "live" &&
    integrationQuery.data.capabilityStatus.state === "healthy";
  const error =
    draftsQuery.error ?? previewMutation.error ?? sendMutation.error ?? integrationQuery.error;

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader eyebrow="Messaging" title="WhatsApp Automation" />
      {integrationQuery.data?.deliveryMode === "simulated" ? (
        <div
          className="border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900"
          role="status"
        >
          <p className="font-medium">Demo simulation</p>
          <p>No external WhatsApp or email message is sent.</p>
        </div>
      ) : null}
      {!canQueue && integrationQuery.data?.deliveryMode === "live" ? (
        <p role="status" className="border bg-status-yellow-soft p-3 text-sm text-status-yellow">
          Provider delivery is unverified. Follow-ups can be reviewed but cannot be queued.
        </p>
      ) : null}
      {error ? (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {errorMessage(error)}
        </div>
      ) : null}
      <section className="border bg-card">
        <div className="hidden grid-cols-[1.2fr_1fr_160px_110px_minmax(0,1.5fr)_160px] gap-3 border-b px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:grid">
          <span>Company</span>
          <span>Recipient</span>
          <span>Type</span>
          <span>Status</span>
          <span>Draft</span>
          <span className="text-right">Action</span>
        </div>
        <div className="divide-y">
          {draftsQuery.isPending ? (
            <p className="p-4 text-sm text-muted-foreground">Loading follow-ups...</p>
          ) : drafts.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              No production follow-ups are queued.
            </p>
          ) : (
            drafts.map((draft) => (
              <ProductionAutomationRow
                key={draft.source + "-" + draft.id}
                draft={draft}
                preview={sameIdentity(draft, review) ? review : null}
                reviewing={
                  previewMutation.isPending &&
                  previewMutation.variables?.source === draft.source &&
                  previewMutation.variables.entityId === draft.entityId
                }
                sending={
                  sendMutation.isPending && sameIdentity(draft, sendMutation.variables ?? null)
                }
                canQueue={canQueue}
                onReview={() => {
                  setReview(null);
                  previewMutation.mutate(draft);
                }}
                onApprove={() => {
                  if (review) sendMutation.mutate(review);
                }}
              />
            ))
          )}
        </div>
      </section>
    </main>
  );
}

function ProductionAutomationRow({
  draft,
  preview,
  reviewing,
  sending,
  canQueue,
  onReview,
  onApprove,
}: {
  draft: ProductionFollowUpDraft;
  preview: ProductionFollowUpPreview | null;
  reviewing: boolean;
  sending: boolean;
  canQueue: boolean | undefined;
  onReview(): void;
  onApprove(): void;
}) {
  return (
    <div className="space-y-3 px-4 py-4 text-sm">
      <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_160px_110px_minmax(0,1.5fr)_160px] lg:items-center">
        <div className="min-w-0">
          <a className="font-medium hover:underline" href={"/annual-returns/" + draft.caseId}>
            {draft.companyName}
          </a>
          <p className="text-muted-foreground">{draft.ownerName}</p>
        </div>
        <div>
          <p className="truncate">
            {draft.recipientName && draft.phone
              ? draft.recipientName + " / " + draft.phone
              : "Recipient unavailable"}
          </p>
          <a className="text-xs underline" href={"/clients/" + draft.companyId}>
            Manage contact
          </a>
        </div>
        <p>{typeLabel(draft.source)}</p>
        <p className="capitalize">{draft.status}</p>
        <div className="min-w-0">
          <p className="truncate">{draft.messagePreview}</p>
          <p className="truncate text-xs text-muted-foreground">{draft.reasonLabel}</p>
        </div>
        <div className="flex justify-start lg:justify-end">
          <button
            className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
            disabled={reviewing || draft.status !== "draft"}
            onClick={onReview}
            type="button"
          >
            {reviewing
              ? "Reviewing..."
              : draft.status === "draft"
                ? "Review actual send"
                : draft.status}
          </button>
        </div>
      </div>
      {preview ? (
        <div className="space-y-2 rounded-md border p-3">
          <p className="font-medium">Actual send preview</p>
          <p>
            Case: {preview.companyName} · Recipient: {preview.recipientName} (
            {preview.recipientE164})
          </p>
          <p>
            Mode: {preview.sendMode} · Language: {preview.languageCode}
          </p>
          <p className="whitespace-pre-wrap">{preview.renderedText}</p>
          <p className="text-xs text-muted-foreground">
            Recipient and 24-hour session are checked again before queue and dispatch.
          </p>
          <button
            className="rounded-md border px-3 py-2 disabled:opacity-50"
            type="button"
            disabled={!canQueue || sending}
            onClick={onApprove}
          >
            {sending ? "Queueing..." : "Approve and queue"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
