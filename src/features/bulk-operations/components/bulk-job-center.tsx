import { useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listBulkJobs,
  getBulkJob,
  resumeBulkJob,
  cancelBulkJob,
  retryFailedBulkItems,
  reconcileUnknownBulkItems,
  exportBulkResults,
} from "../server-fns";
import type { BulkJobCursor } from "../types";
import { bulkOperationLabels, bulkResourceHref, bulkPollInterval } from "../job-view";
export function BulkJobCenter({
  actorScope,
  jobId,
  onJobChange,
}: {
  actorScope: string;
  jobId: string | null;
  onJobChange: (id: string | null) => void;
}) {
  const client = useQueryClient();
  const [visible, setVisible] = useState(
      () => typeof document !== "undefined" && document.visibilityState === "visible",
    ),
    [operation, setOperation] = useState("all"),
    [from, setFrom] = useState(""),
    [to, setTo] = useState("");
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const filters = {
    ...(operation === "all" ? {} : { operation: operation as keyof typeof bulkOperationLabels }),
    ...(from ? { createdFrom: new Date(from).toISOString() } : {}),
    ...(to ? { createdTo: new Date(to).toISOString() } : {}),
    limit: 20,
  };
  const jobs = useInfiniteQuery({
    queryKey: ["bulk-jobs", actorScope, "saved", filters],
    queryFn: ({ pageParam }) =>
      listBulkJobs({ data: { ...filters, ...(pageParam ? { cursor: pageParam } : {}) } }),
    initialPageParam: undefined as BulkJobCursor | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    retry: false,
    refetchInterval: (q) =>
      visible &&
      q.state.data?.pages.some((p) =>
        ["queued", "running"].includes(
          p.jobs.find((j) => ["queued", "running"].includes(j.state))?.state ?? "",
        ),
      )
        ? Math.min(5000 * 2 ** Math.min(q.state.fetchFailureCount, 4), 60000)
        : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const result = useInfiniteQuery({
    queryKey: ["bulk-jobs", actorScope, "detail", jobId],
    queryFn: ({ pageParam }) =>
      getBulkJob({
        data: { jobId: jobId!, ...(pageParam !== undefined ? { cursor: pageParam } : {}) },
      }),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    enabled: !!jobId,
    retry: false,
    refetchInterval: (q) =>
      bulkPollInterval(visible, q.state.data?.pages[0]?.state, q.state.fetchFailureCount),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const first = result.data?.pages[0];
  const items = result.data?.pages.flatMap((p) => p.items) ?? [];
  function refreshed() {
    void client.invalidateQueries({ queryKey: ["bulk-jobs", actorScope] });
    void client.invalidateQueries({ queryKey: ["annual-returns"] });
    void client.invalidateQueries({ queryKey: ["annual-return"] });
    void client.invalidateQueries({ queryKey: ["work-queue"] });
    void client.invalidateQueries({ queryKey: ["staff-admin"] });
    void client.invalidateQueries({ queryKey: ["clients"] });
    void client.invalidateQueries({ queryKey: ["documents"] });
  }
  const resume = useMutation({
    mutationFn: () => resumeBulkJob({ data: { jobId: jobId! } }),
    retry: false,
    onSuccess: refreshed,
  });
  const cancel = useMutation({
    mutationFn: () => cancelBulkJob({ data: { jobId: jobId! } }),
    retry: false,
    onSuccess: refreshed,
  });
  const retry = useMutation({
    mutationFn: () => retryFailedBulkItems({ data: { jobId: jobId! } }),
    retry: false,
    onSuccess: refreshed,
  });
  const reconcile = useMutation({
    mutationFn: () => reconcileUnknownBulkItems({ data: { jobId: jobId! } }),
    retry: false,
    onSuccess: refreshed,
  });
  const exporting = useMutation({
    mutationFn: () => exportBulkResults({ data: { jobId: jobId! } }),
    retry: false,
    onSuccess: (data) => {
      const url = URL.createObjectURL(new Blob([data.csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "bulk-assignment-results.csv";
      a.click();
      URL.revokeObjectURL(url);
    },
  });
  const busy = resume.isPending || cancel.isPending || retry.isPending || reconcile.isPending;
  return (
    <section aria-label="批次工作中心" className="min-w-0 space-y-3 border-t pt-3">
      <h2 className="font-semibold">批次工作中心</h2>
      <p>只讀取本人的已核准工作；伺服器在每次讀取及執行時重新核對授權。</p>
      <a className="inline-flex min-h-11 items-center underline" href="/bulk-jobs">
        開啟完整批次工作中心
      </a>
      <div className="flex flex-wrap gap-3">
        <label>
          操作篩選
          <select
            className="min-h-11 max-w-full rounded border px-3"
            value={operation}
            onChange={(e) => setOperation(e.target.value)}
          >
            <option value="all">全部操作</option>
            {Object.entries(bulkOperationLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          建立時間由（本機時區）
          <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          建立時間至（本機時區）
          <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <label>
        已保存工作
        <select
          aria-label="Saved bulk job"
          value={jobId ?? ""}
          onChange={(e) => onJobChange(e.target.value || null)}
        >
          <option value="">選擇工作以恢復進度</option>
          {jobs.data?.pages
            .flatMap((p) => p.jobs)
            .map((j) => (
              <option key={j.jobId} value={j.jobId}>
                {new Date(j.createdAt).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" })} ·{" "}
                {j.total}筆 · {j.state} · {j.operationLabel ?? "操作待核對"} ·{" "}
                {j.actorName ?? "操作者待核對"}
              </option>
            ))}
        </select>
      </label>
      {jobs.hasNextPage ? (
        <button
          disabled={jobs.isFetchingNextPage}
          onClick={() => void jobs.fetchNextPage({ cancelRefetch: false })}
        >
          載入較早的工作
        </button>
      ) : null}
      {jobs.isError ? <p role="alert">未能讀取已保存工作，請重新載入。</p> : null}
      {jobId ? <button onClick={() => void result.refetch()}>刷新工作結果</button> : null}
      {first ? (
        <>
          <p>
            {first.operationLabel ?? "操作待核對"} · {first.scopeSummary ?? "範圍待核對"} ·{" "}
            {first.actorName ?? "操作者待核對"}
          </p>
          <p>
            建立：{first.createdAt ?? "待核對"} · 開始：{first.startedAt ?? "待核對"} · 更新：
            {first.updatedAt ?? "待核對"}
          </p>
          <p>
            worker 心跳：{first.lastHeartbeat ?? "待核對"} · 最近逐項回執：
            {first.lastWorkerReceiptAt ?? "待核對"}。讀取時間不代表 worker 心跳。
          </p>
          <p>
            工作{first.state}；共{first.total}；成功{first.counts.succeeded ?? 0}；待處理
            {first.counts.pending ?? 0}；鎖定{first.counts.locked ?? 0}；無權
            {first.counts.forbidden ?? 0}；衝突{first.counts.conflict ?? 0}；失敗
            {first.counts.failed ?? 0}；結果未知{first.counts.unknown ?? 0}；取消
            {first.counts.cancelled ?? 0}
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              disabled={busy || !["queued", "running"].includes(first.state)}
              onClick={() => resume.mutate()}
            >
              恢復處理最多100筆（人工核對後）
            </button>
            <button
              disabled={busy || !["queued", "running"].includes(first.state)}
              onClick={() => cancel.mutate()}
            >
              取消尚未開始項目
            </button>
            <button disabled={busy || !first.retryableFailedCount} onClick={() => retry.mutate()}>
              只重試可重試失敗
            </button>
            {(first.counts.unknown ?? 0) > 0 ? (
              <button disabled={busy} onClick={() => reconcile.mutate()}>
                先核對未知結果
              </button>
            ) : null}
            <button disabled={exporting.isPending} onClick={() => exporting.mutate()}>
              匯出可查閱結果
            </button>
          </div>
          <p>衝突需重新預覽；取消保留成功項。匯出結果不等於交件。</p>
          {items.map((i) => (
            <p key={i.ordinal}>
              {i.resourceId && i.resourceLabel ? (
                <>
                  <a className="underline" href={bulkResourceHref(first.resource, i.resourceId)}>
                    {i.resourceLabel}
                  </a>{" "}
                  ·{" "}
                </>
              ) : (
                "無權查閱此項 · "
              )}
              {i.state} · {i.reason ?? "已保存"} · 嘗試{i.attempts}
              {i.output ? (
                <span>
                  {" "}
                  · {String(i.output.kind)} ·{" "}
                  {String(
                    i.output.messagePreview ??
                      i.output.reason ??
                      i.output.fileName ??
                      i.output.invoiceNumber ??
                      "已保存結果",
                  )}{" "}
                  {i.output.approvalRequired ? "（草稿，須單筆覆核）" : ""}
                </span>
              ) : null}
            </p>
          ))}
          {result.hasNextPage ? (
            <button
              disabled={result.isFetchingNextPage}
              onClick={() => void result.fetchNextPage({ cancelRefetch: false })}
            >
              載入更多逐筆結果
            </button>
          ) : null}
        </>
      ) : null}
      {result.isError ? <p role="alert">工作結果未能刷新；保留上次結果，請重新核對。</p> : null}
      {resume.isError || cancel.isError || retry.isError || reconcile.isError ? (
        <p role="alert">工作操作未確認；請先刷新結果。沒有自動重試，已保存成功項不會重做。</p>
      ) : null}
      {exporting.isError ? <p role="alert">未能匯出結果。</p> : null}
    </section>
  );
}
