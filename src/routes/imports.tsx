import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";

import { PageHeader } from "@/components/page-header";
import { NarApplyPanel } from "@/features/nar-import/apply-panel";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { DataMode } from "@/features/runtime/data-mode";
import type { NarRowDisposition } from "@/features/nar-import/mapping";
import {
  getNarImportBatchReview,
  getNarApplyOptions,
  confirmNarBatchYear,
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
  const { dataMode, actor } = Route.useRouteContext();
  const actorKey = JSON.stringify([
    actor?.authUserId,
    actor?.userId,
    actor?.role,
    actor?.teamId,
    actor?.active,
  ]);
  return <ImportsWorkspace key={actorKey} dataMode={dataMode} actor={actor} actorKey={actorKey} />;
}
function ImportsWorkspace({
  dataMode,
  actor,
  actorKey,
}: {
  dataMode: DataMode;
  actor: AuthenticatedActor | null;
  actorKey: string;
}) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | undefined>();
  const [returnYear, setReturnYear] = useState(new Date().getUTCFullYear());
  const [sheetName, setSheetName] = useState("");
  const [batchId, setBatchId] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [legacyYear, setLegacyYear] = useState("");
  const [legacyReason, setLegacyReason] = useState("");
  const [legacyYearAck, setLegacyYearAck] = useState(false);
  const [pendingMapping, setPendingMapping] = useState<{
    externalClientId: string;
    companyId: string;
    expectedCompanyId: string | null;
  }>();
  const allowed = dataMode === "production" && actor?.role === "Admin" && actor.active === true;

  const batchesQuery = useQuery({
    queryKey: ["nar-import", actorKey, "batches"],
    queryFn: () => listNarImportBatches({ data: {} }),
    enabled: allowed,
    retry: false,
  });

  const reviewQuery = useQuery({
    queryKey: ["nar-import", actorKey, "batch", batchId],
    queryFn: () => getNarImportBatchReview({ data: { batchId: batchId! } }),
    enabled: allowed && Boolean(batchId),
    retry: false,
  });

  const companiesQuery = useQuery({
    queryKey: ["nar-import", actorKey, "companies"],
    queryFn: () => getNarApplyOptions({ data: {} }),
    enabled: allowed,
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
      void queryClient.invalidateQueries({ queryKey: ["nar-import", actorKey, "batches"] });
    },
    // The parser's refusals are the useful part of its output; surfaced verbatim
    // rather than replaced with a generic failure.
    onError: () => setError("未能讀取工作表。請核對檔案格式及伺服器狀態；不會自動重試。"),
  });

  const mapMutation = useMutation({
    mutationFn: (input: {
      externalClientId: string;
      companyId: string;
      expectedCompanyId: string | null;
    }) => mapNarImportCompany({ data: { ...input, confirmed: true } }),
    onSuccess: () => {
      setPendingMapping(undefined);
      void queryClient.invalidateQueries({ queryKey: ["nar-import", actorKey, "batch", batchId] });
    },
    onError: () => setError("未能確認公司映射。請重新載入目前映射再覆核。"),
  });

  const confirmYearMutation = useMutation({
    retry: false,
    mutationFn: () =>
      confirmNarBatchYear({
        data: {
          batchId: batchId!,
          expectedVersion: reviewQuery.data!.batch.revision!,
          returnYear: Number(legacyYear),
          reason: legacyReason,
          acknowledgeSheetDifference: legacyYearAck,
        },
      }),
    onSuccess: () => {
      setLegacyYear("");
      setLegacyReason("");
      setError(undefined);
      void queryClient.invalidateQueries({ queryKey: ["nar-import", actorKey] });
    },
    onError: () => setError("未能確認舊批次年度。請重新載入版本及覆核理由；不會自動重試。"),
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

  if (!allowed)
    return (
      <main className="flex-1 p-6">
        <PageHeader eyebrow="Operations" title="月表匯入" />
        <p>只有已核實的現任 Admin 可以覆核跨公司月表。</p>
      </main>
    );
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

      {review?.batch.returnYear === null ? (
        <section className="space-y-2 rounded-lg border p-4">
          <h2>既有批次年度待確認</h2>
          <p>舊版本沒有保存選定年度。檔名不是年度批准證據；確認後不可更改。</p>
          <label>
            已覆核年度
            <input
              aria-label="既有批次已覆核年度"
              type="number"
              min="1900"
              max="2100"
              value={legacyYear}
              onChange={(e) => setLegacyYear(e.target.value)}
            />
          </label>
          <label>
            來源及確認理由
            <textarea
              minLength={10}
              maxLength={1000}
              value={legacyReason}
              onChange={(e) => setLegacyReason(e.target.value)}
            />
          </label>
          <label>
            <input
              type="checkbox"
              checked={legacyYearAck}
              onChange={(e) => setLegacyYearAck(e.target.checked)}
            />
            已覆核與工作表名稱的年度差異
          </label>
          <button
            type="button"
            disabled={
              confirmYearMutation.isPending ||
              !review.batch.revision ||
              !legacyYear ||
              legacyReason.trim().length < 10
            }
            onClick={() => confirmYearMutation.mutate()}
          >
            確認既有批次年度
          </button>
        </section>
      ) : null}
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

                {!row.appliedAt ? (
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
                        setPendingMapping({
                          externalClientId: row.externalClientId,
                          companyId: event.target.value,
                          expectedCompanyId: row.currentMappingCompanyId ?? row.matchedCompanyId,
                        });
                      }}
                    >
                      <option value="">選擇對應的公司…</option>
                      {(companiesQuery.data?.companies ?? []).map((company) => (
                        <option key={company.id} value={company.id}>
                          {company.companyName} · {company.crNumber}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs text-muted-foreground">
                      預覽會重新核對最新映射；更改既有映射必須再確認。
                    </span>
                    {pendingMapping?.externalClientId === row.externalClientId ? (
                      <button
                        type="button"
                        disabled={mapMutation.isPending}
                        onClick={() => mapMutation.mutate(pendingMapping)}
                      >
                        確認公司映射
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {review ? (
        <NarApplyPanel
          key={actorKey + review.batch.id}
          batchId={review.batch.id}
          rows={review.rows}
          actorKey={actorKey}
          onApplied={() =>
            void queryClient.invalidateQueries({ queryKey: ["nar-import", actorKey] })
          }
        />
      ) : null}
      {batchesQuery.isError || reviewQuery.isError || companiesQuery.isError ? (
        <p role="alert">未能載入完整匯入資料。請重新載入；目前狀態不可視為沒有記錄。</p>
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
