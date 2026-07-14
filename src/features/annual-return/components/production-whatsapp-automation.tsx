import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { annualReturnQueryKeys } from "../query-keys";
import type { ProductionFollowUpDraft } from "../follow-ups";
import { listProductionFollowUpDrafts, sendProductionFollowUp } from "../follow-up-server-fns";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to queue follow-up.";
}

function typeLabel(source: ProductionFollowUpDraft["source"]): string {
  if (source === "document-review") return "Document replacement";
  if (source === "payment-proof-review") return "Payment proof replacement";
  return "Annual return";
}

export function ProductionWhatsAppAutomation() {
  const queryClient = useQueryClient();
  const draftsQuery = useQuery({
    queryKey: annualReturnQueryKeys.automationNotifications,
    queryFn: () => listProductionFollowUpDrafts(),
  });
  const sendMutation = useMutation({
    mutationFn: (draft: ProductionFollowUpDraft) =>
      sendProductionFollowUp({
        data: { source: draft.source, caseId: draft.caseId, entityId: draft.entityId },
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: annualReturnQueryKeys.automationNotifications,
      }),
  });

  const drafts = draftsQuery.data ?? [];
  const error = draftsQuery.error ?? sendMutation.error;

  return (
    <div className="space-y-6 p-6">
      <div>
        <p className="text-sm font-medium text-muted-foreground">WhatsApp</p>
        <h1 className="mt-1 text-3xl font-semibold">Automation</h1>
      </div>

      {error ? (
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
                onSend={() => sendMutation.mutate(draft)}
              />
            ))
          )}
        </div>
      </section>
    </div>
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
      <p className="capitalize">{draft.status}</p>
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
            ? "Sending"
            : draft.status === "sent"
              ? "Sent"
              : draft.status === "blocked"
                ? "Blocked"
                : "Send now"}
        </button>
      </div>
    </div>
  );
}
