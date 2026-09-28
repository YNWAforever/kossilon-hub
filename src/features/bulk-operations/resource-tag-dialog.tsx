import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { commitBulkOperation, previewBulkOperation } from "./server-fns";
import type { BulkPreviewInput } from "./types";

type TagSelection = Extract<BulkPreviewInput, { action: "tag" }>["selection"];
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Tag operation unavailable.";
}

export function ResourceTagDialog({
  selection,
  onClose,
  onCommitted,
}: {
  selection: TagSelection;
  onClose: () => void;
  onCommitted: (id: string) => void;
}) {
  const [tag, setTag] = useState("");
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const preview = useMutation({
    mutationFn: () =>
      previewBulkOperation({
        data: { action: "tag", selection, parameters: { tag, mode } },
      }),
  });
  const commit = useMutation({
    mutationFn: () => {
      if (!preview.data) throw new Error("Preview before approval.");
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
  const busy = preview.isPending || commit.isPending;
  function resetPreview() {
    setIdempotencyKey(crypto.randomUUID());
    preview.reset();
    commit.reset();
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Bulk tag {selection.resource}</DialogTitle>
          <DialogDescription>
            Preview is read-only. Approval queues eligible items; each resource is reauthorized and
            tag-version checked in its own transaction.
          </DialogDescription>
        </DialogHeader>
        <label className="grid gap-1 text-sm">
          Tag
          <input
            value={tag}
            maxLength={64}
            onChange={(event) => {
              setTag(event.target.value);
              resetPreview();
            }}
            className="rounded-md border border-input bg-background px-2 py-2"
          />
        </label>
        <label className="grid gap-1 text-sm">
          Action
          <select
            value={mode}
            onChange={(event) => {
              setMode(event.target.value as "add" | "remove");
              resetPreview();
            }}
            className="rounded-md border border-input bg-background px-2 py-2"
          >
            <option value="add">Add tag</option>
            <option value="remove">Remove tag</option>
          </select>
        </label>
        {preview.data ? (
          <div role="status" className="rounded-md border border-border p-3 text-sm">
            <p>
              {preview.data.selectionCount} selected · {preview.data.eligibleCount} eligible ·{" "}
              {preview.data.skippedCount} skipped · {preview.data.conflictCount} forbidden
            </p>
            <p className="text-xs text-muted-foreground">
              First {preview.data.itemsPreview.length} decisions shown. Preview expires at{" "}
              {new Date(preview.data.expiresAt).toLocaleString()}.
            </p>
            <ul className="mt-2 max-h-40 overflow-auto text-xs">
              {preview.data.itemsPreview.map((item) => (
                <li key={item.resourceId}>
                  {item.resourceId} · {item.state}
                  {item.reasonCode ? ` (${item.reasonCode})` : ""}
                  {" · revision "}
                  {item.revision ?? "hidden"}
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
            Approval failed: {errorText(commit.error)}
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
            disabled={!tag.trim() || busy}
            className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50"
          >
            Preview tags
          </button>
          <button
            type="button"
            onClick={() => commit.mutate()}
            disabled={!preview.data || preview.data.eligibleCount === 0 || busy}
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            Queue approved tags
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
