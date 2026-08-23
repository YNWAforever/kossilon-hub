import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import {
  cancelCorporateChangeRequest,
  completeCorporateChangeRequest,
  getCorporateChangeRequest,
  updateCorporateChangeChecklistItemStatus,
} from "../server-fns";
import type { ChecklistItemStatus } from "../types";

export function ProductionCorporateChangeDetail({ requestId }: { requestId: string }) {
  const queryClient = useQueryClient();

  const requestQuery = useQuery({
    queryKey: ["corporate-change-request", requestId],
    queryFn: () => getCorporateChangeRequest({ data: { requestId } }),
    retry: false,
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["corporate-change-request", requestId] });
  }

  const updateItem = useMutation({
    mutationFn: (input: { itemId: string; status: ChecklistItemStatus; note: string | null }) =>
      updateCorporateChangeChecklistItemStatus({
        data: { requestId, itemId: input.itemId, status: input.status, note: input.note },
      }),
    onSuccess: invalidate,
    onError: () => toast.error("Unable to update the checklist item. Try again."),
  });

  const complete = useMutation({
    mutationFn: () => completeCorporateChangeRequest({ data: { requestId } }),
    onSuccess: () => {
      toast.success("Corporate change request completed.");
      invalidate();
    },
    onError: () => toast.error("Unable to complete this request. Try again."),
  });

  const cancel = useMutation({
    mutationFn: () => cancelCorporateChangeRequest({ data: { requestId } }),
    onSuccess: () => {
      toast.success("Corporate change request cancelled.");
      invalidate();
    },
    onError: () => toast.error("Unable to cancel this request. Try again."),
  });

  if (requestQuery.isPending) {
    return (
      <main className="flex-1 space-y-6 p-4 md:p-6">
        <PageHeader eyebrow="Operations" title="Corporate change request" />
        <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">
          <Loader2 aria-hidden className="mr-2 h-4 w-4 animate-spin" />
          Loading…
        </div>
      </main>
    );
  }

  const request = requestQuery.data;

  if (requestQuery.isError || !request) {
    return (
      <main className="flex-1 space-y-3 p-4 md:p-6">
        <PageHeader eyebrow="Operations" title="Corporate change request" />
        <p role="alert" className="text-sm text-destructive">
          Failed to load this request.
        </p>
      </main>
    );
  }

  const requiredItemsVerified = request.checklistItems
    .filter((item) => item.required)
    .every((item) => item.status === "Verified");
  const canComplete = request.status === "Filed with Registrar" && requiredItemsVerified;
  const canCancel = request.status !== "Completed" && request.status !== "Cancelled";

  return (
    <main className="flex-1 space-y-6 p-4 md:p-6">
      <PageHeader
        eyebrow="Operations"
        title="Corporate change request"
        actions={
          <>
            <button
              type="button"
              onClick={() => complete.mutate()}
              disabled={!canComplete || complete.isPending}
              className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              Complete
            </button>
            <button
              type="button"
              onClick={() => cancel.mutate()}
              disabled={!canCancel || cancel.isPending}
              className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60"
            >
              Cancel request
            </button>
          </>
        }
      />

      <section className="rounded-lg border bg-card p-4">
        <dl className="grid gap-4 md:grid-cols-3">
          <div>
            <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Change type
            </dt>
            <dd className="mt-1 text-sm">{request.changeType.replace(/_/g, " ")}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Status
            </dt>
            <dd className="mt-1 text-sm">{request.status}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Quoted fee
            </dt>
            <dd className="mt-1 text-sm">HKD {request.quotedFee.toLocaleString()}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Checklist</h2>
        <div className="divide-y">
          {request.checklistItems.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 py-3">
              <span className="min-w-0 truncate text-sm">
                {item.itemLabel}
                {item.required ? "" : " (optional)"}
              </span>
              <select
                aria-label={`${item.itemLabel} status`}
                className="shrink-0 rounded-md border border-border bg-background px-2 py-1 text-xs"
                value={item.status}
                onChange={(event) =>
                  updateItem.mutate({
                    itemId: item.id,
                    status: event.target.value as ChecklistItemStatus,
                    note: item.note,
                  })
                }
                disabled={updateItem.isPending}
              >
                <option value="Missing">Missing</option>
                <option value="Received">Received</option>
                <option value="Verified">Verified</option>
                <option value="Rejected">Rejected</option>
              </select>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
