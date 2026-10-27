import { LoadingRows } from "@/components/ui/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { annualReturnQueryKeys } from "../query-keys";
import type { ProductionFollowUpDraft } from "../follow-ups";
import { listProductionFollowUpDrafts, sendProductionFollowUp } from "../follow-up-server-fns";
import { getWhatsAppIntegrationStatus } from "@/features/whatsapp/server-fns";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { BulkSelectionToolbar } from "@/components/bulk-selection-toolbar";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未能將跟進加入發送隊列。";
}

function typeLabel(source: ProductionFollowUpDraft["source"]): string {
  if (source === "document-review") return "補交文件";
  if (source === "payment-proof-review") return "補交付款證明";
  return "周年申報";
}

const STATUS_LABELS: Record<ProductionFollowUpDraft["status"], string> = {
  draft: "草稿",
  queued: "已排隊",
  provider_accepted: "供應商已接收；待回執",
  delivered: "已送達",
  failed: "失敗",
  unknown: "未知",
  blocked: "受阻",
};

export function ProductionWhatsAppAutomation(
  props: { actorScope?: string; canBulk?: boolean } = {},
) {
  return <AutomationSession key={props.actorScope ?? ""} {...props} />;
}

function AutomationSession({
  actorScope = "",
  canBulk = false,
}: { actorScope?: string; canBulk?: boolean } = {}) {
  const active = useRef(true);
  const submitting = useRef(false);
  const recovering = useRef(false);
  const uncertainRef = useRef<ProductionFollowUpDraft | null>(null);
  const [uncertain, setUncertain] = useState<ProductionFollowUpDraft | null>(null);
  const [recovery, setRecovery] = useState<"none" | "reading" | "failed" | "checked">("none");
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const draftKey = [...annualReturnQueryKeys.automationNotifications, actorScope];
  const [preview, setPreview] = useState<ProductionFollowUpDraft | null>(null);
  const queryClient = useQueryClient();
  const draftsQuery = useQuery({
    queryKey: draftKey,
    queryFn: () => listProductionFollowUpDrafts(),
    retry: false,
  });
  const integrationQuery = useQuery({
    queryKey: ["whatsapp-integration-status"],
    queryFn: () => getWhatsAppIntegrationStatus(),
  });
  const sendMutation = useMutation({
    retry: false,
    onError: (_error, draft) => {
      uncertainRef.current = draft;
      if (active.current) {
        setUncertain(draft);
        setPreview(null);
        setRecovery("none");
      }
    },
    onSettled: () => {
      submitting.current = false;
    },
    mutationFn: (draft: ProductionFollowUpDraft) =>
      sendProductionFollowUp({
        data: {
          source: draft.source,
          caseId: draft.caseId,
          entityId: draft.entityId,
          expectedVersion: draft.version,
        },
      }),
    onSuccess: (_result, draft) => {
      if (!active.current) return;
      setPreview((current) =>
        current?.source === draft.source && current.entityId === draft.entityId ? null : current,
      );
      return Promise.all([
        queryClient.invalidateQueries({
          queryKey: annualReturnQueryKeys.automationNotifications,
        }),
        queryClient.invalidateQueries({
          queryKey: annualReturnQueryKeys.notifications(draft.caseId),
        }),
      ]);
    },
  });

  async function reconcileSend() {
    const source = uncertainRef.current;
    if (!source || recovering.current || submitting.current) return;
    recovering.current = true;
    setRecovery("reading");
    try {
      await queryClient.cancelQueries({ queryKey: draftKey, exact: true });
      const fresh = await listProductionFollowUpDrafts();
      if (!Array.isArray(fresh)) throw new Error("Drafts unavailable");
      const matches = fresh.filter(
        (row) =>
          row &&
          row.source === source.source &&
          row.caseId === source.caseId &&
          row.entityId === source.entityId,
      );
      const row = matches[0];
      if (
        matches.length !== 1 ||
        !row ||
        typeof row.version !== "string" ||
        !row.version.trim() ||
        !Object.hasOwn(STATUS_LABELS, row.status)
      )
        throw new Error("Follow-up unavailable");
      await queryClient.cancelQueries({ queryKey: draftKey, exact: true });
      if (!active.current) return;
      await queryClient.invalidateQueries({
        queryKey: annualReturnQueryKeys.automationNotifications,
        refetchType: "none",
      });
      if (!active.current) return;
      queryClient.setQueryData(draftKey, fresh);
      void queryClient.invalidateQueries({
        queryKey: annualReturnQueryKeys.detail(source.caseId),
        refetchType: "none",
      });
      void queryClient.invalidateQueries({
        queryKey: annualReturnQueryKeys.history(source.caseId),
        refetchType: "none",
      });
      sendMutation.reset();
      uncertainRef.current = null;
      setUncertain(null);
      setPreview(null);
      setRecovery("checked");
    } catch {
      if (active.current) setRecovery("failed");
    } finally {
      recovering.current = false;
    }
  }

  const drafts = draftsQuery.data ?? [];
  // Bulk draft creation represents only cases with a draft in this displayed set.
  // Delivery/unknown rows remain visible for reconciliation, never bulk retry.
  const draftCases = [
    ...new Map(
      drafts
        .filter((d) => d.status === "draft")
        .map((d) => [d.caseId, { id: d.caseId, label: d.companyName }]),
    ).values(),
  ].sort((a, b) => a.id.localeCompare(b.id));
  const readBlocked = uncertain !== null || draftsQuery.isError || draftsQuery.isFetching;
  const currentPreview = preview
    ? drafts.find(
        (draft) =>
          draft.source === preview.source &&
          draft.caseId === preview.caseId &&
          draft.entityId === preview.entityId,
      )
    : undefined;
  const verifiedPreview =
    !readBlocked &&
    currentPreview?.status === "draft" &&
    typeof currentPreview.version === "string" &&
    Boolean(currentPreview.version.trim()) &&
    currentPreview.version === preview?.version
      ? currentPreview
      : null;
  const error = uncertain ? integrationQuery.error : (sendMutation.error ?? integrationQuery.error);
  const retryDrafts = () => void draftsQuery.refetch({ cancelRefetch: false });

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader eyebrow="通訊" title="WhatsApp 追件" />
      <p className="text-sm text-muted-foreground">
        供應商設定不代表連線正常。批准後會將已檢查的草稿加入發送隊列；只有回執才確認已送達。
      </p>
      {uncertain ? (
        <div role="alert" className="space-y-2 border p-3 text-sm">
          <p>跟進加入隊列的結果未能確認。請先重新核對目前狀態，避免重複操作。</p>
          <Button
            disabled={recovery === "reading" || sendMutation.isPending}
            onClick={() => void reconcileSend()}
          >
            重新核對跟進結果
          </Button>
          {recovery === "failed" ? (
            <p role="status">未能核實跟進結果，請稍後重新核對；沒有重試寫入。</p>
          ) : null}
        </div>
      ) : null}
      {recovery === "checked" ? (
        <p role="status">已重新核對跟進狀態。請先核對清單，沒有重新加入隊列。</p>
      ) : null}
      {canBulk && draftsQuery.data !== undefined ? (
        <BulkSelectionToolbar
          actorScope={actorScope}
          resource="annual_return_case"
          selectionDisabled={readBlocked}
          filters={{ draftCaseIds: draftCases.map((d) => d.id) }}
          page={draftCases}
          total={draftCases.length}
          pageSize={draftCases.length}
          maintenanceActions={["follow_up_draft"]}
        />
      ) : null}

      {integrationQuery.data?.deliveryMode === "simulated" ? (
        <div
          className="border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900"
          role="status"
        >
          <p className="font-medium">示範模擬</p>
          <p>不會向外發送任何 WhatsApp 或電郵訊息。</p>
        </div>
      ) : null}

      {error && !preview ? (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {errorMessage(error)}
        </div>
      ) : null}

      <section className="border bg-card">
        <div className="hidden grid-cols-[1.2fr_1fr_160px_110px_minmax(0,1.5fr)_120px] gap-3 border-b px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:grid">
          <span>公司</span>
          <span>收件人</span>
          <span>類別</span>
          <span>狀態</span>
          <span>預覽</span>
          <span className="text-right">操作</span>
        </div>
        <div className="divide-y">
          {uncertain ? (
            <p role="status" className="p-4 text-sm">
              跟進結果待核實，暫停新增隊列操作。
            </p>
          ) : draftsQuery.isPending || draftsQuery.isFetching ? (
            <LoadingRows label="正在載入跟進…" rows={4} />
          ) : draftsQuery.isError ? (
            <div role="alert" className="p-4 space-y-2 text-sm text-muted-foreground">
              <p>未能讀取跟進範圍，請重新載入。這不代表沒有跟進。</p>
              <Button disabled={draftsQuery.isFetching} onClick={retryDrafts}>
                重新載入跟進
              </Button>
            </div>
          ) : drafts.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">沒有待處理的跟進。</p>
          ) : (
            drafts.map((draft) => (
              <ProductionAutomationRow
                key={`${draft.source}-${draft.id}`}
                draft={draft}
                active={
                  sendMutation.isPending &&
                  sendMutation.variables?.source === draft.source &&
                  sendMutation.variables.entityId === draft.entityId
                }
                blocked={sendMutation.isPending}
                onSend={() => {
                  if (!submitting.current && !uncertainRef.current) setPreview(draft);
                }}
              />
            ))
          )}
        </div>
      </section>
      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open && !sendMutation.isPending) setPreview(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>批准跟進</DialogTitle>
            <DialogDescription>
              請確認收件人及完整草稿。加入發送隊列不代表已送達；超出對話時段時，可能改用已批准的模板。
            </DialogDescription>
          </DialogHeader>
          {verifiedPreview ? (
            <div className="space-y-3 text-sm">
              <p>{verifiedPreview.companyName}</p>
              <p>
                {verifiedPreview.recipientName} / {verifiedPreview.phone}
              </p>
              <p className="whitespace-pre-wrap break-words">{verifiedPreview.messagePreview}</p>
              <p className="text-muted-foreground">{verifiedPreview.reasonLabel}</p>
            </div>
          ) : null}
          {!verifiedPreview ? (
            <div role="alert" className="space-y-2 text-sm text-destructive">
              <p>草稿範圍或版本未能核實。請先重新讀取並核對目前草稿；沒有重送隊列操作。</p>
              {draftsQuery.isError ? (
                <Button disabled={draftsQuery.isFetching} onClick={retryDrafts}>
                  重新載入跟進
                </Button>
              ) : null}
              {!readBlocked && currentPreview?.status === "draft" ? (
                <Button onClick={() => setPreview(currentPreview)}>重新查看目前草稿</Button>
              ) : null}
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(error)}
            </p>
          ) : null}
          <DialogFooter>
            <Button disabled={sendMutation.isPending} onClick={() => setPreview(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              disabled={!verifiedPreview || sendMutation.isPending}
              onClick={() => {
                if (verifiedPreview && !submitting.current && !uncertainRef.current) {
                  submitting.current = true;
                  setRecovery("none");
                  sendMutation.mutate(verifiedPreview);
                }
              }}
            >
              批准並加入隊列
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function ProductionAutomationRow({
  draft,
  active,
  blocked,
  onSend,
}: {
  draft: ProductionFollowUpDraft;
  active: boolean;
  blocked: boolean;
  onSend: () => void;
}) {
  const disabled = blocked || active || draft.status !== "draft";
  return (
    <div className="grid gap-3 px-4 py-4 text-sm lg:grid-cols-[1.2fr_1fr_160px_110px_minmax(0,1.5fr)_120px] lg:items-center">
      <div className="min-w-0">
        <a className="font-medium hover:underline" href={`/annual-returns/${draft.caseId}`}>
          {draft.companyName}
        </a>
        <p className="text-muted-foreground">{draft.ownerName}</p>
      </div>
      <p className="truncate">
        {draft.recipientName && draft.phone
          ? `${draft.recipientName} / ${draft.phone}`
          : "沒有收件人資料"}
      </p>
      <p>{typeLabel(draft.source)}</p>
      <p>{STATUS_LABELS[draft.status] ?? draft.status}</p>
      <div className="min-w-0">
        <p className="truncate">{draft.messagePreview}</p>
        <p className="truncate text-xs text-muted-foreground">{draft.reasonLabel}</p>
      </div>
      <div className="flex justify-start lg:justify-end">
        <Button
          className="disabled:bg-muted disabled:text-muted-foreground"
          disabled={disabled}
          onClick={onSend}
        >
          {active
            ? "加入隊列中…"
            : draft.status === "provider_accepted"
              ? "待回執"
              : draft.status === "blocked"
                ? "受阻"
                : draft.status === "unknown"
                  ? "與供應商核對"
                  : draft.status === "failed"
                    ? "查看失敗原因"
                    : draft.status === "delivered"
                      ? "已送達"
                      : draft.status === "queued"
                        ? "已排隊"
                        : "預覽並批准"}
        </Button>
      </div>
    </div>
  );
}
