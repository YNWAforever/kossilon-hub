import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assignmentLabels } from "@/features/work-items/assignment-labels";
import {
  createBulkSelectionSnapshot,
  getBulkSnapshotMembership,
  previewBulkAssignment,
  executeBulkAssignment,
  listBulkJobs,
  getBulkJob,
  resumeBulkJob,
  cancelBulkJob,
  retryFailedBulkItems,
  reconcileUnknownBulkItems,
  exportBulkResults,
  listBulkAssignees,
} from "@/features/bulk-operations/server-fns";
import type {
  BulkResource,
  BulkFilters,
  BulkSelection,
  BulkPreview,
} from "@/features/bulk-operations/types";
type Props = {
  actorScope: string;
  resource: BulkResource;
  filters: BulkFilters;
  page: readonly { id: string; label: string }[];
  total: number | null;
  pageSize?: number;
};
/** Changing actor replaces the entire session; changing filters replaces selection only. */
export function BulkSelectionToolbar(props: Props) {
  return <BulkSession key={props.actorScope} {...props} />;
}
function BulkSession(props: Props) {
  const [jobId, setJobId] = useState<string | null>(null);
  return (
    <section aria-label="Bulk assignment" className="space-y-3 rounded border p-4">
      <SelectionControls
        key={JSON.stringify([props.resource, props.filters])}
        {...props}
        onCreated={setJobId}
      />
      <BulkJobProgress actorScope={props.actorScope} jobId={jobId} onJobChange={setJobId} />
    </section>
  );
}
function SelectionControls({
  actorScope,
  resource,
  filters,
  page,
  total,
  pageSize = 50,
  onCreated,
}: Props & { onCreated: (jobId: string) => void }) {
  const [selection, setSelection] = useState<BulkSelection>({ mode: "explicit_ids", ids: [] }),
    [fixedCount, setFixedCount] = useState(0),
    [assigneeId, setAssigneeId] = useState(""),
    [target, setTarget] = useState<"owner" | "reviewer">("owner"),
    [overrideReason, setOverrideReason] = useState("");
  const [preview, setPreview] = useState<BulkPreview | null>(null),
    [request, setRequest] = useState<{ previewId: string; idempotencyKey: string } | null>(null);
  const client = useQueryClient();
  const assignees = useQuery({
    queryKey: ["bulk-assignees", actorScope],
    queryFn: () => listBulkAssignees({ data: {} }),
    retry: false,
  });
  const labels = assignmentLabels(
    (assignees.data ?? []).map((s) => ({
      userId: s.id,
      displayName: s.name,
      teamName: s.teamName,
      active: true,
      workload: 0,
    })),
  );
  const membership = useQuery({
    queryKey: [
      "bulk-snapshot-membership",
      actorScope,
      selection.mode === "filtered_snapshot" ? selection.snapshotId : null,
      page.map((i) => i.id),
    ],
    queryFn: () =>
      getBulkSnapshotMembership({
        data: {
          snapshotId: selection.mode === "filtered_snapshot" ? selection.snapshotId : "",
          ids: page.map((i) => i.id),
        },
      }),
    enabled: selection.mode === "filtered_snapshot",
    retry: false,
  });
  const known = new Set(membership.data?.ids ?? []);
  const snapshot = useMutation({
    mutationFn: () => createBulkSelectionSnapshot({ data: { resource, filters } }),
    retry: false,
    onSuccess: (s) => {
      setSelection({ mode: "filtered_snapshot", snapshotId: s.snapshotId, excludedIds: [] });
      setFixedCount(s.count);
      setPreview(null);
      setRequest(null);
    },
  });
  const dryRun = useMutation({
    mutationFn: () =>
      previewBulkAssignment({
        data: {
          resource,
          selection,
          assignment: {
            target,
            assigneeId,
            ...(overrideReason.trim() ? { overrideReason: overrideReason.trim() } : {}),
          },
        },
      }),
    retry: false,
    onSuccess: (p) => {
      setPreview(p);
      setRequest({ previewId: p.previewId, idempotencyKey: crypto.randomUUID() });
    },
  });
  const execute = useMutation({
    mutationFn: () => {
      if (!request) throw new Error("Current preview required");
      return executeBulkAssignment({ data: request });
    },
    retry: false,
    onSuccess: (j) => {
      onCreated(j.jobId);
      void client.invalidateQueries({ queryKey: ["bulk-jobs", actorScope] });
    },
  });
  function change(next: BulkSelection) {
    setSelection(next);
    setPreview(null);
    setRequest(null);
    dryRun.reset();
    execute.reset();
  }
  function toggle(id: string) {
    if (selection.mode === "explicit_ids")
      change({
        ...selection,
        ids: selection.ids.includes(id)
          ? selection.ids.filter((i) => i !== id)
          : [...selection.ids, id],
      });
    else if (known.has(id))
      change({
        ...selection,
        excludedIds: selection.excludedIds.includes(id)
          ? selection.excludedIds.filter((i) => i !== id)
          : [...selection.excludedIds, id],
      });
  }
  const count =
    selection.mode === "explicit_ids"
      ? selection.ids.length
      : fixedCount - selection.excludedIds.length;
  const busy = snapshot.isPending || dryRun.isPending || execute.isPending;
  return (
    <div className="space-y-3">
      <h2 className="font-semibold">批量分派</h2>
      <p>
        每頁{pageSize}；已載入{page.length}；全部{total ?? "未知"}
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          disabled={busy || page.length === 0}
          onClick={() => change({ mode: "explicit_ids", ids: page.map((p) => p.id) })}
        >
          選取已載入紀錄
        </button>
        <button disabled={busy || total === null} onClick={() => snapshot.mutate()}>
          選取全部篩選結果
        </button>
        <button disabled={busy} onClick={() => change({ mode: "explicit_ids", ids: [] })}>
          清空選取
        </button>
      </div>
      <p>已選取{count}筆</p>
      {selection.mode === "filtered_snapshot" ? (
        <p>
          已固定全部{fixedCount}；排除{selection.excludedIds.length}。其後新增紀錄不在本次範圍。
        </p>
      ) : null}
      <details>
        <summary>核對已載入紀錄與排除項</summary>
        <div className="max-h-60 overflow-auto">
          {page.map((p) => (
            <label className="block" key={p.id}>
              <input
                type="checkbox"
                aria-label={`Select ${p.label}`}
                checked={
                  selection.mode === "explicit_ids"
                    ? selection.ids.includes(p.id)
                    : known.has(p.id) && !selection.excludedIds.includes(p.id)
                }
                disabled={
                  busy ||
                  (selection.mode === "filtered_snapshot" &&
                    (!known.has(p.id) || membership.isError || membership.isPending))
                }
                onChange={() => toggle(p.id)}
              />
              {p.label}
            </label>
          ))}
        </div>
      </details>
      <label>
        責任
        <select
          aria-label="Bulk responsibility"
          disabled={busy}
          value={target}
          onChange={(e) => {
            setTarget(e.target.value as typeof target);
            setPreview(null);
            setRequest(null);
          }}
        >
          <option value="owner">Owner</option>
          <option value="reviewer">Reviewer</option>
        </select>
      </label>
      <label>
        員工
        <select
          aria-label="Bulk assignee"
          disabled={busy || assignees.isError}
          value={assigneeId}
          onChange={(e) => {
            setAssigneeId(e.target.value);
            setPreview(null);
            setRequest(null);
          }}
        >
          <option value="">選擇有效員工</option>
          {assignees.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {labels.get(s.id)}
            </option>
          ))}
        </select>
      </label>
      {resource === "work_item" ? (
        <label>
          非首選或超額原因
          <input
            aria-label="Bulk override reason"
            value={overrideReason}
            disabled={busy}
            onChange={(e) => {
              setOverrideReason(e.target.value);
              setPreview(null);
              setRequest(null);
            }}
          />
        </label>
      ) : null}
      <button
        disabled={
          busy ||
          count === 0 ||
          !assigneeId ||
          assignees.isError ||
          (selection.mode === "filtered_snapshot" && membership.isError)
        }
        onClick={() => dryRun.mutate()}
      >
        預覽批量分派
      </button>
      {preview ? (
        <div role="status">
          <p>
            預覽{preview.count}筆；可分派{preview.eligibleCount}；鎖定{preview.reasons.locked}；無權
            {preview.reasons.forbidden}；版本衝突{preview.reasons.conflict}；不合條件
            {preview.reasons.failed}
          </p>
          <p>批准固定範圍後，伺服器仍會逐筆重新核對權限與版本。</p>
          <button
            disabled={busy || preview.eligibleCount === 0 || !request}
            onClick={() => execute.mutate()}
          >
            批准並建立分派工作
          </button>
        </div>
      ) : null}
      {snapshot.isError || dryRun.isError || assignees.isError || membership.isError ? (
        <p role="alert">未能取得當前範圍、員工或預覽；請重新核對，暫不套用。</p>
      ) : null}
      {execute.isError ? (
        <p role="alert">
          操作結果未確認。請先查看已保存工作；若需核對本次批准，可用同一確認再次查核。沒有自動重試。
        </p>
      ) : null}
    </div>
  );
}
function BulkJobProgress({
  actorScope,
  jobId,
  onJobChange,
}: {
  actorScope: string;
  jobId: string | null;
  onJobChange: (id: string | null) => void;
}) {
  const client = useQueryClient();
  const jobs = useQuery({
    queryKey: ["bulk-jobs", actorScope, "saved"],
    queryFn: () => listBulkJobs({ data: {} }),
    retry: false,
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
  });
  const first = result.data?.pages[0];
  const items = result.data?.pages.flatMap((p) => p.items) ?? [];
  function refreshed() {
    void client.invalidateQueries({ queryKey: ["bulk-jobs", actorScope] });
    void client.invalidateQueries({ queryKey: ["annual-returns"] });
    void client.invalidateQueries({ queryKey: ["annual-return"] });
    void client.invalidateQueries({ queryKey: ["work-queue"] });
    void client.invalidateQueries({ queryKey: ["staff-admin"] });
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
    <div className="space-y-2 border-t pt-3">
      <label>
        已保存工作
        <select
          aria-label="Saved bulk job"
          value={jobId ?? ""}
          onChange={(e) => onJobChange(e.target.value || null)}
        >
          <option value="">選擇工作以恢復進度</option>
          {jobs.data?.map((j) => (
            <option key={j.jobId} value={j.jobId}>
              {new Date(j.createdAt).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" })} ·{" "}
              {j.total}筆 · {j.state}
            </option>
          ))}
        </select>
      </label>
      {jobs.isError ? <p role="alert">未能讀取已保存工作，請重新載入。</p> : null}
      {jobId ? <button onClick={() => void result.refetch()}>刷新工作結果</button> : null}
      {first ? (
        <>
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
              繼續最多100筆
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
                  {first.resource === "annual_return_case" ? (
                    <Link to="/annual-returns/$id" params={{ id: i.resourceId }}>
                      {i.resourceLabel}
                    </Link>
                  ) : (
                    <span>{i.resourceLabel}</span>
                  )}{" "}
                  ·{" "}
                </>
              ) : (
                "無權查閱此項 · "
              )}
              {i.state} · {i.reason ?? "已保存"} · 嘗試{i.attempts}
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
    </div>
  );
}
