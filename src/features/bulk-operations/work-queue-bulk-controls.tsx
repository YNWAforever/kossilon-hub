import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PersistedWorkItem } from "@/features/work-items/repository";
import { recommendWorkItemAssignees } from "@/features/work-items/server-fns";
import {
  commitBulkOperation,
  cancelBulkOperation,
  exportBulkOperationCsv,
  getBulkOperation,
  previewBulkOperation,
} from "./server-fns";
import type { BulkOperationView, BulkPreviewInput } from "./types";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Operation unavailable.";
}

export function WorkQueueBulkAssignmentDialog({
  selection,
  selectedCount,
  representativeItem,
  selectedItems,
  onClose,
  onCommitted,
}: {
  selection: Extract<BulkPreviewInput, { action: "assign" }>["selection"];
  selectedCount: number;
  representativeItem: PersistedWorkItem;
  selectedItems: PersistedWorkItem[];
  onClose: () => void;
  onCommitted: (id: string) => void;
}) {
  const [assigneeId, setAssigneeId] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const recommendations = useQuery({
    queryKey: ["work-item-recommendations", representativeItem.id],
    queryFn: () => recommendWorkItemAssignees({ data: { workItemId: representativeItem.id } }),
  });
  const preview = useMutation({
    mutationFn: () =>
      previewBulkOperation({
        data: {
          action: "assign",
          selection,
          parameters: {
            assigneeId,
            assignmentTarget: "owner",
            overrideReason: overrideReason.trim() || undefined,
          },
        },
      }),
  });
  const commit = useMutation({
    mutationFn: () => {
      if (!preview.data) throw new Error("Preview before committing.");
      return commitBulkOperation({
        data: {
          previewId: preview.data.id,
          previewHash: preview.data.previewHash,
          idempotencyKey,
        },
      });
    },
    onSuccess: (operation) => onCommitted(operation.id),
  });
  const target = recommendations.data?.find((option) => option.userId === assigneeId);
  const busy = preview.isPending || commit.isPending;
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Bulk work-item assignment</DialogTitle>
          <DialogDescription>
            {selectedCount} work items in this view. Server preview freezes the exact matching IDs
            and checks each item's current authorization before approval.
          </DialogDescription>
        </DialogHeader>
        <label className="grid gap-1 text-sm">
          Assign owner to
          <select
            value={assigneeId}
            onChange={(event) => {
              setAssigneeId(event.target.value);
              preview.reset();
            }}
            disabled={busy || recommendations.isPending}
            className="rounded-md border border-input bg-background px-2 py-2"
          >
            <option value="">Select an assignee</option>
            {(recommendations.data ?? []).map((option) => (
              <option key={option.userId} value={option.userId}>
                {option.person?.name ?? option.userId} · {option.person?.teamName ?? "No team"}
              </option>
            ))}
          </select>
        </label>
        {target ? (
          <div className="text-xs text-muted-foreground">
            <p>Target team: {target.person?.teamName ?? "No team"}</p>
            <div className="mt-2 max-h-32 overflow-y-auto rounded-md border border-border p-2">
              {selectedItems.map((item) => (
                <p key={item.id}>
                  {item.title}: {item.ownerPerson?.name ?? item.ownerName ?? "Unassigned"}
                  {" · "}
                  {item.ownerPerson?.teamName ?? item.teamId ?? "No team"}
                  {" → "}
                  {target.person?.name ?? target.userId}
                  {" · "}
                  {target.person?.teamName ?? "No team"}
                </p>
              ))}
            </div>
          </div>
        ) : null}
        <label className="grid gap-1 text-sm">
          Override reason when required
          <textarea
            value={overrideReason}
            onChange={(event) => {
              setOverrideReason(event.target.value);
              preview.reset();
            }}
            disabled={busy}
            className="min-h-20 rounded-md border border-input bg-background p-2"
          />
        </label>
        {preview.data ? (
          <div role="status" className="rounded-md border border-border p-3 text-sm">
            <p>
              Eligible {preview.data.eligibleCount} · Skipped {preview.data.skippedCount} ·
              Conflicts {preview.data.conflictCount}
            </p>
            <p className="text-xs text-muted-foreground">
              Only eligible items will be queued. The preview expires at{" "}
              {new Date(preview.data.expiresAt).toLocaleString()}.
            </p>
            <ul className="mt-2 max-h-36 overflow-auto text-xs">
              {preview.data.itemsPreview.map((item) => (
                <li key={item.resourceId}>
                  {item.resourceId} · {item.state} · revision {item.revision}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {preview.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Preview failed: {errorText(preview.error)}
          </p>
        ) : null}
        {commit.isError ? (
          <p role="alert" className="text-sm text-destructive">
            Commit failed: {errorText(commit.error)}
          </p>
        ) : null}
        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border px-3 py-2 text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => preview.mutate()}
            disabled={!assigneeId || busy}
            className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50"
          >
            Preview
          </button>
          <button
            type="button"
            onClick={() => commit.mutate()}
            disabled={!preview.data || busy}
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            Queue approved assignment
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WorkQueueBulkOperationStatus({
  id,
  onRetryFailed,
}: {
  id: string;
  onRetryFailed: (items: BulkOperationView["items"]) => void;
}) {
  const operation = useQuery({
    queryKey: ["bulk-operation", id],
    queryFn: () => getBulkOperation({ data: { id } }),
    refetchInterval: (query) =>
      query.state.data?.state === "completed" ||
      query.state.data?.state === "completed-with-errors" ||
      query.state.data?.state === "cancelled"
        ? false
        : 5000,
  });
  const [exportError, setExportError] = useState<string | null>(null);
  const cancel = useMutation({
    mutationFn: () => cancelBulkOperation({ data: { id } }),
    onSuccess: () => void operation.refetch(),
  });
  async function downloadCsv() {
    try {
      const csv = await exportBulkOperationCsv({ data: { id } });
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `bulk-operation-${id}.csv`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setExportError(null);
    } catch (error) {
      setExportError(errorText(error));
    }
  }
  return (
    <section
      aria-label="Bulk assignment progress"
      className="mt-3 rounded-lg border border-border p-3 text-sm"
    >
      {operation.isPending ? <p role="status">Loading operation…</p> : null}
      {operation.isError ? (
        <p role="alert">Operation unavailable: {errorText(operation.error)}</p>
      ) : null}
      {operation.data ? (
        <>
          <p>
            Assignment {id} · {operation.data.state}
          </p>
          <p className="text-xs text-muted-foreground">
            Succeeded {operation.data.counts.succeeded} · Pending {operation.data.counts.pending} ·
            Running {operation.data.counts.running} · Failed {operation.data.counts.failed} ·
            Conflict {operation.data.counts.conflict} · Forbidden {operation.data.counts.forbidden}
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void downloadCsv()}
              className="rounded-md border border-border px-2 py-1 text-xs"
            >
              Export authorized results CSV
            </button>
            {operation.data.state === "queued" || operation.data.state === "running" ? (
              <button
                type="button"
                onClick={() => cancel.mutate()}
                disabled={cancel.isPending}
                className="rounded-md border border-border px-2 py-1 text-xs disabled:opacity-50"
              >
                Cancel remaining items
              </button>
            ) : null}
            {operation.data.state === "completed-with-errors" &&
            operation.data.counts.failed > 0 ? (
              <button
                type="button"
                onClick={() => onRetryFailed(operation.data!.items)}
                className="rounded-md border border-border px-2 py-1 text-xs"
              >
                Select failed items for a new preview
              </button>
            ) : null}
          </div>
          {cancel.isError ? (
            <p role="alert" className="text-xs text-destructive">
              Cancellation failed: {errorText(cancel.error)}
            </p>
          ) : null}
          {operation.data.state === "cancelled" ? (
            <p className="text-xs text-muted-foreground">
              Started or completed item results remain in the audit record.
            </p>
          ) : null}
          {exportError ? (
            <p role="alert" className="text-xs text-destructive">
              {exportError}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
