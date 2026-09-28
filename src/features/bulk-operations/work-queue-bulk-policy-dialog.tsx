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
import type { PersistedWorkItem, PolicyBackfillDecision } from "@/features/work-items/repository";
import {
  listWorkItemPolicyChoices,
  previewWorkItemPolicyBackfill,
} from "@/features/work-items/server-fns";
import { commitBulkOperation, previewBulkOperation } from "./server-fns";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Operation unavailable.";
}

function hongKongTime(value: string): string {
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function WorkQueueBulkPolicyDialog({
  items,
  onClose,
  onCommitted,
}: {
  items: PersistedWorkItem[];
  onClose: () => void;
  onCommitted: (operationId: string) => void;
}) {
  const [policyVersionId, setPolicyVersionId] = useState("");
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const representative = items.find(
    (item) =>
      !item.slaPolicyVersionId && !item.slaStartedAt && !item.slaWarningAt && !item.slaDueAt,
  );
  const validSelection = items.length > 0 && items.length <= 100;
  const choices = useQuery({
    queryKey: ["work-item-policy-choices", representative?.id, representative?.version],
    queryFn: () =>
      listWorkItemPolicyChoices({
        data: {
          workItemId: representative!.id,
          expectedVersion: representative!.version,
        },
      }),
    enabled: Boolean(representative && validSelection),
    retry: false,
  });
  const preview = useMutation({
    mutationFn: async () => {
      if (!policyVersionId || !validSelection)
        throw new Error("Select 1 to 100 work items and a policy.");
      const decisions = await previewWorkItemPolicyBackfill({
        data: {
          policyVersionId,
          items: items.map((item) => ({ workItemId: item.id, expectedVersion: item.version })),
        },
      });
      const eligible = decisions.flatMap((decision) =>
        decision.state === "eligible" && decision.preview ? [decision.preview] : [],
      );
      if (eligible.length === 0) return { decisions, durable: null };
      const durable = await previewBulkOperation({
        data: {
          action: "attachSlaPolicies",
          selection: { kind: "ids", ids: eligible.map((item) => item.workItemId) },
          parameters: {
            policyVersionId,
            items: eligible.map((item) => ({
              workItemId: item.workItemId,
              expectedVersion: item.expectedVersion,
              startedAt: item.startedAt,
              warningAt: item.warningAt,
              dueAt: item.dueAt,
              previewHash: item.previewHash,
            })),
          },
        },
      });
      return { decisions, durable };
    },
  });
  const commit = useMutation({
    mutationFn: () => {
      if (!preview.data?.durable || preview.data.durable.eligibleCount < 1)
        throw new Error("A current batch preview with eligible items is required.");
      return commitBulkOperation({
        data: {
          previewId: preview.data.durable.id,
          previewHash: preview.data.durable.previewHash,
          idempotencyKey,
        },
      });
    },
    onSuccess: (operation) => onCommitted(operation.id),
    onError: () => preview.reset(),
  });
  const selectedChoice = choices.data?.find((choice) => choice.id === policyVersionId);
  const busy = preview.isPending || commit.isPending;
  const decisions: PolicyBackfillDecision[] = preview.data?.decisions ?? [];
  const durable = preview.data?.durable;

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>批量設定工作服務時限</DialogTitle>
          <DialogDescription>
            已選 {items.length}{" "}
            項工作。逐項預覽政策時限和衝突，再批准可套用的項目；執行結果可於工作佇列追蹤。
          </DialogDescription>
        </DialogHeader>
        {!validSelection ? (
          <p role="alert" className="text-sm text-destructive">
            每次須明確選擇 1 至 100 項工作。
          </p>
        ) : null}
        {validSelection && !representative ? (
          <p role="status">所選工作均已有服務時限，沒有可套用政策的項目。</p>
        ) : null}
        {choices.isPending ? <p role="status">正在讀取可用政策…</p> : null}
        {choices.isError ? (
          <p role="alert" className="text-sm text-destructive">
            無法讀取可用政策。請重新整理工作佇列。
          </p>
        ) : null}
        {choices.isSuccess && choices.data.length === 0 ? (
          <p role="status">此工作類型暫無可選政策版本。</p>
        ) : null}
        {choices.isSuccess && choices.data.length > 0 ? (
          <label className="grid gap-2 text-sm">
            政策版本
            <select
              aria-label="政策版本"
              value={policyVersionId}
              disabled={busy}
              onChange={(event) => {
                setPolicyVersionId(event.target.value);
                preview.reset();
                commit.reset();
              }}
              className="h-10 rounded-md border border-input bg-background px-3"
            >
              <option value="">選擇政策</option>
              {choices.data.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.name} · v{choice.version} · {choice.calendarName}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {selectedChoice ? (
          <p className="text-xs text-muted-foreground">
            提醒於 {selectedChoice.warningMinutes} 工作分鐘；期限於 {selectedChoice.dueMinutes}{" "}
            工作分鐘。
          </p>
        ) : null}
        {preview.isError ? (
          <p role="alert" className="text-sm text-destructive">
            預覽失敗：{errorText(preview.error)}。工作或政策可能已改動，請重新預覽。
          </p>
        ) : null}
        {preview.isSuccess ? (
          <div
            aria-label="批量服務時限預覽"
            className="space-y-2 rounded-md border border-border p-3 text-sm"
          >
            <p>
              可套用 {durable?.eligibleCount ?? 0} · 衝突{" "}
              {decisions.filter((item) => item.state === "conflict").length +
                (durable?.conflictCount ?? 0)}
            </p>
            {durable ? (
              <p className="text-xs text-muted-foreground">
                批准預覽有效至 {hongKongTime(durable.expiresAt)}
                ；執行前會再核對工作版本、政策及管理員權限。
              </p>
            ) : null}
            <ul className="max-h-44 space-y-1 overflow-auto text-xs">
              {decisions.map((decision) => (
                <li key={decision.workItemId}>
                  {items.find((item) => item.id === decision.workItemId)?.title ??
                    decision.workItemId}
                  {decision.preview
                    ? ` · 提醒 ${hongKongTime(decision.preview.warningAt)} · 期限 ${hongKongTime(decision.preview.dueAt)}`
                    : ` · ${decision.reasonCode ?? "CONFLICT"}`}
                </li>
              ))}
            </ul>
            {durable?.itemsPreview.some((item) => item.state !== "eligible") ? (
              <ul className="max-h-24 overflow-auto text-xs">
                {durable.itemsPreview
                  .filter((item) => item.state !== "eligible")
                  .map((item) => (
                    <li key={item.resourceId}>
                      {item.resourceId} · {item.reasonCode ?? item.state}
                    </li>
                  ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {commit.isError ? (
          <p role="alert" className="text-sm text-destructive">
            批准失敗：{errorText(commit.error)}。請重新預覽後再試。
          </p>
        ) : null}
        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => preview.mutate()}
            disabled={!selectedChoice || !validSelection || busy}
            className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-50"
          >
            預覽批量時限
          </button>
          <button
            type="button"
            onClick={() => commit.mutate()}
            disabled={!durable || durable.eligibleCount < 1 || busy}
            className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50"
          >
            批准批量套用
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
