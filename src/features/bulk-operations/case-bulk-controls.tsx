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
import type { AssignableStaffMember } from "@/features/annual-return/repository";
import { commitBulkOperation, previewBulkOperation } from "./server-fns";
import type { BulkPreviewInput } from "./types";

type CaseSelection = Extract<BulkPreviewInput, { action: "caseAssign" }>["selection"];

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Assignment unavailable.";
}

export function CaseBulkAssignmentDialog({
  selection,
  owners,
  onClose,
  onCommitted,
}: {
  selection: CaseSelection;
  owners: AssignableStaffMember[];
  onClose: () => void;
  onCommitted: (id: string) => void;
}) {
  const [ownerId, setOwnerId] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const names = useMemo(() => new Map(owners.map((owner) => [owner.id, owner])), [owners]);
  const teamNames = useMemo(
    () =>
      new Map(
        owners
          .filter((owner) => owner.teamId)
          .map((owner) => [owner.teamId!, owner.teamName ?? owner.teamId!]),
      ),
    [owners],
  );
  const preview = useMutation({
    mutationFn: () =>
      previewBulkOperation({
        data: { action: "caseAssign", selection, parameters: { ownerId } },
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
      ? selection.ids.length + " selected cases"
      : "All matching cases (max 1000), evaluated by the server";
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Bulk case-owner assignment</DialogTitle>
          <DialogDescription>
            {selectionLabel}. Preview is read-only. Approval queues eligible cases; each case is
            reauthorized and version-checked before its own transaction.
          </DialogDescription>
        </DialogHeader>
        <label className="grid gap-1 text-sm">
          New owner
          <select
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
            {owners.map((owner) => (
              <option key={owner.id} value={owner.id}>
                {owner.name} · {owner.teamName ?? "No team"}
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
              {preview.data.itemsPreview.map((item) => (
                <li key={item.resourceId} className="border-b border-border py-1 last:border-0">
                  {item.resourceId} · {item.state}
                  {item.reasonCode ? " (" + item.reasonCode + ")" : ""} · revision{" "}
                  {item.revision ?? "hidden"}
                  <br />
                  {item.reasonCode === "CASE_OUT_OF_SCOPE"
                    ? "Hidden"
                    : (names.get(item.oldOwnerId ?? "")?.name ?? item.oldOwnerId ?? "Unassigned")}
                  {" · "}
                  {item.reasonCode === "CASE_OUT_OF_SCOPE"
                    ? "Hidden"
                    : (teamNames.get(item.oldTeamId ?? "") ?? item.oldTeamId ?? "No team")}
                  {" → "}
                  {names.get(item.newOwnerId ?? "")?.name ?? item.newOwnerId ?? "Unavailable"}
                  {" · "}
                  {item.reasonCode === "TARGET_UNAVAILABLE" ||
                  item.reasonCode === "CASE_OUT_OF_SCOPE"
                    ? "Unavailable"
                    : (teamNames.get(item.newTeamId ?? "") ?? item.newTeamId ?? "No team")}
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
