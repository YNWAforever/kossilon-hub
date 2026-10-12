import { BulkJobCenter } from "@/features/bulk-operations/components/bulk-job-center";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { assignmentLabels } from "@/features/work-items/assignment-labels";
import { readSnapshotMembership } from "@/features/bulk-operations/membership";
import {
  createBulkSelectionSnapshot,
  getBulkSnapshotMembership,
  previewBulkAssignment,
  previewBulkMaintenance,
  executeBulkAssignment,
  listBulkAssignees,
} from "@/features/bulk-operations/server-fns";
import type {
  BulkResource,
  BulkFilters,
  BulkSelection,
  BulkPreview,
  MaintenanceActionKind,
  MaintenanceAction,
} from "@/features/bulk-operations/types";
type Props = {
  actorScope: string;
  resource: BulkResource;
  filters: BulkFilters;
  page: readonly { id: string; label: string }[];
  total: number | null;
  pageSize?: number;
  maintenanceActions?: MaintenanceActionKind[];
  assignmentTarget?: "owner" | "reviewer";
};
const maintenanceLabels: Record<MaintenanceActionKind, string> = {
  client_maintenance: "客戶 owner／team 維護（改資料）",
  document_assignment: "分派文件所屬案件（同步案及工作）",
  document_return_draft: "文件退回草稿（待單筆覆核）",
  document_list_export: "安全文件清單（只有 metadata）",
  follow_up_draft: "追件草稿（不派送）",
  payment_list_export: "付款核對清單（不入賬）",
};
/** Changing actor replaces the entire session; changing filters replaces selection only. */
export function BulkSelectionToolbar(props: Props) {
  return <BulkSession key={props.actorScope} {...props} />;
}
function BulkSession(props: Props) {
  const [jobId, setJobId] = useState<string | null>(null);
  return (
    <section
      aria-label="Bulk assignment"
      className="min-w-0 space-y-3 rounded border p-4 [&_button]:min-h-11 [&_button]:rounded [&_button]:border [&_button]:px-3 [&_input:not([type=checkbox])]:min-h-11 [&_select]:min-h-11 [&_select]:max-w-full"
    >
      <SelectionControls
        key={JSON.stringify([props.resource, props.filters])}
        {...props}
        onCreated={setJobId}
      />
      <BulkJobCenter actorScope={props.actorScope} jobId={jobId} onJobChange={setJobId} />
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
  assignmentTarget,
  onCreated,
}: Props & { onCreated: (jobId: string) => void }) {
  const [selection, setSelection] = useState<BulkSelection>({ mode: "explicit_ids", ids: [] }),
    [fixedCount, setFixedCount] = useState(0),
    [assigneeId, setAssigneeId] = useState(""),
    [target, setTarget] = useState<"owner" | "reviewer">(assignmentTarget ?? "owner"),
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
        return previewBulkMaintenance({
          data: {
            resource,
            selection,
            action,
            ...(Object.keys(filters).length ? { filters } : {}),
          },
        });
      }
      if (resource !== "annual_return_case" && resource !== "work_item")
        throw new Error("Unsupported assignment resource");
      return previewBulkAssignment({
        data: {
          resource,
          selection,
          ...(Object.keys(filters).length ? { filters } : {}),
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
      <h2 className="font-semibold">{maintenanceActions ? "批量日常維護" : "批量分派"}</h2>
      {maintenanceActions ? (
        <>
          <label>
            操作
            <select
              aria-label="Bulk action"
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
            </select>
          </label>
          <p>草稿須另作單筆批准；清單不包含文件 bytes，不代表已付款、已派送或已交件。</p>
        </>
      ) : null}
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
        <button
          disabled={busy || total === null || total > 20000}
          onClick={() => snapshot.mutate()}
        >
          選取全部篩選結果
        </button>
        <button disabled={busy} onClick={() => change({ mode: "explicit_ids", ids: [] })}>
          清空選取
        </button>
      </div>
      {total !== null && total > 20000 ? (
        <p role="alert">範圍超過20,000筆；請縮小篩選後分批處理，不會截斷選取。</p>
      ) : null}
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
      {needsAssignee ? (
        <>
          <label>
            搜尋批量員工
            <input
              aria-label="搜尋批量員工"
              className="min-h-11 rounded border px-3"
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
            <span className="block text-xs">最多200項；搜尋涵蓋全部獲授權員工。</span>
          </label>
          <label>
            責任
            <select
              aria-label="Bulk responsibility"
              disabled={busy || !!assignmentTarget}
              value={target}
              onChange={(e) => {
                setTarget(e.target.value as typeof target);
                setPreview(null);
                setRequest(null);
              }}
            >
              <option value="owner">負責人</option>
              <option value="reviewer">覆核人</option>
            </select>
          </label>
          {actionKind === "client_maintenance" ? (
            <label>
              目標 team
              <select
                aria-label="Bulk company team"
                value={teamId}
                disabled={busy}
                onChange={(e) => {
                  setTeamId(e.target.value);
                  setPreview(null);
                  setRequest(null);
                }}
              >
                <option value="">選擇目標 team</option>
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
              </select>
            </label>
          ) : null}
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
                <input
                  aria-label={`Return reason ${p.label}`}
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
          (needsAssignee && (!assigneeId || assignees.isError)) ||
          (actionKind === "client_maintenance" && !teamId) ||
          (selection.mode === "filtered_snapshot" && membership.isError)
        }
        onClick={() => dryRun.mutate()}
      >
        {maintenanceActions ? "預覽批量維護" : "預覽批量分派"}
      </button>
      {preview ? (
        <div role="status">
          <p>
            預覽{preview.count}筆；可執行{preview.eligibleCount}；鎖定{preview.reasons.locked}；無權
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
                    item.output.kind,
                )}
              </p>
            </div>
          ))}
          <button
            disabled={busy || preview.eligibleCount === 0 || !request}
            onClick={() => execute.mutate()}
          >
            {maintenanceActions ? "批准並建立維護工作" : "批准並建立分派工作"}
          </button>
        </div>
      ) : null}
      {snapshot.isError ||
      dryRun.isError ||
      (needsAssignee && assignees.isError) ||
      membership.isError ? (
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
