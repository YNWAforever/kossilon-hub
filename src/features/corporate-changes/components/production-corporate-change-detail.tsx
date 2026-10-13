import { LoadingRows } from "@/components/ui/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { PageHeader } from "@/components/page-header";
import {
  cancelCorporateChangeRequest,
  completeCorporateChangeRequest,
  getCorporateChangeRequest,
  updateCorporateChangeChecklistItemStatus,
} from "../server-fns";
import type { ChecklistItemStatus } from "../types";
import {
  CHECKLIST_ITEM_STATUS_LABELS,
  CORPORATE_CHANGE_STATUS_LABELS,
  CORPORATE_CHANGE_TYPE_LABELS,
} from "../labels";

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
    onError: () => toast.error("未能更新清單項目，請再試一次。"),
  });

  const complete = useMutation({
    mutationFn: () => completeCorporateChangeRequest({ data: { requestId } }),
    onSuccess: () => {
      toast.success("公司變更申請已完成。");
      invalidate();
    },
    onError: () => toast.error("未能完成此申請，請再試一次。"),
  });

  const cancel = useMutation({
    mutationFn: () => cancelCorporateChangeRequest({ data: { requestId } }),
    onSuccess: () => {
      toast.success("公司變更申請已取消。");
      invalidate();
    },
    onError: () => toast.error("未能取消此申請，請再試一次。"),
  });

  if (requestQuery.isPending) {
    return (
      <main className="flex-1 space-y-6 p-4 md:p-6">
        <PageHeader eyebrow="案件與客戶" title="公司變更申請" />
        <LoadingRows label="正在載入公司變更申請…" rows={6} className="p-6" />
      </main>
    );
  }

  const request = requestQuery.data;

  if (requestQuery.isError || !request) {
    return (
      <main className="flex-1 space-y-3 p-4 md:p-6">
        <PageHeader eyebrow="案件與客戶" title="公司變更申請" />
        <p role="alert" className="text-sm text-destructive">
          未能載入此申請。
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
        eyebrow="案件與客戶"
        title="公司變更申請"
        actions={
          <>
            <Button
              variant="primary"
              onClick={() => complete.mutate()}
              disabled={!canComplete || complete.isPending}
            >
              完成
            </Button>
            <Button onClick={() => cancel.mutate()} disabled={!canCancel || cancel.isPending}>
              取消申請
            </Button>
          </>
        }
      />

      <section className="rounded-lg border bg-card p-4">
        <dl className="grid gap-4 md:grid-cols-3">
          <div>
            <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              變更類別
            </dt>
            <dd className="mt-1 text-sm">
              {CORPORATE_CHANGE_TYPE_LABELS[request.changeType] ?? request.changeType}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              狀態
            </dt>
            <dd className="mt-1 text-sm">
              {CORPORATE_CHANGE_STATUS_LABELS[request.status] ?? request.status}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              報價
            </dt>
            <dd className="mt-1 text-sm">HKD {request.quotedFee.toLocaleString()}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">清單</h2>
        <div className="divide-y">
          {request.checklistItems.map((item) => (
            <div key={item.id} className="flex items-center justify-between gap-3 py-3">
              <span className="min-w-0 truncate text-sm">
                {item.itemLabel}
                {item.required ? "" : "（選填）"}
              </span>
              <Select
                size="sm"
                aria-label={`${item.itemLabel} 狀態`}
                className="shrink-0"
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
                <option value="Missing">{CHECKLIST_ITEM_STATUS_LABELS.Missing}</option>
                <option value="Received">{CHECKLIST_ITEM_STATUS_LABELS.Received}</option>
                <option value="Verified">{CHECKLIST_ITEM_STATUS_LABELS.Verified}</option>
                <option value="Rejected">{CHECKLIST_ITEM_STATUS_LABELS.Rejected}</option>
              </Select>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
