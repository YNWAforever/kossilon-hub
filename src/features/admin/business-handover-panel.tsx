import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  listStaff,
  transferStaffBusinessHandover,
  getStaffBusinessHandoverReceipt,
} from "./server-fns";
import type { BusinessHandoverItem, BusinessHandoverReceipt } from "./types";
type Command = {
  userId: string;
  expectedVersion: number;
  recipientId: string;
  operationId: string;
  item: Pick<BusinessHandoverItem, "kind" | "id" | "version">;
};
export function BusinessHandoverPanel({
  userId,
  expectedVersion,
  teamId,
  actorScope,
  items,
  onUnconfirmedChange,
}: {
  userId: string;
  expectedVersion: number;
  teamId: string | null;
  actorScope: string;
  items: BusinessHandoverItem[];
  onUnconfirmedChange: (blocked: boolean) => void;
}) {
  const client = useQueryClient(),
    trigger = useRef<HTMLButtonElement | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [recipientId, setRecipient] = useState(""),
    [q, setQ] = useState(""),
    [command, setCommand] = useState<Command | null>(null),
    [unknown, setUnknown] = useState(false),
    [receipts, setReceipts] = useState<BusinessHandoverReceipt[]>([]);
  const staff = useQuery({
    queryKey: ["staff-admin", actorScope, "handover-recipient", teamId, q],
    queryFn: () =>
      listStaff({
        data: {
          active: true,
          ...(teamId ? { teamId } : {}),
          ...(q.trim() ? { q: q.trim() } : {}),
          limit: 50,
        },
      }),
    retry: false,
  });
  function refresh() {
    void client.invalidateQueries({ queryKey: ["staff-admin", actorScope] });
    void client.invalidateQueries({ queryKey: ["staff-admin", actorScope, "audit", userId] });
    void client.invalidateQueries({ queryKey: ["daily-work"] });
    void client.invalidateQueries({ queryKey: ["company-workspace"] });
  }
  function accept(receipt: BusinessHandoverReceipt) {
    setReceipts((r) => [...r.filter((i) => i.operationId !== receipt.operationId), receipt]);
    setUnknown(false);
    onUnconfirmedChange(false);
    setCommand(null);
    setDialogOpen(false);
    refresh();
  }
  const transfer = useMutation({
    mutationFn: (input: Command) => transferStaffBusinessHandover({ data: input }),
    retry: false,
    onSuccess: accept,
    onError: () => {
      setUnknown(true);
      onUnconfirmedChange(true);
    },
  });
  const reconcile = useMutation({
    mutationFn: () =>
      getStaffBusinessHandoverReceipt({ data: { userId, operationId: command!.operationId } }),
    retry: false,
    onSuccess: (r) => {
      if (r) accept(r);
    },
  });
  const busy = transfer.isPending || reconcile.isPending;
  const close = () => {
    if (!busy) {
      setDialogOpen(false);
      if (!unknown) setCommand(null);
    }
  };
  return (
    <section className="min-w-0 space-y-3 rounded-md border p-3" aria-label="業務交接">
      <h3 className="font-semibold">註冊／變更／客戶負責人交接</h3>
      <p>每項沿用預覽版本；相同確認保存同一回執。完成後重新盤點；AR 與工作隊列責任需分別轉交。</p>
      <label className="block">
        搜尋接手同事
        <input
          className="min-h-11 max-w-full rounded border px-3"
          value={q}
          disabled={busy || unknown}
          onChange={(e) => {
            setQ(e.target.value);
            setRecipient("");
          }}
        />
      </label>
      <label className="block">
        接手同事
        <select
          className="min-h-11 max-w-full rounded border px-3"
          value={recipientId}
          disabled={busy || unknown || staff.isError}
          onChange={(e) => setRecipient(e.target.value)}
        >
          <option value="">選擇同隊有效同事</option>
          {staff.data?.staff
            .filter(
              (s) => s.userId !== userId && s.role !== "Client" && s.active && !s.stateMismatch,
            )
            .map((s) => (
              <option key={s.userId} value={s.userId}>
                {s.displayName}
              </option>
            ))}
        </select>
      </label>
      <p>最多50名；搜尋涵蓋全部獲授權員工。</p>
      {staff.isError ? (
        <p role="alert">接手同事未能載入；請重試。支援編號：R22-HANDOVER-STAFF。</p>
      ) : null}
      {items.map((item) => (
        <div key={item.kind + item.id} className="flex flex-wrap items-center gap-3">
          <span className="break-words">
            {item.label} · {item.status}
          </span>
          <button
            className="min-h-11 rounded border px-3"
            type="button"
            disabled={!recipientId || busy || unknown}
            onClick={(e) => {
              trigger.current = e.currentTarget;
              setCommand({
                userId,
                expectedVersion,
                recipientId,
                operationId: crypto.randomUUID(),
                item: { kind: item.kind, id: item.id, version: item.version },
              });
              setDialogOpen(true);
              transfer.reset();
              reconcile.reset();
            }}
          >
            轉交 {item.label}
          </button>
        </div>
      ))}
      {receipts.map((r) => (
        <p key={r.operationId} role="status">
          {r.state === "succeeded"
            ? "這一項已轉交；仍需重新盤點。"
            : r.state === "rejected"
              ? "這一項未套用；更新員工／接手人及預覽後才可再轉交。"
              : "這一項版本或責任已改變；重新預覽後才可再轉交。"}{" "}
          回執：{r.operationId}
        </p>
      ))}
      {unknown && !dialogOpen ? (
        <div role="alert">
          原確認仍待核對；暫不可停用。
          <button
            type="button"
            className="min-h-11 rounded border px-3"
            disabled={busy}
            onClick={() => reconcile.mutate()}
          >
            核對已保存回執
          </button>
        </div>
      ) : null}
      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent
          className="max-w-[calc(100vw-2rem)] sm:max-w-lg"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            trigger.current?.focus();
          }}
        >
          <DialogTitle>確認業務交接</DialogTitle>
          <DialogDescription>
            只轉交本項負責人；不批准文件、款項或交件。完成後請重新盘點。
          </DialogDescription>
          <p>
            {items.find((i) => i.id === command?.item.id)?.label ?? "原預覽項目"} →{" "}
            {staff.data?.staff.find((s) => s.userId === command?.recipientId)?.displayName ??
              "原確認接手同事"}
          </p>
          {unknown ? (
            <div role="alert">
              本次結果未確認；保留原確認，先核對已保存回執。沒有自動重試。支援編號：R22-HANDOVER-UNKNOWN。
              <button
                type="button"
                className="min-h-11 rounded border px-3"
                disabled={busy}
                onClick={close}
              >
                保留確認並關閉
              </button>
              <button
                type="button"
                className="min-h-11 rounded border px-3"
                disabled={busy}
                onClick={() => reconcile.mutate()}
              >
                核對已保存回執
              </button>
              {reconcile.isSuccess && !reconcile.data ? (
                <p>暫未找到回執；請再核對，或由 Admin 查閱原操作。仍不可標為完成。</p>
              ) : null}
              {reconcile.isError ? <p>回執未能讀取；請重試核對。</p> : null}
            </div>
          ) : (
            <div className="flex flex-wrap gap-3">
              <button
                className="min-h-11 rounded border px-3"
                type="button"
                disabled={busy}
                onClick={close}
              >
                取消
              </button>
              <button
                className="min-h-11 rounded border px-3"
                type="button"
                disabled={busy || !command}
                onClick={() => command && transfer.mutate(command)}
              >
                確認轉交這一項
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
