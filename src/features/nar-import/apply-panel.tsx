import { useState } from "react";
import { assignmentLabels } from "@/features/work-items/assignment-labels";
import { useMutation, useQuery, useQueryClient, useInfiniteQuery } from "@tanstack/react-query";
import type { NarImportRow } from "./repository";
import type { NarRowInputs } from "./apply-contracts";
import {
  getNarApplyOptions,
  previewNarApply,
  executeNarApply,
  listNarApplyJobs,
  getNarApplyJob,
  resumeNarApplyJob,
  cancelNarApplyJob,
  previewNarCompensation,
} from "./server-fns";
type Props = { batchId: string; rows: NarImportRow[]; actorKey: string; onApplied?: () => void };
function snapshotFilingDate(value: unknown): string | null {
  if (typeof value !== "object" || value === null || !("case" in value)) return null;
  const case_ = value.case;
  if (typeof case_ !== "object" || case_ === null || !("filing_due_date" in case_)) return null;
  return typeof case_.filing_due_date === "string" ? case_.filing_due_date.slice(0, 10) : null;
}
export function NarApplyPanel({ batchId, rows, actorKey, onApplied }: Props) {
  const client = useQueryClient(),
    key = ["nar-apply", actorKey, batchId];
  const [selected, setSelected] = useState<string[]>([]),
    [inputs, setInputs] = useState<Record<string, NarRowInputs>>({}),
    [mode, setMode] = useState<"historical" | "client">("historical"),
    [activate, setActivate] = useState(false),
    [confirmation, setConfirmation] = useState(false),
    [jobId, setJobId] = useState<string>(),
    [error, setError] = useState<string>(),
    [approvedPreview, setApprovedPreview] = useState<{
      value: Awaited<ReturnType<typeof previewNarApply>>;
      idempotencyKey: string;
    }>();
  const options = useQuery({
    queryKey: ["nar-apply-options", actorKey],
    queryFn: () => getNarApplyOptions({ data: {} }),
    retry: false,
  });
  const ownerLabels = assignmentLabels(
    (options.data?.owners ?? []).map((o) => ({
      userId: o.id,
      displayName: o.name,
      teamName: o.teamName,
      active: true,
      workload: 0,
    })),
  );
  const jobs = useInfiniteQuery({
    queryKey: [...key, "jobs"],
    initialPageParam: undefined as { id: string; createdAt: string } | undefined,
    queryFn: ({ pageParam }) => listNarApplyJobs({ data: { batchId, cursor: pageParam } }),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
  const job = useQuery({
    queryKey: [...key, "job", jobId],
    queryFn: () => getNarApplyJob({ data: { jobId: jobId! } }),
    enabled: Boolean(jobId),
    retry: false,
  });
  const invalidate = () => {
    setApprovedPreview(undefined);
    setConfirmation(false);
  };
  const failed = () => setError("未能確認操作結果。請重新載入工作狀態；不會自動重試。");
  const refresh = () => {
    void client.invalidateQueries({ queryKey: key });
    onApplied?.();
  };
  const preview = useMutation({
    retry: false,
    mutationFn: () =>
      previewNarApply({
        data: {
          batchId,
          rowIds: selected,
          inputs,
          dataOrigin: mode,
          activateCurrentYear: activate,
        },
      }),
    onSuccess: (value) => {
      setError(undefined);
      setConfirmation(false);
      setApprovedPreview({ value, idempotencyKey: crypto.randomUUID() });
    },
    onError: failed,
  });
  const execute = useMutation({
    retry: false,
    mutationFn: () =>
      executeNarApply({
        data: {
          previewId: approvedPreview!.value.previewId,
          idempotencyKey: approvedPreview!.idempotencyKey,
        },
      }),
    onSuccess: (r) => {
      setJobId(r.jobId);
      invalidate();
      refresh();
    },
    onError: () => {
      failed();
      refresh();
    },
  });
  const resume = useMutation({
    retry: false,
    mutationFn: () => resumeNarApplyJob({ data: { jobId: jobId! } }),
    onSuccess: refresh,
    onError: () => {
      failed();
      refresh();
    },
  });
  const cancel = useMutation({
    retry: false,
    mutationFn: () => cancelNarApplyJob({ data: { jobId: jobId! } }),
    onSuccess: refresh,
    onError: failed,
  });
  const compensation = useQuery({
    queryKey: [...key, "compensation", jobId],
    queryFn: () => previewNarCompensation({ data: { jobId: jobId! } }),
    enabled: false,
    retry: false,
  });
  const update = (id: string, patch: NarRowInputs) => {
    invalidate();
    setInputs((old) => ({ ...old, [id]: { ...old[id], ...patch } }));
  };
  const busy = preview.isPending || execute.isPending || resume.isPending || cancel.isPending;
  return (
    <section className="space-y-4 rounded-lg border bg-card p-4">
      <h2 className="text-base font-semibold">批准套用所選行</h2>
      <p className="text-sm text-muted-foreground">
        付款日期及 credit note
        只作來源觀察；實際費用由人手輸入，收款仍需獨立付款證據。未選行保留待處理。歷史案件禁止外發。
      </p>
      {error || options.isError || jobs.isError || job.isError ? (
        <p role="alert">{error ?? "未能載入套用資料，請重新載入。"}</p>
      ) : null}
      <label>
        案件用途{" "}
        <select
          aria-label="案件用途"
          disabled={busy}
          value={mode}
          onChange={(e) => {
            invalidate();
            setMode(e.target.value as "historical" | "client");
            setActivate(false);
          }}
        >
          <option value="historical">歷史記錄（禁止外發）</option>
          <option value="client">本年度正式案件</option>
        </select>
      </label>
      {mode === "client" ? (
        <label className="block">
          <input
            type="checkbox"
            checked={activate}
            disabled={busy}
            onChange={(e) => {
              invalidate();
              setActivate(e.target.checked);
            }}
          />
          確認啟用本年度正式案件；後續追件仍需獨立批准
        </label>
      ) : null}
      <p>
        已選{selected.length}行／{rows.length}行
      </p>
      {rows.map((row) => (
        <div key={row.id} className="space-y-2 border-t py-3">
          <label>
            <input
              aria-label={`選取第${row.rowNumber}行`}
              type="checkbox"
              disabled={busy}
              checked={selected.includes(row.id)}
              onChange={(e) => {
                invalidate();
                setSelected((old) =>
                  e.target.checked ? [...old, row.id] : old.filter((id) => id !== row.id),
                );
              }}
            />
            {row.companyName} · 第{row.rowNumber}行
            {row.appliedAt ? " · 已套用，重播不建立副本" : ""}
          </label>
          {selected.includes(row.id) ? (
            <div className="grid gap-2 md:grid-cols-2">
              <label>
                實際費用（HKD）
                <input
                  aria-label={`第${row.rowNumber}行實際費用`}
                  type="number"
                  min="1"
                  step="1"
                  disabled={busy}
                  value={inputs[row.id]?.feeAmount ?? ""}
                  onChange={(e) =>
                    update(row.id, {
                      feeAmount: e.target.value ? Number(e.target.value) : undefined,
                    })
                  }
                />
              </label>
              <label>
                Made-up date{" "}
                <input
                  aria-label={`第${row.rowNumber}行made-up date`}
                  type="date"
                  disabled={busy}
                  value={inputs[row.id]?.madeUpDate ?? ""}
                  onChange={(e) => update(row.id, { madeUpDate: e.target.value || undefined })}
                />
              </label>
              <label>
                清單範本
                <select
                  aria-label={`第${row.rowNumber}行範本`}
                  disabled={busy}
                  value={inputs[row.id]?.templateId ?? ""}
                  onChange={(e) => update(row.id, { templateId: e.target.value || undefined })}
                >
                  <option value="">選擇範本</option>
                  {options.data?.templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                負責同事
                <select
                  aria-label={`第${row.rowNumber}行負責同事`}
                  disabled={busy}
                  value={inputs[row.id]?.ownerId ?? ""}
                  onChange={(e) => update(row.id, { ownerId: e.target.value || undefined })}
                >
                  <option value="">選擇同事</option>
                  {options.data?.owners.map((o) => (
                    <option key={o.id} value={o.id}>
                      {ownerLabels.get(o.id)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Invoice reference（可沿用來源；Nil 時需確認）
                <input
                  disabled={busy}
                  value={inputs[row.id]?.invoiceNumber ?? ""}
                  onChange={(e) => update(row.id, { invoiceNumber: e.target.value || undefined })}
                />
              </label>
              {(
                [
                  ["acknowledgeDueDifference", "確認採用來源 due date，已覆核與42日計算的差異"],
                  ["acknowledgeYearDifference", "確認選定年度與工作表名稱的差異"],
                  ["acknowledgeSourceIssues", "已覆核此行的來源注意事項"],
                ] as const
              ).map(([field, label]) => (
                <label key={field}>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={inputs[row.id]?.[field] ?? false}
                    onChange={(e) => update(row.id, { [field]: e.target.checked })}
                  />
                  {label}
                </label>
              ))}
              <details>
                <summary>原始及解析資料</summary>
                <pre className="overflow-auto text-xs">
                  {JSON.stringify({ raw: row.raw, parsed: row.parsed }, null, 2)}
                </pre>
              </details>
            </div>
          ) : null}
        </div>
      ))}
      <button
        type="button"
        disabled={busy || !selected.length || options.isPending || options.isError}
        onClick={() => preview.mutate()}
      >
        預覽所選行
      </button>
      {approvedPreview ? (
        <div className="space-y-2 border-t pt-3">
          <p>
            此版本選取{approvedPreview.value.selected}行；可套用
            {approvedPreview.value.eligibleCount}行。
          </p>
          {approvedPreview.value.rows.map((r) => (
            <div key={r.rowId}>
              <p>
                {rows.find((row) => row.id === r.rowId)?.companyName} · 第
                {rows.find((row) => row.id === r.rowId)?.rowNumber}行
              </p>
              <p>
                {r.original?.filing_due_date ?? "新案件"} → <span>{r.candidate.filingDueDate}</span>
              </p>
              <p>
                Invoice {r.candidate.invoiceNumber ?? "待確認"} · 費用
                {r.candidate.feeAmount ?? "沿用現有／待確認"}
              </p>
              {r.diff?.map((d) => (
                <p key={d.field}>
                  {
                    {
                      companyId: "公司",
                      returnYear: "年度",
                      madeUpDate: "Made-up date",
                      filingDueDate: "申報限期",
                      invoiceNumber: "Invoice",
                      feeAmount: "實際費用",
                    }[d.field]
                  }
                  ：{d.before ?? "未有記錄"} → {d.after ?? "待確認"}
                </p>
              ))}
              {r.sourceInvoiceDifference ? (
                <p>
                  來源 Invoice {r.sourceInvoiceDifference.source} 與現有{" "}
                  {r.sourceInvoiceDifference.existing ?? "未有記錄"}{" "}
                  不同；需另行覆核，付款資料保留。
                </p>
              ) : null}
              <p>
                {r.requiredInputs.join("、")} {r.conflicts.join("、")}
              </p>
            </div>
          ))}
          <label>
            <input
              aria-label="確認此版本及逐行差異"
              type="checkbox"
              checked={confirmation}
              disabled={busy}
              onChange={(e) => setConfirmation(e.target.checked)}
            />
            確認此版本及逐行差異；被阻擋行不會寫入
          </label>
          <button
            type="button"
            disabled={busy || !confirmation || !approvedPreview.value.eligibleCount}
            onClick={() => execute.mutate()}
          >
            批准建立套用工作
          </button>
        </div>
      ) : null}
      <h3>已批准工作</h3>
      {jobs.data?.pages
        .flatMap((p) => p.items)
        .map((j) => (
          <button
            key={j.id}
            type="button"
            aria-label="開啟套用工作"
            disabled={busy}
            onClick={() => setJobId(j.id)}
          >
            {j.createdAt} · {j.state}
          </button>
        ))}
      {jobs.hasNextPage ? (
        <button
          type="button"
          disabled={busy || jobs.isFetchingNextPage}
          onClick={() => void jobs.fetchNextPage()}
        >
          載入較早的套用工作
        </button>
      ) : null}
      {job.data ? (
        <div className="space-y-2">
          <p>
            此工作選取{job.data.selected}行；<span>未選取{job.data.unselected}行</span>
          </p>
          <p>
            已套用{job.data.counts.applied} · 衝突{job.data.counts.conflict} · 失敗
            {job.data.counts.failed} · 待處理{job.data.counts.pending} · 取消
            {job.data.counts.cancelled}
          </p>
          {job.data.rows.map((r) => (
            <p key={r.row_id}>
              {r.company_name} · 第{r.row_number}行 · {r.state} {r.reason}
            </p>
          ))}
          <button
            type="button"
            disabled={busy || !job.data.counts.pending}
            onClick={() => resume.mutate()}
          >
            繼續處理最多100行
          </button>
          <button
            type="button"
            disabled={busy || !job.data.counts.pending}
            onClick={() => cancel.mutate()}
          >
            取消待處理行
          </button>
          <button type="button" disabled={busy} onClick={() => void compensation.refetch()}>
            預覽補償
          </button>
          <button type="button" disabled={busy} onClick={refresh}>
            重新載入工作狀態
          </button>
          {compensation.isError ? <p role="alert">未能載入補償資料，請重新載入。</p> : null}
          {compensation.data ? (
            <div>
              <p>只供覆核，不會刪除案件或證據。</p>
              {compensation.data.map((r) => (
                <div key={r.rowId}>
                  <p>
                    {r.companyName} · 第{r.rowNumber}行
                  </p>
                  <p>{r.currentMatches ? "版本相符，需再覆核補償" : "版本已變，不可沿用舊補償"}</p>
                  <p>原申報限期：{snapshotFilingDate(r.proposedBefore) ?? "未有原案件"}</p>
                  <p>現申報限期：{snapshotFilingDate(r.current) ?? "待確認"}</p>
                  <details>
                    <summary>完整 before／current 資料</summary>
                    <pre className="overflow-auto text-xs">
                      {JSON.stringify({ before: r.proposedBefore, current: r.current }, null, 2)}
                    </pre>
                  </details>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
