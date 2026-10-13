import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DeadlinePill } from "@/components/deadline-pill";
import {
  SERVICE_TYPE_DEFAULT_FEES,
  SERVICE_TYPE_LABELS,
} from "@/features/service-subscriptions/constants";
import { SERVICE_TYPES, type ServiceType } from "@/features/service-subscriptions/types";
import {
  addServiceSubscription,
  cancelServiceSubscription,
  listServiceSubscriptions,
  renewServiceSubscription,
} from "@/features/service-subscriptions/server-fns";

type Props = { companyId: string };

function defaultRenewalDate(): string {
  const oneYearFromNow = new Date();
  oneYearFromNow.setUTCFullYear(oneYearFromNow.getUTCFullYear() + 1);
  return oneYearFromNow.toISOString().slice(0, 10);
}

export function ServiceSubscriptionsSection({ companyId }: Props) {
  const queryClient = useQueryClient();
  const queryKey = ["service-subscriptions", companyId];
  const [isAddOpen, setIsAddOpen] = useState(false);

  const subscriptionsQuery = useQuery({
    queryKey,
    queryFn: () => listServiceSubscriptions({ data: { companyId } }),
    retry: false,
  });

  const renewMutation = useMutation({
    mutationFn: (subscriptionId: string) =>
      renewServiceSubscription({ data: { subscriptionId, companyId } }),
    onSuccess: () => {
      toast.success("已更新續期。");
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: () => toast.error("未能為訂閱續期，請再試一次。"),
  });

  const cancelMutation = useMutation({
    mutationFn: (subscriptionId: string) =>
      cancelServiceSubscription({ data: { subscriptionId, companyId } }),
    onSuccess: () => {
      toast.success("已取消訂閱。");
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: () => toast.error("未能取消訂閱，請再試一次。"),
  });

  const subscriptions = subscriptionsQuery.data ?? [];
  const activeTypes = new Set(
    subscriptions.filter((row) => row.status === "Active").map((row) => row.serviceType),
  );
  const offeredTypes = SERVICE_TYPES.filter((type) => !activeTypes.has(type));

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">服務訂閱</h2>
        {offeredTypes.length > 0 ? (
          <Button size="sm" onClick={() => setIsAddOpen(true)}>
            新增訂閱
          </Button>
        ) : null}
      </div>

      {subscriptionsQuery.isError ? (
        <p role="alert" className="mb-3 text-sm text-destructive">
          服務訂閱暫時無法載入，請稍後再試。
        </p>
      ) : null}

      <div className="divide-y">
        {subscriptions.map((subscription) => (
          <div
            key={subscription.id}
            className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
          >
            <span className="min-w-0 truncate font-medium">
              {SERVICE_TYPE_LABELS[subscription.serviceType]}
            </span>
            <span className="text-muted-foreground">HKD {subscription.fee.toLocaleString()}</span>
            {subscription.status === "Active" ? (
              <DeadlinePill dueDate={subscription.renewalDate} />
            ) : (
              <span className="text-xs text-muted-foreground">已取消</span>
            )}
            {subscription.status === "Active" ? (
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  disabled={renewMutation.isPending && renewMutation.variables === subscription.id}
                  onClick={() => renewMutation.mutate(subscription.id)}
                >
                  標記已續期
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={
                    cancelMutation.isPending && cancelMutation.variables === subscription.id
                  }
                  onClick={() => cancelMutation.mutate(subscription.id)}
                >
                  取消訂閱
                </Button>
              </div>
            ) : null}
          </div>
        ))}
        {!subscriptionsQuery.isPending && subscriptions.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">未有服務訂閱紀錄。</p>
        ) : null}
      </div>

      <AddSubscriptionDialog
        open={isAddOpen}
        onOpenChange={setIsAddOpen}
        companyId={companyId}
        offeredTypes={offeredTypes}
        onAdded={() => void queryClient.invalidateQueries({ queryKey })}
      />
    </section>
  );
}

function AddSubscriptionDialog({
  open,
  onOpenChange,
  companyId,
  offeredTypes,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  offeredTypes: readonly ServiceType[];
  onAdded: () => void;
}) {
  const [serviceType, setServiceType] = useState<ServiceType | "">("");
  const [fee, setFee] = useState("");
  const [renewalDate, setRenewalDate] = useState(defaultRenewalDate());
  const [saving, setSaving] = useState(false);

  // Resets on every open, not just after a successful submit — otherwise
  // dismissing without submitting (Cancel, Escape, overlay click) leaves a
  // stale fee/renewal-date pre-filled the next time the dialog opens, which
  // may now be for a different service type entirely.
  useEffect(() => {
    if (!open) return;
    setServiceType("");
    setFee("");
    setRenewalDate(defaultRenewalDate());
  }, [open]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!serviceType) return;
    setSaving(true);

    try {
      await addServiceSubscription({
        data: {
          companyId,
          serviceType,
          fee: Number.parseInt(fee, 10),
          renewalDate,
        },
      });
      toast.success("已新增訂閱。");
      onAdded();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "未能新增訂閱。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>新增訂閱</DialogTitle>
          <DialogDescription>開始追蹤此公司的定期服務。</DialogDescription>
        </DialogHeader>

        {offeredTypes.length === 0 ? (
          <p className="text-sm text-muted-foreground">所有服務均已有有效訂閱。</p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label
                className="text-[10px] uppercase tracking-wider text-muted-foreground"
                htmlFor="subscription-type"
              >
                服務
              </label>
              <select
                id="subscription-type"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                value={serviceType}
                onChange={(event) => {
                  const nextType = event.target.value as ServiceType;
                  setServiceType(nextType);
                  setFee(String(SERVICE_TYPE_DEFAULT_FEES[nextType]));
                }}
                required
              >
                <option value="" disabled>
                  選擇服務
                </option>
                {offeredTypes.map((type) => (
                  <option key={type} value={type}>
                    {SERVICE_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                className="text-[10px] uppercase tracking-wider text-muted-foreground"
                htmlFor="subscription-fee"
              >
                費用（HKD）
              </label>
              <input
                id="subscription-fee"
                type="number"
                min="1"
                step="1"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                value={fee}
                onChange={(event) => setFee(event.target.value)}
                required
              />
            </div>
            <div>
              <label
                className="text-[10px] uppercase tracking-wider text-muted-foreground"
                htmlFor="subscription-renewal"
              >
                續期日期
              </label>
              <input
                id="subscription-renewal"
                type="date"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                value={renewalDate}
                onChange={(event) => setRenewalDate(event.target.value)}
                required
              />
            </div>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                取消
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={saving}>
                {saving ? "新增中…" : "新增訂閱"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
