import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assignmentLabels } from "@/features/work-items/assignment-labels";
import { readSnapshotMembership } from "@/features/bulk-operations/membership";
import {
  createBulkSelectionSnapshot,
  getBulkSnapshotMembership,
  previewBulkAssignment,
  previewBulkMaintenance,
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
  BulkJobCursor,
  MaintenanceActionKind,
  MaintenanceAction,
  ItemState,
  JobResult,
} from "@/features/bulk-operations/types";
type Props = {
  actorScope: string;
  resource: BulkResource;
  filters: BulkFilters;
  page: readonly { id: string; label: string }[];
  total: number | null;
  pageSize?: number;
  maintenanceActions?: MaintenanceActionKind[];
};
const maintenanceLabels: Record<MaintenanceActionKind, string> = {
  client_maintenance: "客戶負責同事／團隊維護（更改資料）",
  document_assignment: "分配文件所屬案件（同步案件及工作）",
  document_return_draft: "文件退回草稿（待單筆覆核）",
  document_list_export: "安全文件清單（只含基本資料）",
  follow_up_draft: "追件草稿（不派送）",
  payment_list_export: "付款核對清單（不入賬）",
};
const jobStateLabels: Record<JobResult["state"], string> = {
  queued: "排隊中",
  running: "進行中",
  completed: "已完成",
  partial: "部分完成",
  cancelled: "已取消",
};
const itemStateLabels: Record<ItemState, string> = {
  pending: "待處理",
  succeeded: "成功",
  forbidden: "無權",
  locked: "鎖定",
  conflict: "衝突",
  failed: "失敗",
  unknown: "結果未知",
  cancelled: "已取消",
};
function stateLabel(labels: Record<string, string>, state: string): string {
  return labels[state] ?? state;
}
/** Changing actor replaces the entire session; changing filters replaces selection only. */
export function BulkSelectionToolbar(props: Props) {
  return <BulkSession key={props.actorScope} {...props} />;
}
function BulkSession(props: Props) {
  const [jobId, setJobId] = useState<string | null>(null);
  return (
    <section aria-label="批量分配" className="space-y-3 rounded border p-4">
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
  maintenanceActions,
  onCreated,
}: Props & { onCreated: (jobId: string) => void }) {
  const [selection, setSelection] = useState<BulkSelection>({ mode: "explicit_ids", ids: [] }),
    [fixedCount, setFixedCount] = useState(0),
    [assigneeId, setAssigneeId] = useState(""),
    [target, setTarget] = useState<"owner" | "reviewer">("owner"),
    [overrideReason, setOverrideReason] = useState("");
  const [actionKind, setActionKind] = useState<MaintenanceActionKind | "assignment">(
      maintenanceActions?.[0] ?? "assignment",
    ),
    [teamId, setTeamId] = useState(""),
    [returnReasons, setReturnReasons] = useState<Record<string, string>>({});
  const needsAssignee =
    actionKind === "assignment" ||
    actionKind === "client_maintenance" ||
    actionKind === "document_assignment";
  const [preview, setPreview] = useState<BulkPreview | null>(null),
    [request, setRequest] = useState<{ previewId: string; idempotencyKey: string } | null>(null);
  const client = useQueryClient();
  const [assigneeSearch, setAssigneeSearch] = useState("");
  const assignees = useQuery({
    queryKey: ["bulk-assignees", actorScope, assigneeSearch],
    queryFn: () => listBulkAssignees({ data: { q: assigneeSearch, limit: 200 } }),
    retry: false,
    enabled: needsAssignee,
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
      readSnapshotMembership(
        selection.mode === "filtered_snapshot" ? selection.snapshotId : "",
        page.map((i) => i.id),
        getBulkSnapshotMembership,
      ),
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
    mutationFn: () => {
      if (actionKind !== "assignment") {
        const action: MaintenanceAction =
          actionKind === "client_maintenance"
            ? { kind: actionKind, ownerId: assigneeId, teamId }
            : actionKind === "document_assignment"
              ? {
                  kind: actionKind,
                  target,
                  assigneeId,
                  ...(overrideReason.trim() ? { overrideReason: overrideReason.trim() } : {}),
                }
              : actionKind === "document_return_draft"
                ? { kind: actionKind, reasons: returnReasons }
                : { kind: actionKind };
        return previewBulkMaintenance({ data: { resource, selection, action } });
      }
      if (resource !== "annual_return_case" && resource !== "work_item")
        throw new Error("Unsupported assignment resource");
      return previewBulkAssignment({
        data: {
          resource,
          selection,
          assignment: {
            target,
            assigneeId,
            ...(overrideReason.trim() ? { overrideReason: overrideReason.trim() } : {}),
          },
        },
      });
    },
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
      <h2 className="font-semibold">{maintenanceActions ? "批量日常維護" : "批量分配"}</h2>
      {maintenanceActions ? (
        <>
          <label>
            操作
            <Select
              aria-label="批量操作"
              value={actionKind}
              disabled={busy}
              onChange={(e) => {
                setActionKind(e.target.value as MaintenanceActionKind);
                setPreview(null);
                setRequest(null);
                dryRun.reset();
                execute.reset();
              }}
            >
              {maintenanceActions.map((kind) => (
                <option key={kind} value={kind}>
                  {maintenanceLabels[kind]}
                </option>
              ))}
            </Select>
          </label>
          <p>草稿須另作單筆批准；清單不包含文件內容，不代表已付款、已派送或已交件。</p>
        </>
      ) : null}
      <p>
        每頁{pageSize}；已載入{page.length}；全部{total ?? "未知"}
      </p>
      <div className="flex flex-wrap gap-3">
        <Button
          size="sm"
          disabled={busy || page.length === 0}
          onClick={() => change({ mode: "explicit_ids", ids: page.map((p) => p.id) })}
        >
          選取已載入紀錄
        </Button>
        <Button size="sm" disabled={busy || total === null} onClick={() => snapshot.mutate()}>
          選取全部篩選結果
        </Button>
        <Button size="sm" disabled={busy} onClick={() => change({ mode: "explicit_ids", ids: [] })}>
          清空選取
        </Button>
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
                aria-label={`選取 ${p.label}`}
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
      {needsAssignee ? (
        <>
          <label>
            搜尋同事
            <Input
              aria-label="搜尋同事"
              className="min-h-11"
              value={assigneeSearch}
              disabled={busy}
              onChange={(event) => {
                setAssigneeSearch(event.target.value);
                setAssigneeId("");
                setTeamId("");
                setPreview(null);
                setRequest(null);
              }}
            />
            <span className="block text-xs">最多 200 項；搜尋範圍涵蓋所有獲授權同事。</span>
          </label>
          <label>
            負責角色
            <Select
              aria-label="負責角色"
              disabled={busy}
              value={target}
              onChange={(e) => {
                setTarget(e.target.value as typeof target);
                setPreview(null);
                setRequest(null);
              }}
            >
              <option value="owner">負責同事</option>
              <option value="reviewer">覆核人</option>
            </Select>
          </label>
          {actionKind === "client_maintenance" ? (
            <label>
              目標團隊
              <Select
                aria-label="目標團隊"
                value={teamId}
                disabled={busy}
                onChange={(e) => {
                  setTeamId(e.target.value);
                  setPreview(null);
                  setRequest(null);
                }}
              >
                <option value="">選擇目標團隊</option>
                {[
                  ...new Map(
                    (assignees.data ?? [])
                      .filter((s) => s.teamId)
                      .map((s) => [s.teamId!, s.teamName]),
                  ).entries(),
                ].map(([id, name]) => (
                  <option key={id} value={id}>
                    {name ?? id}
                  </option>
                ))}
              </Select>
            </label>
          ) : null}
          <label>
            同事
            <Select
              aria-label="同事"
              disabled={busy || assignees.isError}
              value={assigneeId}
              onChange={(e) => {
                setAssigneeId(e.target.value);
                setPreview(null);
                setRequest(null);
              }}
            >
              <option value="">選擇在職同事</option>
              {assignees.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {labels.get(s.id)}
                </option>
              ))}
            </Select>
          </label>
        </>
      ) : null}
      {actionKind === "document_return_draft" ? (
        <fieldset>
          <legend>逐筆確認退回原因；未填原因的紀錄不會建立草稿。</legend>
          {page
            .filter((p) =>
              selection.mode === "explicit_ids"
                ? selection.ids.includes(p.id)
                : known.has(p.id) && !selection.excludedIds.includes(p.id),
            )
            .map((p) => (
              <label className="block" key={p.id}>
                {p.label}
                <Input
                  aria-label={`退回原因：${p.label}`}
                  maxLength={500}
                  disabled={busy}
                  value={returnReasons[p.id] ?? ""}
                  onChange={(e) => {
                    setReturnReasons((current) => ({ ...current, [p.id]: e.target.value }));
                    setPreview(null);
                    setRequest(null);
                  }}
                />
              </label>
            ))}
        </fieldset>
      ) : null}
      {resource === "work_item" ? (
        <label>
          非首選或超額原因
          <Input
            aria-label="非首選或超額原因"
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
      <Button
        variant="primary"
        size="sm"
        disabled={
          busy ||
          count === 0 ||
          (needsAssignee && (!assigneeId || assignees.isError)) ||
          (actionKind === "client_maintenance" && !teamId) ||
          (selection.mode === "filtered_snapshot" && membership.isError)
        }
        onClick={() => dryRun.mutate()}
      >
        {maintenanceActions ? "預覽批量維護" : "預覽批量分配"}
      </Button>
      {preview ? (
        <div role="status">
          <p>
            預覽{preview.count}筆；可分配{preview.eligibleCount}；鎖定{preview.reasons.locked}；無權
            {preview.reasons.forbidden}；版本衝突{preview.reasons.conflict}；不合條件
            {preview.reasons.failed}
          </p>
          <p>批准固定範圍後，伺服器仍會逐筆重新核對權限與版本。</p>
          {preview.details?.map((item) => (
            <div key={item.id} className="rounded border p-2">
              <p>{page.find((p) => p.id === item.id)?.label ?? item.id}</p>
              <p>
                {String(
                  item.output.messagePreview ??
                    item.output.reason ??
                    item.output.fileName ??
                    item.output.invoiceNumber ??
                    stateLabel(maintenanceLabels, String(item.output.kind)),
                )}
              </p>
            </div>
          ))}
          <Button
            variant="primary"
            size="sm"
            disabled={busy || preview.eligibleCount === 0 || !request}
            onClick={() => execute.mutate()}
          >
            {maintenanceActions ? "批准並建立維護工作" : "批准並建立分配工作"}
          </Button>
        </div>
      ) : null}
      {snapshot.isError ||
      dryRun.isError ||
      (needsAssignee && assignees.isError) ||
      membership.isError ? (
        <p role="alert">未能取得目前範圍、同事或預覽；請重新核對，暫不套用。</p>
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
  const jobs = useInfiniteQuery({
    queryKey: ["bulk-jobs", actorScope, "saved"],
    queryFn: ({ pageParam }) => listBulkJobs({ data: pageParam ? { cursor: pageParam } : {} }),
    initialPageParam: undefined as BulkJobCursor | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
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
    <div className="space-y-2 border-t pt-3">
      <label>
        已保存工作
        <Select
          aria-label="已保存工作"
          value={jobId ?? ""}
          onChange={(e) => onJobChange(e.target.value || null)}
        >
          <option value="">選擇工作以恢復進度</option>
          {jobs.data?.pages
            .flatMap((p) => p.jobs)
            .map((j) => (
              <option key={j.jobId} value={j.jobId}>
                {new Date(j.createdAt).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" })} ·{" "}
                {j.total}筆 · {stateLabel(jobStateLabels, j.state)}
              </option>
            ))}
        </Select>
      </label>
      {jobs.hasNextPage ? (
        <Button
          size="sm"
          disabled={jobs.isFetchingNextPage}
          onClick={() => void jobs.fetchNextPage({ cancelRefetch: false })}
        >
          載入較早的工作
        </Button>
      ) : null}
      {jobs.isError ? <p role="alert">未能讀取已保存工作，請重新載入。</p> : null}
      {jobId ? (
        <Button size="sm" onClick={() => void result.refetch()}>
          刷新工作結果
        </Button>
      ) : null}
      {first ? (
        <>
          <p>
            工作狀態：{stateLabel(jobStateLabels, first.state)}；共{first.total}；成功
            {first.counts.succeeded ?? 0}；待處理
            {first.counts.pending ?? 0}；鎖定{first.counts.locked ?? 0}；無權
            {first.counts.forbidden ?? 0}；衝突{first.counts.conflict ?? 0}；失敗
            {first.counts.failed ?? 0}；結果未知{first.counts.unknown ?? 0}；取消
            {first.counts.cancelled ?? 0}
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              size="sm"
              disabled={busy || !["queued", "running"].includes(first.state)}
              onClick={() => resume.mutate()}
            >
              繼續最多100筆
            </Button>
            <Button
              size="sm"
              disabled={busy || !["queued", "running"].includes(first.state)}
              onClick={() => cancel.mutate()}
            >
              取消尚未開始項目
            </Button>
            <Button
              size="sm"
              disabled={busy || !first.retryableFailedCount}
              onClick={() => retry.mutate()}
            >
              只重試可重試失敗
            </Button>
            {(first.counts.unknown ?? 0) > 0 ? (
              <Button size="sm" disabled={busy} onClick={() => reconcile.mutate()}>
                先核對未知結果
              </Button>
            ) : null}
            <Button size="sm" disabled={exporting.isPending} onClick={() => exporting.mutate()}>
              匯出可查閱結果
            </Button>
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
              {stateLabel(itemStateLabels, i.state)} · {i.reason ?? "已保存"} · 嘗試{i.attempts}
              {i.output ? (
                <span>
                  {" "}
                  · {stateLabel(maintenanceLabels, String(i.output.kind))} ·{" "}
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
            <Button
              size="sm"
              disabled={result.isFetchingNextPage}
              onClick={() => void result.fetchNextPage({ cancelRefetch: false })}
            >
              載入更多逐筆結果
            </Button>
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
