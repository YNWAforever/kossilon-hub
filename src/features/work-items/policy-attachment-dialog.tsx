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
import type { PersistedWorkItem, PolicyAttachmentPreview } from "./repository";
import {
  attachWorkItemPolicy,
  listWorkItemPolicyChoices,
  previewWorkItemPolicyAttachment,
} from "./server-fns";

function hongKongTime(value: string): string {
  return new Intl.DateTimeFormat("zh-HK", {
    timeZone: "Asia/Hong_Kong",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function PolicyAttachmentDialog({
  item,
  onClose,
  onAttached,
}: {
  item: PersistedWorkItem;
  onClose: () => void;
  onAttached: () => void;
}) {
  const [selectedPolicyId, setSelectedPolicyId] = useState("");
  const [preview, setPreview] = useState<PolicyAttachmentPreview | null>(null);
  const choices = useQuery({
    queryKey: ["work-item-policy-choices", item.id, item.version],
    queryFn: () =>
      listWorkItemPolicyChoices({
        data: { workItemId: item.id, expectedVersion: item.version },
      }),
    retry: false,
  });
  const previewAction = useMutation({
    mutationFn: () =>
      previewWorkItemPolicyAttachment({
        data: {
          workItemId: item.id,
          expectedVersion: item.version,
          policyVersionId: selectedPolicyId,
        },
      }),
    onSuccess: setPreview,
  });
  const applyAction = useMutation({
    mutationFn: () => {
      if (!preview) throw new Error("SLA policy preview is required.");
      return attachWorkItemPolicy({ data: preview });
    },
    onSuccess: onAttached,
    onError: () => setPreview(null),
  });
  const selectedChoice = choices.data?.find((choice) => choice.id === selectedPolicyId);
  const currentPreview = preview?.policyVersionId === selectedPolicyId ? preview : null;
  const busy = previewAction.isPending || applyAction.isPending;

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>設定工作服務時限</DialogTitle>
          <DialogDescription>{item.title}</DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          此工作尚未有服務時限。選擇此工作類型的政策版本，先核對實際時間，再確認套用。
        </p>
        {choices.isPending ? <p role="status">正在讀取可用政策…</p> : null}
        {choices.isError ? (
          <p role="alert" className="text-sm text-destructive">
            無法讀取可用政策。請關閉後重試；這不代表沒有政策。
          </p>
        ) : null}
        {choices.isSuccess && choices.data.length === 0 ? (
          <p role="status" className="text-sm text-muted-foreground">
            此工作類型暫無可選政策版本。
          </p>
        ) : null}
        {choices.isSuccess && choices.data.length > 0 ? (
          <label className="grid gap-2 text-sm">
            政策版本
            <select
              aria-label="政策版本"
              value={selectedPolicyId}
              disabled={busy}
              onChange={(event) => {
                setSelectedPolicyId(event.target.value);
                setPreview(null);
                previewAction.reset();
                applyAction.reset();
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
        {previewAction.isError ? (
          <p role="alert" className="text-sm text-destructive">
            無法產生預覽。工作或政策可能已改動，請重新讀取。
          </p>
        ) : null}
        {currentPreview ? (
          <div
            aria-label="服務時限預覽"
            className="space-y-2 rounded-md border border-border bg-muted/30 p-3 text-sm"
          >
            <p>開始：{hongKongTime(currentPreview.startedAt)}</p>
            <p>提醒：{hongKongTime(currentPreview.warningAt)}</p>
            <p>期限：{hongKongTime(currentPreview.dueAt)}</p>
            <p className="text-xs text-muted-foreground">
              確認後此工作項目的政策版本及時限不可更改。預覽 15 分鐘後失效。
            </p>
          </div>
        ) : null}
        {applyAction.isError ? (
          <p role="alert" className="text-sm text-destructive">
            套用失敗；可能是預覽過期、工作已變更或權限已更新。請重新預覽。
          </p>
        ) : null}
        <DialogFooter>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!selectedChoice || busy || choices.isError}
            onClick={() => {
              setPreview(null);
              previewAction.mutate();
            }}
            className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-50"
          >
            預覽時限
          </button>
          <button
            type="button"
            disabled={!selectedChoice || !currentPreview || busy}
            onClick={() => applyAction.mutate()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            確認套用
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
