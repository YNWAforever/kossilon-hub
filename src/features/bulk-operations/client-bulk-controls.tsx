import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ClientAssignmentOptions } from "@/features/clients/types";
import { commitBulkOperation, previewBulkOperation } from "./server-fns";
import type { BulkPreviewInput } from "./types";

type ClientSelection = Extract<BulkPreviewInput, { action: "clientAssign" }>["selection"];
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Assignment unavailable.";
}

export function ClientBulkAssignmentDialog({
  selection,
  options,
  onClose,
  onCommitted,
}: {
  selection: ClientSelection;
  options: ClientAssignmentOptions;
  onClose: () => void;
  onCommitted: (id: string) => void;
}) {
  const [ownerId, setOwnerId] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const ownerNames = useMemo(
    () => new Map(options.owners.map((owner) => [owner.id, owner.name])),
    [options.owners],
  );
  const teamNames = useMemo(
    () => new Map(options.teams.map((team) => [team.id, team.name])),
    [options.teams],
  );
  const preview = useMutation({
    mutationFn: () =>
      previewBulkOperation({
        data: { action: "clientAssign", selection, parameters: { ownerId } },
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
  const selectionLabel =
    selection.kind === "ids"
      ? `${selection.ids.length} selected clients`
      : "All matching clients (max 1000), evaluated by the server";
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Bulk client-owner assignment</DialogTitle>
          <DialogDescription>
            {selectionLabel}. Preview is read-only. Approval queues eligible clients; each client is
            reauthorized and version-checked in its own transaction.
          </DialogDescription>
        </DialogHeader>
        <label className="grid gap-1 text-sm">
          New owner
          <select
            aria-label="New client owner"
            value={ownerId}
            onChange={(event) => {
              setOwnerId(event.target.value);
              setIdempotencyKey(crypto.randomUUID());
              preview.reset();
              commit.reset();
            }}
            disabled={busy}
            className="rounded-md border border-input bg-background px-2 py-2"
          >
            <option value="">Select an active owner</option>
            {options.owners
              .filter((owner) => owner.teamId)
              .map((owner) => (
                <option key={owner.id} value={owner.id}>
                  {owner.name} · {teamNames.get(owner.teamId ?? "") ?? owner.teamId}
                </option>
              ))}
          </select>
        </label>
        {preview.data ? (
          <div role="status" className="rounded-md border border-border p-3 text-sm">
            <p>
              {preview.data.selectionCount} selected · {preview.data.eligibleCount} eligible ·{" "}
              {preview.data.skippedCount} skipped · {preview.data.conflictCount} refused or
              conflicted
            </p>
            <p className="text-xs text-muted-foreground">
              First {preview.data.itemsPreview.length} decisions shown. Preview expires at{" "}
              {new Date(preview.data.expiresAt).toLocaleString()}.
            </p>
            <ul className="mt-2 max-h-48 overflow-y-auto text-xs">
              {preview.data.itemsPreview.map((item) => {
                const hidden = item.reasonCode === "CLIENT_OUT_OF_SCOPE";
                return (
                  <li key={item.resourceId} className="border-b border-border py-1 last:border-0">
                    {item.resourceId} · {item.state}
                    {item.reasonCode ? ` (${item.reasonCode})` : ""} · revision{" "}
                    {item.revision ?? "hidden"}
                    <br />
                    {hidden
                      ? "Hidden"
                      : (ownerNames.get(item.oldOwnerId ?? "") ?? item.oldOwnerId ?? "Unassigned")}
                    {" · "}
                    {hidden
                      ? "Hidden"
                      : (teamNames.get(item.oldTeamId ?? "") ?? item.oldTeamId ?? "No team")}
                    {" → "}
                    {ownerNames.get(item.newOwnerId ?? "") ?? item.newOwnerId ?? "Unavailable"}
                    {" · "}
                    {hidden || item.reasonCode === "TARGET_UNAVAILABLE"
                      ? "Unavailable"
                      : (teamNames.get(item.newTeamId ?? "") ?? item.newTeamId ?? "No team")}
                  </li>
                );
              })}
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
            disabled={!ownerId || busy}
            className="rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50"
          >
            Preview
          </button>
          <button
            type="button"
            onClick={() => commit.mutate()}
            disabled={!preview.data || preview.data.eligibleCount === 0 || busy}
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            Queue approved assignments
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
