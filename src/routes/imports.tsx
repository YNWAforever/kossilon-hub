import { safeRequestId } from "@/features/runtime/query-error";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/page-header";
import { exportBulkOperationCsv, getBulkOperation } from "@/features/bulk-operations/server-fns";
import type { ImportApproval } from "@/features/nar-import/apply-repository";
import type { NarRowDisposition } from "@/features/nar-import/mapping";
import {
  applyNarImport,
  approveNarImport,
  getNarImportBatchReview,
  listNarImportBatches,
  mapNarImportCompany,
  revalidateNarImport,
  searchImportCompanies,
  stageNarImportBatch,
} from "@/features/nar-import/server-fns";

/**
 * The monthly workbook import.
 *
 * The screen is a review, not an apply button. Every row arrives with a
 * disposition and its own issues, and nothing reaches `companies`,
 * `annual_return_cases` or `payments` from here -- an unmatched client id waits
 * for a person to say which company it means, because the workbook does not
 * carry the registry numbers a company row requires.
 *
 * Historical replay is the default and is stated on screen: staging a sheet
 * queues no reminder and activates no case.
 */

export const Route = createFileRoute("/imports")({
  component: ImportsRoute,
});

const DISPOSITION_LABELS: Record<NarRowDisposition, string> = {
  new: "新增",
  updated: "有更新",
  unchanged: "沒有變動",
  conflict: "衝突（已有同事處理過）",
  invalid: "無法匯入",
  needsCompanyMapping: "未對應公司",
};

const DISPOSITION_TONES: Record<NarRowDisposition, string> = {
  new: "bg-status-green-soft text-status-green",
  updated: "bg-status-yellow-soft text-status-yellow",
  unchanged: "bg-muted text-muted-foreground",
  conflict: "bg-status-orange-soft text-status-orange",
  invalid: "bg-status-red-soft text-status-red",
  needsCompanyMapping: "bg-status-orange-soft text-status-orange",
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  // Chunked: String.fromCharCode(...bytes) on a multi-megabyte workbook exceeds
  // the argument limit and throws.
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function ImportsRoute() {
  const { dataMode } = Route.useRouteContext();
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | undefined>();
  const [returnYear, setReturnYear] = useState(new Date().getUTCFullYear());
  const [sheetName, setSheetName] = useState("");
  const [batchId, setBatchId] = useState<string | undefined>();
  const [reviewCursor, setReviewCursor] = useState<number | undefined>();
  const [reviewHistory, setReviewHistory] = useState<number[]>([]);
  const [companySearch, setCompanySearch] = useState("");
  const [legacyReturnYear, setLegacyReturnYear] = useState("");
  const [companyCursor, setCompanyCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [approval, setApproval] = useState<ImportApproval | undefined>();
  const [operationId, setOperationId] = useState<string | undefined>();

  const batchesQuery = useQuery({
    queryKey: ["nar-import", "batches"],
    queryFn: () => listNarImportBatches(),
    enabled: dataMode === "production",
    retry: false,
  });

  const reviewQuery = useQuery({
    queryKey: ["nar-import", "batch", batchId, reviewCursor],
    queryFn: () =>
      getNarImportBatchReview({
        data: {
          batchId: batchId!,
          ...(reviewCursor ? { cursor: reviewCursor } : {}),
          limit: 50,
        },
      }),
    enabled: Boolean(batchId),
    retry: false,
  });

  const companiesQuery = useQuery({
    queryKey: ["nar-import", "companies", companySearch, companyCursor],
    queryFn: () =>
      searchImportCompanies({
        data: {
          q: companySearch,
          cursor: companyCursor,
          limit: 20,
        },
      }),
    enabled: dataMode === "production",
    retry: false,
  });

  const operationQuery = useQuery({
    queryKey: ["nar-import", "operation", operationId],
    queryFn: () => getBulkOperation({ data: { id: operationId! } }),
    enabled: Boolean(operationId),
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.state === "queued" || query.state.data?.state === "running" ? 3000 : false,
  });
  const approveMutation = useMutation({
    mutationFn: () => {
      const preview = revalidateMutation.data;
      if (!preview) throw new Error("Revalidate the batch before approval.");
      return approveNarImport({
        data: { previewId: preview.id, previewHash: preview.previewHash },
      });
    },
    onSuccess: (result) => {
      setError(undefined);
      setApproval(result);
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : "Unable to approve import."),
  });
  const applyMutation = useMutation({
    mutationFn: () => {
      if (!approval) throw new Error("Approve the current preview before applying.");
      return applyNarImport({
        data: { approvalId: approval.id, idempotencyKey: crypto.randomUUID() },
      });
    },
    onSuccess: (result) => {
      setError(undefined);
      setOperationId(result.id);
      void queryClient.invalidateQueries({ queryKey: ["nar-import", "batch", batchId] });
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : "Unable to queue import."),
  });
  async function downloadOperationCsv() {
    if (!operationId) return;
    try {
      const csv = await exportBulkOperationCsv({ data: { id: operationId } });
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `nar-import-${operationId}.csv`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to export import results.");
    }
  }

  const stageMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a workbook first.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      return stageNarImportBatch({
        data: {
          fileName: file.name,
          bodyBase64: bytesToBase64(bytes),
          ...(sheetName.trim() ? { sheetName: sheetName.trim() } : {}),
          returnYear,
        },
      });
    },
    onSuccess: (result) => {
      setError(undefined);
      setBatchId(result.batch.id);
      setReviewCursor(undefined);
      setReviewHistory([]);
      revalidateMutation.reset();
      setApproval(undefined);
      setOperationId(undefined);
      void queryClient.invalidateQueries({ queryKey: ["nar-import", "batches"] });
    },
    // The parser's refusals are the useful part of its output; surfaced verbatim
    // rather than replaced with a generic failure.
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : "Unable to read the workbook."),
  });

  const mapMutation = useMutation({
    mutationFn: (input: { externalClientId: string; companyId: string }) =>
      mapNarImportCompany({ data: input }),
    onSuccess: () => {
      revalidateMutation.reset();
      setApproval(undefined);
      setOperationId(undefined);
      void queryClient.invalidateQueries({ queryKey: ["nar-import", "batch", batchId] });
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : "Unable to map that company."),
  });

  const revalidateMutation = useMutation({
    mutationFn: () => {
      const batch = reviewQuery.data?.batch;
      if (!batch) throw new Error("Load the batch review before revalidation.");
      return revalidateNarImport({
        data: {
          batchId: batch.id,
          expectedRevision: batch.revision,
          ...(batch.returnYear === null && legacyReturnYear
            ? { returnYear: Number(legacyReturnYear) }
            : {}),
        },
      });
    },
    onSuccess: () => {
      setError(undefined);
      setApproval(undefined);
      setOperationId(undefined);
      void queryClient.invalidateQueries({ queryKey: ["nar-import", "batch", batchId] });
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : "Unable to revalidate the import."),
  });

  if (dataMode !== "production") {
    return (
      <main className="flex-1 space-y-4 p-6">
        <PageHeader eyebrow="Operations" title="月表匯入" />
        <p className="text-sm text-muted-foreground">
          匯入只在正式環境提供，示範模式沒有可寫入的資料庫。
        </p>
      </main>
    );
  }

  const review = reviewQuery.data;

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader eyebrow="Operations" title="月表匯入" subtitle="NAR Monthly Working" />

      <section className="rounded-lg border bg-card p-4">
        <label className="grid max-w-md gap-1 text-sm">
          搜尋對應公司（名稱或 CR 編號）
          <input
            aria-label="Search companies for import mapping"
            className="rounded-md border bg-background px-3 py-2"
            value={companySearch}
            onChange={(event) => {
              setCompanySearch(event.target.value);
              setCompanyCursor(null);
            }}
          />
        </label>
        {companiesQuery.data?.nextCursor ? (
          <button
            type="button"
            className="mt-2 text-sm underline"
            onClick={() => setCompanyCursor(companiesQuery.data.nextCursor)}
          >
            載入更多公司
          </button>
        ) : null}
      </section>

      {companiesQuery.isError ? (
        <div
          role="alert"
          className="rounded-md bg-status-yellow-soft px-3 py-2 text-sm text-status-yellow"
        >
          無法載入公司清單，暫時不能對應公司。
          {safeRequestId(companiesQuery.error)
            ? ` 參考編號：${safeRequestId(companiesQuery.error)}`
            : null}
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => void companiesQuery.refetch()}
          >
            重試
          </button>
        </div>
      ) : null}
      {reviewQuery.isError ? (
        <div
          role="alert"
          className="rounded-md bg-status-yellow-soft px-3 py-2 text-sm text-status-yellow"
        >
          無法載入批次覆核資料，請勿按空白資料作決定。
          {safeRequestId(reviewQuery.error)
            ? ` 參考編號：${safeRequestId(reviewQuery.error)}`
            : null}
          <button
            type="button"
            className="ml-2 underline"
            onClick={() => void reviewQuery.refetch()}
          >
            重試
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-md bg-status-red-soft px-3 py-2 text-sm text-status-red">
          {error}
        </div>
      ) : null}

      <section className="rounded-lg border bg-card p-4">
        <h2 className="text-base font-semibold">上載月表</h2>
        {/* Said before the upload, not after: an operator should know that
            staging changes nothing before they stage anything. */}
        <p className="mt-1 text-sm text-muted-foreground">
          上載只會建立待覆核清單，不會建立公司、案件或付款，也不會發出任何提醒。
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_140px_160px_auto] md:items-end">
          <label className="grid gap-1 text-sm">
            檔案
            <input
              aria-label="Workbook file"
              className="rounded-md border bg-background px-3 py-2"
              type="file"
              accept=".xlsx"
              onChange={(event) => setFile(event.target.files?.[0])}
            />
          </label>
          <label className="grid gap-1 text-sm">
            申報年度
            <input
              aria-label="Return year"
              className="rounded-md border bg-background px-3 py-2"
              type="number"
              min={1900}
              max={2100}
              value={returnYear}
              onChange={(event) => setReturnYear(Number(event.target.value))}
            />
          </label>
          <label className="grid gap-1 text-sm">
            工作表（可留空）
            <input
              aria-label="Sheet name"
              className="rounded-md border bg-background px-3 py-2"
              placeholder="8.2025"
              value={sheetName}
              onChange={(event) => setSheetName(event.target.value)}
            />
          </label>
          <button
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
            disabled={!file || stageMutation.isPending}
            onClick={() => stageMutation.mutate()}
            type="button"
          >
            {stageMutation.isPending ? "讀取中…" : "讀取並預覽"}
          </button>
        </div>

        {stageMutation.data?.reused ? (
          <p className="mt-3 text-sm text-muted-foreground">
            這份檔案之前已上載過，顯示的是原來的待覆核清單。
          </p>
        ) : null}
        {stageMutation.data && stageMutation.data.skippedRowNumbers.length > 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {`第 ${stageMutation.data.skippedRowNumbers.join("、")} 行沒有客戶編號，已略過。`}
          </p>
        ) : null}
        {stageMutation.data?.sheetIssues.map((issue) => (
          <p key={issue.code + issue.message} className="mt-2 text-sm text-status-yellow">
            {issue.message}
          </p>
        ))}
      </section>

      {review ? (
        <section className="rounded-lg border bg-card">
          <div className="flex flex-wrap items-baseline justify-between gap-3 border-b p-4">
            <div>
              <h2 className="text-base font-semibold">
                {review.batch.sourceFileName} · {review.batch.sheetName}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {`${review.batch.rowCount} 筆候選記錄 · 申報年度 ${review.batch.returnYear ?? "待確認"} · 解析器 ${review.batch.parserVersion} · 版本 ${review.batch.revision}`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(DISPOSITION_LABELS) as NarRowDisposition[]).map((key) => (
                <span
                  key={key}
                  className={`rounded-md px-2 py-1 text-xs font-medium ${DISPOSITION_TONES[key]}`}
                >
                  {DISPOSITION_LABELS[key]} {review.counts[key]}
                </span>
              ))}
            </div>
          </div>

          <div className="border-b p-4">
            {review.batch.returnYear === null ? (
              <label className="mb-3 grid max-w-xs gap-1 text-sm">
                此舊批次欠申報年度，請先核實並選擇年度
                <input
                  type="number"
                  min={1900}
                  max={2100}
                  required
                  aria-label="Legacy import return year"
                  className="rounded-md border bg-background px-3 py-2"
                  value={legacyReturnYear}
                  onChange={(event) => setLegacyReturnYear(event.target.value)}
                />
              </label>
            ) : null}
            <button
              type="button"
              className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
              disabled={
                revalidateMutation.isPending ||
                (review.batch.returnYear === null && !legacyReturnYear)
              }
              onClick={() => revalidateMutation.mutate()}
            >
              {revalidateMutation.isPending ? "重新驗證中…" : "重新驗證並查看逐欄預覽"}
            </button>
            <p className="mt-1 text-xs text-muted-foreground">
              預覽只顯示候選變更與來源；付款日期不會直接標記已付款。
            </p>
          </div>
          {revalidateMutation.data ? (
            <section className="border-b bg-muted/20 p-4" aria-label="Import preview diff">
              <p className="text-sm font-medium">
                {`預覽版本 ${revalidateMutation.data.revision} · ${revalidateMutation.data.rows.length} 行`}
              </p>
              <p className="mt-1 break-all text-xs text-muted-foreground">
                {`語意鍵 ${revalidateMutation.data.semanticKey}`}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="rounded-md border px-3 py-2 text-sm disabled:opacity-50"
                  disabled={approveMutation.isPending || Boolean(approval)}
                  onClick={() => approveMutation.mutate()}
                >
                  {approval
                    ? "已批准這份預覽"
                    : approveMutation.isPending
                      ? "批准中…"
                      : "批准這份預覽"}
                </button>
                {approval ? (
                  <button
                    type="button"
                    className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-50"
                    disabled={applyMutation.isPending || Boolean(operationId)}
                    onClick={() => applyMutation.mutate()}
                  >
                    {applyMutation.isPending ? "排程中…" : "按批准內容逐列套用"}
                  </button>
                ) : null}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                批准後仍需明確按套用；逐列結果可下載。匯入不會發提醒，付款日期只會待核對。
              </p>
              {operationQuery.data ? (
                <div
                  className="mt-3 rounded-md border bg-card p-3 text-sm"
                  aria-label="Import operation progress"
                >
                  <p>{`套用狀態：${operationQuery.data.state} · 成功 ${operationQuery.data.counts.succeeded} · 跳過 ${operationQuery.data.counts.skipped} · 衝突 ${operationQuery.data.counts.conflict} · 失敗 ${operationQuery.data.counts.failed}`}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    排程處理逐列交易；有衝突時重新驗證，再批准新的預覽。
                  </p>
                  <button
                    type="button"
                    className="mt-2 underline"
                    onClick={() => void downloadOperationCsv()}
                  >
                    下載逐列結果 CSV
                  </button>
                </div>
              ) : null}
              {operationQuery.isError ? (
                <p role="alert" className="mt-2 text-sm text-status-yellow">
                  無法讀取套用進度；請重試。
                </p>
              ) : null}
              <div className="mt-3 max-h-80 space-y-3 overflow-auto text-xs">
                {revalidateMutation.data.rows.map((row) => (
                  <div key={row.rowId} className="rounded-md border bg-card p-2">
                    <p className="font-medium">{`第 ${row.rowNumber} 行 · ${row.externalClientId} · ${DISPOSITION_LABELS[row.disposition]}`}</p>
                    {row.fields.map((field) => (
                      <p key={field.field} className="mt-1 break-words">
                        {`${field.field}: ${field.before ?? "空"} → ${field.after ?? "空"} · ${field.policy} · ${field.source}`}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          <div className="divide-y">
            {review.rows.map((row) => (
              <div key={row.id} className="space-y-2 p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{row.companyName}</p>
                    <p className="text-xs text-muted-foreground">
                      {`第 ${row.rowNumber} 行 · 客戶編號 ${row.externalClientId}`}
                    </p>
                  </div>
                  <span
                    className={`rounded-md px-2 py-1 text-xs font-medium ${DISPOSITION_TONES[row.disposition]}`}
                  >
                    {DISPOSITION_LABELS[row.disposition]}
                  </span>
                </div>

                {/* Every issue is shown. They are the reason a person is looking
                    at this screen rather than a progress bar. */}
                {row.issues.length > 0 ? (
                  <ul className="list-inside list-disc space-y-1 text-xs text-muted-foreground">
                    {row.issues.map((issue, index) => (
                      <li
                        key={`${row.id}-${issue.code}-${index}`}
                        className={
                          issue.severity === "blocking" ? "text-status-red" : "text-status-yellow"
                        }
                      >
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {row.disposition === "needsCompanyMapping" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="sr-only" htmlFor={`map-${row.id}`}>
                      對應公司
                    </label>
                    <select
                      id={`map-${row.id}`}
                      aria-label={`Map ${row.externalClientId} to a company`}
                      className="rounded-md border bg-background px-2 py-1 text-sm"
                      defaultValue=""
                      disabled={companiesQuery.isPending || companiesQuery.isError}
                      onChange={(event) => {
                        if (!event.target.value) return;
                        mapMutation.mutate({
                          externalClientId: row.externalClientId,
                          companyId: event.target.value,
                        });
                      }}
                    >
                      <option value="">選擇對應的公司…</option>
                      {(companiesQuery.data?.items ?? []).map((company) => (
                        <option key={company.id} value={company.id}>
                          {company.companyName} · {company.crNumber}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs text-muted-foreground">
                      對應後此批次即時更新；按「重新驗證」查看變更。
                    </span>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <div className="flex gap-3 border-t p-4 text-sm">
            <button
              type="button"
              className="underline disabled:opacity-50"
              disabled={reviewHistory.length === 0}
              onClick={() => {
                const previous = reviewHistory[reviewHistory.length - 1];
                setReviewHistory(reviewHistory.slice(0, -1));
                setReviewCursor(previous || undefined);
              }}
            >
              上一頁
            </button>
            <button
              type="button"
              className="underline disabled:opacity-50"
              disabled={review.nextCursor === null}
              onClick={() => {
                setReviewHistory([...reviewHistory, reviewCursor ?? 0]);
                setReviewCursor(review.nextCursor ?? undefined);
              }}
            >
              下一頁
            </button>
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border bg-card p-4">
        <h2 className="text-base font-semibold">之前的匯入</h2>
        <div className="mt-3 divide-y">
          {(batchesQuery.data ?? []).map((batch) => (
            <button
              key={batch.id}
              className="flex w-full flex-wrap items-center justify-between gap-2 py-2 text-left text-sm hover:bg-muted/30"
              onClick={() => {
                setBatchId(batch.id);
                setReviewCursor(undefined);
                setReviewHistory([]);
                revalidateMutation.reset();
                setApproval(undefined);
                setOperationId(undefined);
              }}
              type="button"
            >
              <span className="truncate">
                {batch.sourceFileName} · {batch.sheetName}
              </span>
              <span className="text-xs text-muted-foreground">
                {`${batch.rowCount} 筆 · ${new Date(batch.createdAt).toLocaleDateString("en-HK")}`}
              </span>
            </button>
          ))}
          {batchesQuery.isPending ? (
            <p className="py-2 text-sm text-muted-foreground">載入匯入紀錄中…</p>
          ) : batchesQuery.isError ? (
            <div role="alert" className="py-2 text-sm text-status-yellow">
              無法載入匯入紀錄。
              {safeRequestId(batchesQuery.error)
                ? ` 參考編號：${safeRequestId(batchesQuery.error)}`
                : null}
              <button
                type="button"
                className="ml-2 underline"
                onClick={() => void batchesQuery.refetch()}
              >
                重試
              </button>
            </div>
          ) : (batchesQuery.data ?? []).length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">尚未有匯入紀錄。</p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
