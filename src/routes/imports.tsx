import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/page-header";
import { listCompaniesEligibleForCase } from "@/features/annual-return/server-fns";
import type { NarRowDisposition } from "@/features/nar-import/mapping";
import {
  getNarImportBatchReview,
  listNarImportBatches,
  mapNarImportCompany,
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
  const [error, setError] = useState<string | undefined>();

  const batchesQuery = useQuery({
    queryKey: ["nar-import", "batches"],
    queryFn: () => listNarImportBatches(),
    enabled: dataMode === "production",
    retry: false,
  });

  const reviewQuery = useQuery({
    queryKey: ["nar-import", "batch", batchId],
    queryFn: () => getNarImportBatchReview({ data: { batchId: batchId! } }),
    enabled: Boolean(batchId),
    retry: false,
  });

  const companiesQuery = useQuery({
    queryKey: ["nar-import", "companies"],
    queryFn: () => listCompaniesEligibleForCase(),
    enabled: dataMode === "production",
    retry: false,
  });

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
      void queryClient.invalidateQueries({ queryKey: ["nar-import", "batch", batchId] });
    },
    onError: (cause) =>
      setError(cause instanceof Error ? cause.message : "Unable to map that company."),
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
                {`${review.batch.rowCount} 筆候選記錄 · 解析器 ${review.batch.parserVersion}`}
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
                      onChange={(event) => {
                        if (!event.target.value) return;
                        mapMutation.mutate({
                          externalClientId: row.externalClientId,
                          companyId: event.target.value,
                        });
                      }}
                    >
                      <option value="">選擇對應的公司…</option>
                      {(companiesQuery.data ?? []).map((company) => (
                        <option key={company.id} value={company.id}>
                          {company.companyName} · {company.crNumber}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs text-muted-foreground">
                      對應後重新上載同一份檔案即可更新這一行。
                    </span>
                  </div>
                ) : null}
              </div>
            ))}
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
              onClick={() => setBatchId(batch.id)}
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
          {(batchesQuery.data ?? []).length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">尚未有匯入紀錄。</p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
