import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ProductionFollowUpDraft } from "../follow-ups";
import {
  previewBulkOperation,
  commitBulkOperation,
  getBulkOperation,
} from "@/features/bulk-operations/server-fns";
import {
  getBulkReminderReview,
  approveBulkReminderReview,
  cancelBulkReminderReview,
} from "@/features/bulk-operations/reminder-server-fns";
import type { BulkPreview } from "@/features/bulk-operations/types";

function errorText(value: unknown) {
  return value instanceof Error ? value.message : "Reminder review failed.";
}

/** A batch commits draft reviews only. Every actual send has its own approval. */
export function BulkReminderReview({
  drafts,
  canQueue,
  live,
}: {
  drafts: ProductionFollowUpDraft[];
  canQueue: boolean;
  live: boolean;
}) {
  const eligible = drafts.filter((d) => d.source === "annual-return" && d.status === "draft");
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [operationId, setOperationId] = useState<string | null>(null);
  useEffect(() => {
    const saved = new URLSearchParams(window.location.search).get("reminderOperation");
    if (saved && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(saved))
      setOperationId(saved);
  }, []);
  const previewMutation = useMutation({
    mutationFn: () =>
      previewBulkOperation({
        data: {
          action: "reminderDrafts",
          selection: { kind: "ids", ids: selected },
          parameters: {},
        },
      }),
    onSuccess: (value) => {
      setPreview(value);
      setOperationId(null);
    },
  });
  const commitMutation = useMutation({
    mutationFn: () => {
      if (!preview) throw new Error("Preview the selected reminders first.");
      return commitBulkOperation({
        data: {
          previewId: preview.id,
          previewHash: preview.previewHash,
          idempotencyKey: crypto.randomUUID(),
        },
      });
    },
    onSuccess: (operation) => {
      setOperationId(operation.id);
      setPreview(null);
      const url = new URL(window.location.href);
      url.searchParams.set("reminderOperation", operation.id);
      window.history.replaceState(window.history.state, "", url);
    },
  });
  const operation = useQuery({
    queryKey: ["bulk-reminder-operation", operationId],
    queryFn: () => getBulkOperation({ data: { id: operationId! } }),
    enabled: Boolean(operationId),
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state === "queued" || state === "running" ? 3000 : false;
    },
  });
  const error = previewMutation.error ?? commitMutation.error ?? operation.error;
  return (
    <section className="space-y-3 border bg-card p-4" aria-label="Bulk reminder drafts">
      <h2 className="font-semibold">Bulk annual return reminder drafts</h2>
      <p className="text-sm text-muted-foreground">
        Preview each recipient and exact template text. Applying this batch creates review drafts
        only; each message needs a separate approval before it enters the delivery queue.
      </p>
      {!live ? (
        <p role="status" className="text-sm">
          Demo is read-only.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {errorText(error)}
        </p>
      ) : null}
      <div className="max-h-64 space-y-1 overflow-auto">
        {eligible.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No annual return reminder drafts available.
          </p>
        ) : (
          eligible.map((d) => (
            <label key={d.caseId} className="flex gap-2 border-b p-2 text-sm">
              <input
                type="checkbox"
                disabled={!live}
                checked={selected.includes(d.caseId)}
                onChange={(event) => {
                  setSelected((before) =>
                    event.target.checked
                      ? [...new Set([...before, d.caseId])].slice(0, 1000)
                      : before.filter((id) => id !== d.caseId),
                  );
                  setPreview(null);
                }}
              />
              <span>
                {d.companyName} · {d.recipientName ?? "Recipient unavailable"}
                {d.phone ? ` (${d.phone})` : ""}
              </span>
            </label>
          ))
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          className="rounded-md border px-3 py-2 disabled:opacity-50"
          disabled={!live || eligible.length === 0}
          onClick={() => {
            setSelected([...new Set(eligible.map((d) => d.caseId))].slice(0, 1000));
            setPreview(null);
          }}
        >
          Select available ({eligible.length})
        </button>
        <button
          type="button"
          className="rounded-md border px-3 py-2 disabled:opacity-50"
          onClick={() => {
            setSelected([]);
            setPreview(null);
          }}
          disabled={!live || selected.length === 0}
        >
          Clear
        </button>
        <button
          type="button"
          className="rounded-md border px-3 py-2 disabled:opacity-50"
          disabled={!live || selected.length === 0 || previewMutation.isPending}
          onClick={() => previewMutation.mutate()}
        >
          {previewMutation.isPending ? "Previewing..." : `Preview ${selected.length} drafts`}
        </button>
      </div>
      {preview ? (
        <div className="space-y-2 border p-3 text-sm">
          <p className="font-medium">
            {preview.eligibleCount} eligible · {preview.skippedCount} skipped ·{" "}
            {preview.conflictCount} conflicts
          </p>
          <p>Preview expires {new Date(preview.expiresAt).toLocaleString()}.</p>
          <div className="max-h-72 space-y-2 overflow-auto">
            {preview.itemsPreview.map((item) => (
              <div key={item.resourceId} className="border-b pb-2">
                <p>
                  Case {item.resourceId} · {item.state} {item.reasonCode ?? ""}
                </p>
                {item.state === "eligible" ? (
                  <>
                    <p>
                      Recipient: {item.recipientName} ({item.recipientE164}) · Mode: {item.sendMode}
                    </p>
                    <p className="whitespace-pre-wrap">{item.renderedText}</p>
                  </>
                ) : null}
              </div>
            ))}
          </div>
          {preview.selectionCount > preview.itemsPreview.length ? (
            <p>
              Showing {preview.itemsPreview.length} of {preview.selectionCount} selected cases.
              Remaining recipients must be reviewed individually before queue.
            </p>
          ) : null}
          <button
            type="button"
            className="rounded-md bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50"
            disabled={!live || preview.eligibleCount === 0 || commitMutation.isPending}
            onClick={() => commitMutation.mutate()}
          >
            {commitMutation.isPending ? "Creating drafts..." : "Create review drafts"}
          </button>
        </div>
      ) : null}
      {operation.data ? (
        <div className="space-y-2 border p-3 text-sm">
          <p className="font-medium">
            Draft operation {operation.data.id} · {operation.data.state}
          </p>
          <p>
            {operation.data.counts.succeeded} created · {operation.data.counts.skipped} skipped ·
            {operation.data.counts.conflict} conflicts · {operation.data.counts.failed} failed
          </p>
          {operation.data.items.map((item) => (
            <div key={item.itemId} className="border-b py-2">
              <p>
                Case {item.resourceId} · {item.state} {item.reasonCode ?? ""}
              </p>
              {item.reviewId ? (
                <ReminderReviewRow reviewId={item.reviewId} canQueue={canQueue} live={live} />
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ReminderReviewRow({
  reviewId,
  canQueue,
  live,
}: {
  reviewId: string;
  canQueue: boolean;
  live: boolean;
}) {
  const queryClient = useQueryClient();
  const review = useQuery({
    queryKey: ["bulk-reminder-review", reviewId],
    queryFn: () => getBulkReminderReview({ data: { reviewId } }),
    refetchInterval: 15000,
  });
  const approve = useMutation({
    mutationFn: () => {
      if (!review.data) throw new Error("Load the actual message first.");
      return approveBulkReminderReview({
        data: { reviewId, previewHash: review.data.previewHash },
      });
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["bulk-reminder-review", reviewId] }),
  });
  const cancel = useMutation({
    mutationFn: () => cancelBulkReminderReview({ data: { reviewId } }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["bulk-reminder-review", reviewId] }),
  });
  if (review.error)
    return (
      <p role="alert" className="text-destructive">
        {errorText(review.error)}
      </p>
    );
  if (!review.data) return <p>Loading individual review...</p>;
  const row = review.data;
  const expired = Date.parse(row.expiresAt) <= Date.now();
  return (
    <div className="mt-2 space-y-2 bg-muted/40 p-3">
      <p>
        {row.companyName} · {row.recipientName} ({row.recipientE164})
      </p>
      <p>
        Mode: {row.sendMode} · Language: {row.languageCode}
      </p>
      <p className="whitespace-pre-wrap">{row.renderedText}</p>
      <p>
        Review: {row.reviewState} · Preview expires {new Date(row.expiresAt).toLocaleString()}
      </p>
      {row.delivery ? (
        <p>
          Delivery: {row.delivery.state} · Message {row.delivery.messageId} · Provider receipt{" "}
          {row.delivery.providerReceiptId ?? "unavailable"}
        </p>
      ) : null}
      {approve.error || cancel.error ? (
        <p role="alert" className="text-destructive">
          {errorText(approve.error ?? cancel.error)}
        </p>
      ) : null}
      {row.reviewState === "draft" ? (
        <button
          type="button"
          className="rounded-md border px-3 py-2 disabled:opacity-50"
          disabled={!canQueue || expired || approve.isPending}
          onClick={() => approve.mutate()}
        >
          {approve.isPending ? "Queueing..." : "Approve and queue this message"}
        </button>
      ) : null}
      {row.reviewState === "draft" ? (
        <button
          type="button"
          className="rounded-md border px-3 py-2 disabled:opacity-50"
          disabled={cancel.isPending || !live}
          onClick={() => cancel.mutate()}
        >
          {cancel.isPending ? "Cancelling..." : "Cancel unsent draft"}
        </button>
      ) : null}
      {expired && row.reviewState === "draft" ? (
        <p role="status">
          Preview expired. Cancel this unsent draft, then make a fresh batch preview.
        </p>
      ) : null}
    </div>
  );
}
