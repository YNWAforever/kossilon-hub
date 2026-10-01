import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { annualReturnQueryKeys } from "../query-keys";
import type { ProductionFollowUpDraft } from "../follow-ups";
import { listProductionFollowUpDrafts, sendProductionFollowUp } from "../follow-up-server-fns";
import { getWhatsAppIntegrationStatus } from "@/features/whatsapp/server-fns";
import { PageHeader } from "@/components/page-header";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to queue follow-up.";
}

function typeLabel(source: ProductionFollowUpDraft["source"]): string {
  if (source === "document-review") return "Document replacement";
  if (source === "payment-proof-review") return "Payment proof replacement";
  return "Annual return";
}

export function ProductionWhatsAppAutomation() {
  const [preview, setPreview] = useState<ProductionFollowUpDraft | null>(null);
  const queryClient = useQueryClient();
  const draftsQuery = useQuery({
    queryKey: annualReturnQueryKeys.automationNotifications,
    queryFn: () => listProductionFollowUpDrafts(),
  });
  const integrationQuery = useQuery({
    queryKey: ["whatsapp-integration-status"],
    queryFn: () => getWhatsAppIntegrationStatus(),
  });
  const sendMutation = useMutation({
    mutationFn: (draft: ProductionFollowUpDraft) =>
      sendProductionFollowUp({
        data: {
          source: draft.source,
          caseId: draft.caseId,
          entityId: draft.entityId,
          expectedVersion: draft.version,
        },
      }),
    onSuccess: (_result, draft) => {
      setPreview((current) =>
        current?.source === draft.source && current.entityId === draft.entityId ? null : current,
      );
      return Promise.all([
        queryClient.invalidateQueries({
          queryKey: annualReturnQueryKeys.automationNotifications,
        }),
        queryClient.invalidateQueries({
          queryKey: annualReturnQueryKeys.notifications(draft.caseId),
        }),
      ]);
    },
  });

  const drafts = draftsQuery.data ?? [];
  const error = draftsQuery.error ?? sendMutation.error ?? integrationQuery.error;

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader eyebrow="Messaging" title="WhatsApp Automation" />
      <p className="text-sm text-muted-foreground">
        Provider configuration does not prove connection health. Approval queues the inspected
        draft; only a receipt confirms delivery.
      </p>

      {integrationQuery.data?.deliveryMode === "simulated" ? (
        <div
          className="border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900"
          role="status"
        >
          <p className="font-medium">Demo simulation</p>
          <p>No external WhatsApp or email message is sent.</p>
        </div>
      ) : null}

      {error && !preview ? (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {errorMessage(error)}
        </div>
      ) : null}

      <section className="border bg-card">
        <div className="hidden grid-cols-[1.2fr_1fr_160px_110px_minmax(0,1.5fr)_120px] gap-3 border-b px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:grid">
          <span>Company</span>
          <span>Recipient</span>
          <span>Type</span>
          <span>Status</span>
          <span>Preview</span>
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
                key={`${draft.source}-${draft.id}`}
                draft={draft}
                active={
                  sendMutation.isPending &&
                  sendMutation.variables?.source === draft.source &&
                  sendMutation.variables.entityId === draft.entityId
                }
                onSend={() => setPreview(draft)}
              />
            ))
          )}
        </div>
      </section>
      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open && !sendMutation.isPending) setPreview(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve follow-up</DialogTitle>
            <DialogDescription>
              Confirm this recipient and the full draft. Queueing does not confirm delivery; outside
              the session window the approved template may be used.
            </DialogDescription>
          </DialogHeader>
          {preview ? (
            <div className="space-y-3 text-sm">
              <p>{preview.companyName}</p>
              <p>
                {preview.recipientName} / {preview.phone}
              </p>
              <p className="whitespace-pre-wrap break-words">{preview.messagePreview}</p>
              <p className="text-muted-foreground">{preview.reasonLabel}</p>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(error)}
            </p>
          ) : null}
          <DialogFooter>
            <button
              type="button"
              disabled={sendMutation.isPending}
              onClick={() => setPreview(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!preview || sendMutation.isPending}
              onClick={() => {
                if (preview) sendMutation.mutate(preview);
              }}
            >
              Approve and queue
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function ProductionAutomationRow({
  draft,
  active,
  onSend,
}: {
  draft: ProductionFollowUpDraft;
  active: boolean;
  onSend: () => void;
}) {
  const disabled = active || draft.status !== "draft";
  return (
    <div className="grid gap-3 px-4 py-4 text-sm lg:grid-cols-[1.2fr_1fr_160px_110px_minmax(0,1.5fr)_120px] lg:items-center">
      <div className="min-w-0">
        <a className="font-medium hover:underline" href={`/annual-returns/${draft.caseId}`}>
          {draft.companyName}
        </a>
        <p className="text-muted-foreground">{draft.ownerName}</p>
      </div>
      <p className="truncate">
        {draft.recipientName && draft.phone
          ? `${draft.recipientName} / ${draft.phone}`
          : "Recipient unavailable"}
      </p>
      <p>{typeLabel(draft.source)}</p>
      <p>
        {draft.status === "provider_accepted" ? "Provider accepted; receipt pending" : draft.status}
      </p>
      <div className="min-w-0">
        <p className="truncate">{draft.messagePreview}</p>
        <p className="truncate text-xs text-muted-foreground">{draft.reasonLabel}</p>
      </div>
      <div className="flex justify-start lg:justify-end">
        <button
          className="rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
          disabled={disabled}
          onClick={onSend}
          type="button"
        >
          {active
            ? "Queueing"
            : draft.status === "provider_accepted"
              ? "Receipt pending"
              : draft.status === "blocked"
                ? "Blocked"
                : draft.status === "unknown"
                  ? "Reconcile with provider"
                  : draft.status === "failed"
                    ? "Review failure"
                    : draft.status === "delivered"
                      ? "Delivered"
                      : draft.status === "queued"
                        ? "Queued"
                        : "Preview and approve"}
        </button>
      </div>
    </div>
  );
}
