import { checklistItemText } from "@/lib/checklist-item-label";
import { pageTitle } from "@/lib/page-title";
import { useMemo, useState } from "react";
import { parseEntityId } from "@/lib/entity-id";
import {
  useMutation,
  useMutationState,
  useQuery,
  useQueryClient,
  useInfiniteQuery,
} from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Download, Eye } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input, Select, Textarea } from "@/components/ui/field";
import { formatDate, formatDateTime } from "@/lib/format-date";
import { labelValue } from "@/lib/format-label";
import { downloadDocument, listDocumentPage } from "../features/documents/server-fns";
import { reviewAnnualReturnEvidenceAction } from "../features/annual-return/evidence-server-fns";
import { annualReturnQueryKeys } from "../features/annual-return/query-keys";
import { CHECKLIST_EVIDENCE_FILE_TYPES } from "../features/annual-return/evidence-file-types";
import { getAnnualReturnCase, listAnnualReturnCases } from "../features/annual-return/server-fns";
import { documentSafetyOf, type DocumentSafety } from "../features/documents/safety";
import {
  DOCUMENT_REJECTION_REASONS,
  composeRejectionReason,
  type DocumentRejectionReasonCode,
} from "../features/documents/rejection-reasons";
import type { AnnualReturnCase as ProductionAnnualReturnCase } from "../features/annual-return/types";
import { BulkSelectionToolbar } from "@/components/bulk-selection-toolbar";
import type { DocumentSummary } from "../features/documents/repository";
import { DocumentRecoveryPanel } from "../features/documents/document-recovery-panel";
import { DOCUMENT_CATEGORIES, type DocumentCategory } from "../features/documents/types";

import { useAnnualReturnCases } from "../lib/annual-return-store";
import {
  clientPortalReviewReasons,
  getDocumentArchiveRows,
  getDocumentReviewFollowUpDrafts,
  useClientPortalSnapshot,
  type ClientPortalArchiveRow,
  type ClientPortalDocumentReviewDecision,
  type ClientPortalReviewReasonCode,
} from "../lib/client-portal-store";

type DocumentsSearch = {
  caseId?: unknown;
};

export const Route = createFileRoute("/documents")({
  head: () => ({ meta: [{ title: pageTitle("文件") }] }),
  validateSearch: (search): DocumentsSearch => ({
    caseId: search.caseId,
  }),
  component: DocumentsRoute,
});

function DocumentsRoute() {
  const { dataMode, actor } = Route.useRouteContext();
  const cases = useAnnualReturnCases();
  const snapshot = useClientPortalSnapshot();
  const queryClient = useQueryClient();
  const { caseId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [query, setQuery] = useState("");
  const [caseQueryText, setCaseQueryText] = useState("");
  const [source, setSource] = useState("all");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const caseFilter =
    caseId === undefined ? "all" : typeof caseId === "string" ? caseId : "__invalid__";
  const setCaseFilter = (next: string) =>
    void navigate({ search: { caseId: next === "all" ? undefined : next }, replace: true });
  const [warning, setWarning] = useState<string | undefined>();
  const productionCaseId = parseEntityId(caseFilter) ?? undefined;
  const invalidCaseId = caseId !== undefined && !productionCaseId;
  const productionFilters = {
    ...(query.trim() ? { q: query.trim() } : {}),
    ...(category !== "all" ? { category: category as DocumentCategory } : {}),
    ...(source !== "all" ? { source: source as "staff" | "client" | "system" } : {}),
    ...(status !== "all" ? { reviewStatus: status as "pending" | "verified" | "rejected" } : {}),
  };
  const productionDocumentsQuery = useInfiniteQuery({
    queryKey: [
      "documents",
      "archive",
      productionCaseId ?? "all",
      { actorScope: actor, ...productionFilters },
    ],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listDocumentPage({
        data: {
          ...(productionCaseId ? { caseId: productionCaseId } : {}),
          ...productionFilters,
          limit: 100,
          cursor: pageParam,
        },
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: dataMode === "production" && !invalidCaseId,
    retry: false,
  });
  const archiveReadBlocked =
    productionDocumentsQuery.isError ||
    (productionDocumentsQuery.isFetching && !productionDocumentsQuery.isFetchingNextPage);
  // Cached rows must not keep preview/review/upload controls alive after a
  // denied read or while their archive context is being refreshed.
  const productionDocuments = archiveReadBlocked
    ? []
    : (productionDocumentsQuery.data?.pages.flatMap((p) => p.documents ?? []) ?? []);
  // The production section had no filter of its own: the only case <select> on
  // this screen lived inside the demo branch and listed demo cases, so in
  // production the case filter was reachable only by typing ?caseId=<uuid> into
  // the URL -- which is why the section's own copy told staff to "filter to one
  // production case" using a control that was not rendered.
  const productionCasesQuery = useQuery({
    queryKey: annualReturnQueryKeys.list({ actorScope: actor, q: caseQueryText }),
    queryFn: () => listAnnualReturnCases({ data: { q: caseQueryText, limit: 200 } }),
    enabled: dataMode === "production",
    retry: false,
    staleTime: 60_000,
  });
  const productionCaseQuery = useQuery({
    queryKey: annualReturnQueryKeys.detail(productionCaseId ?? "all"),
    queryFn: () => getAnnualReturnCase({ data: { id: productionCaseId! } }),
    enabled: Boolean(productionCaseId),
    retry: false,
  });
  const evidenceMutationKey = [...annualReturnQueryKeys.all, "evidence-review"];
  const pendingEvidenceIds = useMutationState({
    filters: { mutationKey: evidenceMutationKey, status: "pending" },
    select: (mutation) =>
      (mutation.state.variables as { data?: { documentId?: string } } | undefined)?.data
        ?.documentId,
  });
  const reviewMutation = useMutation({
    mutationKey: evidenceMutationKey,
    mutationFn: reviewAnnualReturnEvidenceAction,
    onSuccess: ({ caseItem }) => {
      queryClient.setQueryData(annualReturnQueryKeys.detail(caseItem.id), caseItem);
      void queryClient.invalidateQueries({
        queryKey: annualReturnQueryKeys.documents(caseItem.id),
      });
      void queryClient.invalidateQueries({ queryKey: ["documents"] });
    },
    onError: (error) => setWarning(error instanceof Error ? error.message : "未能覆核文件。"),
  });

  async function handlePreview(documentId: string, fileName: string, expectedVersionId?: string) {
    try {
      if (!expectedVersionId) throw new Error("文件版本未核實，請重新載入後再預覽或下載。");
      const response = await downloadDocument({ data: { documentId, expectedVersionId } });
      if (!response.ok) throw new Error(`預覽失敗（${response.status}）。`);
      const href = URL.createObjectURL(await response.blob());
      // Opened rather than saved: a reviewer needs to look at the file to decide,
      // and forcing a download to disk for every pending document is how "review"
      // became "approve without looking".
      const opened = window.open(href, "_blank", "noopener,noreferrer");
      if (!opened) {
        const anchor = document.createElement("a");
        anchor.href = href;
        anchor.download = fileName;
        anchor.click();
      }
      // Revoked late so the new tab has time to load it.
      setTimeout(() => URL.revokeObjectURL(href), 60_000);
    } catch (error) {
      setWarning(error instanceof Error ? error.message : "未能開啟文件。");
    }
  }

  async function handleDownload(documentId: string, expectedVersionId?: string) {
    try {
      if (!expectedVersionId) throw new Error("文件版本未核實，請重新載入後再預覽或下載。");
      const response = await downloadDocument({ data: { documentId, expectedVersionId } });
      if (!response.ok) throw new Error(`下載失敗（${response.status}）。`);
      const href = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = "document";
      anchor.click();
      URL.revokeObjectURL(href);
    } catch (error) {
      setWarning(error instanceof Error ? error.message : "未能下載文件。");
    }
  }

  const rows = useMemo(() => getDocumentArchiveRows(cases, snapshot), [cases, snapshot]);
  const visibleRows = rows.filter((row) => {
    const queryText =
      `${row.companyName} ${row.contactName} ${row.title} ${row.filename}`.toLowerCase();
    return (
      queryText.includes(query.toLowerCase()) &&
      (source === "all" || row.source === source) &&
      (category === "all" || row.category === category) &&
      (status === "all" || row.status === status) &&
      (caseFilter === "all" || row.caseId === caseFilter)
    );
  });

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader eyebrow="文件與付款" title="文件" />
      {dataMode === "production" &&
      !invalidCaseId &&
      actor?.active &&
      (actor.role === "Admin" || actor.role === "Manager") ? (
        <BulkSelectionToolbar
          selectionDisabled={archiveReadBlocked || !productionDocumentsQuery.isSuccess}
          actorScope={JSON.stringify(actor)}
          resource="document"
          filters={{
            ...productionFilters,
            ...(productionCaseId ? { caseId: productionCaseId } : {}),
          }}
          page={productionDocuments.map((d) => ({ id: d.id, label: d.fileName }))}
          total={
            productionDocumentsQuery.hasNextPage
              ? null
              : productionDocumentsQuery.isSuccess
                ? productionDocuments.length
                : null
          }
          pageSize={100}
          maintenanceActions={[
            "document_assignment",
            "document_return_draft",
            "document_list_export",
          ]}
        />
      ) : null}

      {dataMode === "production" && invalidCaseId ? (
        <p role="alert" className="text-sm text-destructive">
          案件 ID 格式無效。請重新選擇案件；未載入全部文件。
        </p>
      ) : null}

      {warning ? (
        <div className="rounded-md bg-status-yellow-soft px-3 py-2 text-sm text-status-yellow-text">
          {warning}
        </div>
      ) : null}

      {dataMode === "production" ? (
        <label className="block text-sm">
          搜尋全範圍案件
          <Input
            className="min-h-11 ml-2"
            value={caseQueryText}
            onChange={(event) => setCaseQueryText(event.target.value)}
          />
          <span className="block text-xs text-muted-foreground">
            最多顯示200項；搜尋在授權範圍執行。
          </span>
        </label>
      ) : null}
      {dataMode === "production" ? (
        <section aria-label="正式文件篩選" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            aria-label="搜尋正式文件"
            placeholder="搜尋檔案或公司名稱"
            maxLength={120}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <Select
            aria-label="按類別篩選正式文件"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          >
            <option value="all">全部類別</option>
            {DOCUMENT_CATEGORIES.map((value) => (
              <option key={value} value={value}>
                {labelValue(value)}
              </option>
            ))}
          </Select>
          <Select
            aria-label="按來源篩選正式文件"
            value={source}
            onChange={(event) => setSource(event.target.value)}
          >
            <option value="all">全部來源</option>
            <option value="client">客戶上載</option>
            <option value="staff">同事上載</option>
            <option value="system">系統產生</option>
          </Select>
          <Select
            aria-label="按覆核狀態篩選正式文件"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="all">全部覆核狀態</option>
            <option value="pending">待覆核</option>
            <option value="verified">已核實</option>
            <option value="rejected">已退回</option>
          </Select>
          <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-4">
            搜尋及篩選涵蓋完整授權範圍；更改條件會由第一頁重新讀取。
          </p>
        </section>
      ) : null}
      {dataMode === "production" ? (
        <ProductionDocumentsSection
          caseItem={productionCaseQuery.data ?? undefined}
          cases={productionCasesQuery.data ?? []}
          casesLoading={productionCasesQuery.isLoading}
          selectedCaseId={productionCaseId}
          onSelectCase={(next) => setCaseFilter(next)}
          documents={invalidCaseId ? [] : productionDocuments}
          error={productionDocumentsQuery.error}
          loading={
            productionDocumentsQuery.isLoading ||
            (productionDocumentsQuery.isFetching && !productionDocumentsQuery.isFetchingNextPage)
          }
          retrying={productionDocumentsQuery.isFetching}
          onRetry={() => void productionDocumentsQuery.refetch({ cancelRefetch: false })}
          onDownload={handleDownload}
          onPreview={handlePreview}
          onReview={(input) => reviewMutation.mutate({ data: input })}
          pendingDocumentIds={pendingEvidenceIds.filter((id): id is string => Boolean(id))}
        />
      ) : null}
      {dataMode === "production" && productionDocumentsQuery.hasNextPage ? (
        <Button
          className="min-h-11"
          disabled={productionDocumentsQuery.isFetching || productionDocumentsQuery.isError}
          onClick={() => void productionDocumentsQuery.fetchNextPage({ cancelRefetch: false })}
        >
          載入更多文件
        </Button>
      ) : null}
      {productionDocumentsQuery.isFetchNextPageError ? (
        <p role="alert">下一頁文件未能載入；請重新載入正式文件後再覆核。</p>
      ) : null}

      {/* The archive below is fixture-backed: getDocumentArchiveRows reads the
          demo stores. Rendering it in production showed staff invented records
          as if they were real, and its "Open" links carried demo case ids like
          ar-harbour into /annual-returns/$id, whose validator requires a UUID.
          Production has its own vault above, which reads Postgres. */}
      {dataMode === "demo" ? (
        <section className="rounded-lg border bg-card">
          <div className="grid gap-3 border-b p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))]">
            <Input
              aria-label="搜尋文件"
              className="w-full sm:col-span-2 lg:col-span-1"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜尋公司、聯絡人、標題或檔案名稱"
              value={query}
            />
            <FilterSelect
              label="按來源篩選"
              allLabel="全部來源"
              value={source}
              onChange={setSource}
              values={["client-portal", "staff-packet", "filing-submission", "filing-receipt"]}
            />
            <FilterSelect
              label="按類別篩選"
              allLabel="全部類別"
              value={category}
              onChange={setCategory}
              values={[
                "identity",
                "registry",
                "signature",
                "payment",
                "packet",
                "submission",
                "receipt",
                "other",
              ]}
            />
            <FilterSelect
              label="按狀態篩選"
              allLabel="全部狀態"
              value={status}
              onChange={setStatus}
              values={["required", "uploaded", "superseded", "accepted", "rejected", "generated"]}
            />
            <Select
              aria-label="按案件篩選"
              className="w-full"
              value={caseFilter}
              onChange={(event) => setCaseFilter(event.target.value)}
            >
              <option value="all">全部案件</option>
              {cases.map((caseItem) => (
                <option key={caseItem.id} value={caseItem.id}>
                  {caseItem.companyName}
                </option>
              ))}
            </Select>
          </div>

          <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.5fr)_72px] gap-3 border-b px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:grid">
            <span>文件</span>
            <span>公司</span>
            <span>類型</span>
            <span>狀態</span>
            <span>上載者</span>
            <span>覆核</span>
            <span className="text-right">案件</span>
          </div>

          <div className="divide-y">
            {visibleRows.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">沒有符合篩選條件的文件。</p>
            ) : (
              visibleRows.map((row) => (
                <DocumentRow
                  key={row.id}
                  row={row}
                  cases={cases}
                  snapshot={snapshot}
                  onWarning={setWarning}
                />
              ))
            )}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function FilterSelect({
  label,
  allLabel,
  value,
  values,
  onChange,
}: {
  label: string;
  allLabel: string;
  value: string;
  values: string[];
  onChange: (value: string) => void;
}) {
  return (
    <Select
      aria-label={label}
      className="w-full"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="all">{allLabel}</option>
      {values.map((item) => (
        <option key={item} value={item}>
          {labelValue(item)}
        </option>
      ))}
    </Select>
  );
}

function DocumentRow({
  row,
  cases,
  snapshot,
  onWarning,
}: {
  row: ClientPortalArchiveRow;
  cases: ReturnType<typeof useAnnualReturnCases>;
  snapshot: ReturnType<typeof useClientPortalSnapshot>;
  onWarning: (warning: string | undefined) => void;
}) {
  const followUp = getDocumentReviewFollowUpDrafts(cases, snapshot).find(
    (draft) => draft.documentId === row.documentId,
  );

  function handleReview() {
    onWarning("示範文件庫為唯讀；正式記錄請在上方覆核。");
  }

  return (
    <div className="grid grid-cols-2 gap-3 px-4 py-4 text-sm lg:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.5fr)_72px] lg:items-center">
      <div className="col-span-2 min-w-0 lg:col-span-1">
        <p className="truncate font-medium" title={row.title}>
          {row.title}
        </p>
        <p className="truncate text-xs text-muted-foreground" title={row.filename}>
          {row.filename}
        </p>
      </div>
      <Field label="公司" value={row.companyName} className="col-span-2 lg:col-span-1" />
      <Field label="類型" value={labelValue(row.category)} detail={labelValue(row.source)} />
      <Field label="狀態" value={labelValue(row.status)} />
      <Field label="上載者" value={row.actor} detail={formatDate(row.createdAt)} />
      <div className="col-span-2 min-w-0 lg:col-span-1">
        <ReviewCell row={row} followUpStatus={followUp?.status} onReview={handleReview} />
      </div>
      <div className="col-span-2 flex justify-start lg:col-span-1 lg:justify-end">
        <Button asChild>
          <Link
            aria-label={`開啟「${row.title}」的案件`}
            to="/annual-returns/$id"
            params={{ id: row.caseId }}
          >
            開啟
          </Link>
        </Button>
      </div>
    </div>
  );
}

function ReviewCell({
  row,
  followUpStatus,
  onReview,
}: {
  row: ClientPortalArchiveRow;
  followUpStatus?: string;
  onReview: (
    decision: ClientPortalDocumentReviewDecision,
    options?: { reasonCode?: ClientPortalReviewReasonCode; note?: string },
  ) => void;
}) {
  const [isRejecting, setIsRejecting] = useState(false);
  const [reasonCode, setReasonCode] = useState<ClientPortalReviewReasonCode>("missing-signature");
  const [note, setNote] = useState("");

  if (row.reviewable) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button
            aria-label={`接納「${row.title}」`}
            variant="primary"
            onClick={() => onReview("accepted")}
            type="button"
          >
            接納
          </Button>
          <Button
            aria-label={`退回「${row.title}」`}
            onClick={() => setIsRejecting((current) => !current)}
            type="button"
          >
            退回
          </Button>
        </div>
        {isRejecting ? (
          <div className="space-y-2">
            <Select
              aria-label={`「${row.title}」的退回原因`}
              className="w-full"
              value={reasonCode}
              onChange={(event) =>
                setReasonCode(event.target.value as ClientPortalReviewReasonCode)
              }
            >
              {clientPortalReviewReasons.map((reason) => (
                <option key={reason.code} value={reason.code}>
                  {reason.label}
                </option>
              ))}
            </Select>
            <Input
              aria-label={`「${row.title}」的覆核備註（選填）`}
              className="w-full"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="覆核備註（選填）"
            />
            <Button
              variant="destructive"
              onClick={() => onReview("rejected", { reasonCode, note })}
              type="button"
            >
              確認退回
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  if (row.reviewSummary || row.reviewedBy || row.reviewedAt) {
    return (
      <div className="space-y-1 text-xs text-muted-foreground">
        <p className="truncate text-sm font-medium text-foreground">
          {row.reviewSummary ?? "已覆核"}
        </p>
        {row.reviewReasonLabel ? <p>{row.reviewReasonLabel}</p> : null}
        {row.reviewNote ? <p>{row.reviewNote}</p> : null}
        {followUpStatus ? <p>{`跟進：${labelValue(followUpStatus)}`}</p> : null}
        {row.reviewedBy ? <p>{`覆核人：${row.reviewedBy}`}</p> : null}
        {row.reviewedAt ? <p>{`覆核時間：${formatDateTime(row.reviewedAt)}`}</p> : null}
      </div>
    );
  }

  return <Field label="覆核" value={row.reviewSummary ?? (row.readonly ? "唯讀" : "毋須覆核")} />;
}

function ProductionDocumentsSection({
  caseItem,
  cases,
  casesLoading,
  selectedCaseId,
  onSelectCase,
  documents,
  error,
  loading,
  retrying,
  onRetry,
  onDownload,
  onPreview,
  onReview,
  pendingDocumentIds,
}: {
  caseItem?: ProductionAnnualReturnCase;
  cases: ProductionAnnualReturnCase[];
  casesLoading: boolean;
  selectedCaseId?: string;
  onSelectCase: (caseId: string) => void;
  documents: DocumentSummary[];
  error: Error | null;
  loading: boolean;
  retrying: boolean;
  onRetry: () => void;
  onDownload: (documentId: string, expectedVersionId?: string) => void;
  onPreview: (documentId: string, fileName: string, expectedVersionId?: string) => void;
  onReview: (input: {
    caseId: string;
    documentId: string;
    expectedDocumentVersionId: string;
    checklistItemId?: string;
    decision: "verified" | "rejected";
    reason?: string;
  }) => void;
  pendingDocumentIds: string[];
}) {
  const [checklistItemIds, setChecklistItemIds] = useState<Record<string, string>>({});
  // Was a hardcoded set that had already drifted from the server guard: it omitted
  // "packet" and the legacy "annual-return-evidence", so a document the server
  // would happily accept as checklist evidence never offered the item selector.
  const checklistCategories = new Set(CHECKLIST_EVIDENCE_FILE_TYPES);

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">正式文件庫</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            私人記錄會先隔離，待完成掃描及同事按案件覆核後才會發放。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="production-case-filter">
            篩選案件
          </label>
          <Select
            id="production-case-filter"
            aria-label="按案件篩選正式文件"
            value={selectedCaseId ?? "all"}
            disabled={casesLoading}
            onChange={(event) => onSelectCase(event.target.value)}
          >
            <option value="all">{casesLoading ? "載入案件…" : "所有案件"}</option>
            {cases.map((item) => (
              <option key={item.id} value={item.id}>
                {item.companyName} · {item.returnYear}
              </option>
            ))}
          </Select>
          <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">Neon + R2</span>
        </div>
      </div>
      {error ? (
        <div role="alert" className="mt-4 space-y-2 text-sm text-status-yellow-text">
          <p>無法載入正式記錄。</p>
          <Button type="button" className="min-h-11" disabled={retrying} onClick={onRetry}>
            重新載入正式文件
          </Button>
        </div>
      ) : null}
      {loading ? (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          正式記錄載入中…
        </p>
      ) : null}
      {!loading && !error && documents.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">此範圍內沒有正式文件。</p>
      ) : null}
      <div className="mt-4 divide-y">
        {documents.map((document) => {
          const isChecklistEvidence = checklistCategories.has(document.category);
          // `caseItem?.` guards a missing case but not a case whose checklist is
          // absent, which is what a row written before the checklist existed looks
          // like. The optional chain has to reach the array itself or SSR throws
          // and the whole route falls back to client rendering.
          const matchedChecklistItem = caseItem?.checklist?.find(
            (item) => item.documentId === document.id,
          );
          const checklistItemId = checklistItemIds[document.id] ?? matchedChecklistItem?.id ?? "";
          const safety = documentSafetyOf(document);
          // Approving is what later releases a file to a client and into a
          // filing package, so it needs a genuine scan verdict -- not the
          // deterministic fixture's, however long ago it landed.
          const canReview =
            isUuid(document.caseId ?? undefined) &&
            (!isChecklistEvidence || isUuid(checklistItemId)) &&
            safety === "verified";
          const pending = pendingDocumentIds.includes(document.id);

          return (
            <div
              key={document.id}
              className="grid gap-3 py-3 text-sm md:grid-cols-[minmax(0,1fr)_120px_180px_minmax(220px,1fr)] md:items-center"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{document.fileName}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {labelValue(document.category)}
                </p>
                <p className="mt-1 break-all text-xs text-muted-foreground">
                  當前版本：{document.currentVersionId ?? "未有版本"} · 上載來源：
                  {document.uploadSource === "client"
                    ? "客戶"
                    : document.uploadSource === "staff"
                      ? "同事"
                      : document.uploadSource === "system"
                        ? "系統"
                        : "未記錄"}
                </p>
                {document.caseId ? (
                  <Link
                    className="text-xs underline"
                    to="/annual-returns/$id"
                    params={{ id: document.caseId }}
                  >
                    開啟文件所屬案件
                  </Link>
                ) : (
                  <p className="text-xs text-muted-foreground">未關聯案件</p>
                )}
                {document.objectAvailability === "not_checked" ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    儲存物件尚未核對；可用受控預覽核對缺口。
                  </p>
                ) : null}
              </div>
              <SafetyBadge safety={documentSafetyOf(document)} status={document.uploadStatus} />
              <div>
                <span>{labelValue(document.reviewStatus)}</span>
                {isChecklistEvidence && document.reviewStatus === "pending" ? (
                  caseItem ? (
                    <Select
                      size="sm"
                      aria-label={`「${document.fileName}」對應的清單項目`}
                      className="mt-2 w-full"
                      value={checklistItemId}
                      onChange={(event) =>
                        setChecklistItemIds((current) => ({
                          ...current,
                          [document.id]: event.target.value,
                        }))
                      }
                    >
                      <option value="">選擇清單項目</option>
                      {(caseItem.checklist ?? []).map((item) => (
                        <option key={item.id} value={item.id}>
                          {checklistItemText(item.itemLabel)}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      請先在上方選擇一個案件，才可覆核清單證明文件。
                    </p>
                  )
                ) : null}
              </div>
              <ReviewActions
                document={document}
                safety={safety}
                canReview={canReview}
                pending={pending}
                isChecklistEvidence={isChecklistEvidence}
                checklistItemId={checklistItemId}
                onDownload={onDownload}
                onPreview={onPreview}
                onReview={onReview}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
function isUuid(value: string | undefined): value is string {
  return parseEntityId(value) !== null;
}

function Field({
  label,
  value,
  detail,
  className = "",
}: {
  label: string;
  value: string;
  detail?: string;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:hidden">
        {label}
      </p>
      <p className="truncate" title={value}>
        {value}
      </p>
      {detail ? (
        <p className="truncate text-xs text-muted-foreground" title={detail}>
          {detail}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Scan safety, rendered as its own thing.
 *
 * The row used to print the raw upload status beside the review status, which
 * said "available" for a file whose only clean verdict came from the fixture
 * scanner. Those are different facts and a reviewer has to be able to tell them
 * apart before deciding anything.
 */
function SafetyBadge({ safety, status }: { safety: DocumentSafety; status: string | null }) {
  const presentation: Record<DocumentSafety, { label: string; className: string }> = {
    verified: { label: "已掃描安全", className: "bg-status-green-soft text-status-green-text" },
    pending: { label: "等待掃描", className: "bg-status-yellow-soft text-status-yellow-text" },
    unknown: { label: "安全未經核實", className: "bg-status-orange-soft text-status-orange-text" },
    unsafe: { label: "掃描拒絕", className: "bg-status-red-soft text-status-red-text" },
  };
  const { label, className } = presentation[safety];
  return (
    <span className="min-w-0">
      <span className={`inline-block rounded-md px-2 py-1 text-xs font-medium ${className}`}>
        {label}
      </span>
      <span className="mt-1 block text-xs text-muted-foreground">
        {status ? labelValue(status) : "只有文件登記，欠上載來源"}
      </span>
    </span>
  );
}

/**
 * The review controls for one production document.
 *
 * Preview exists because the one state where a staff member must look at a file
 * -- pending review -- was the one state with no way to open it: Download
 * rendered only for `available && verified`, so approve and reject were the only
 * available actions and both were taken blind. The server never required that;
 * downloadDocumentForActor checks upload status, not review status.
 */
function ReviewActions({
  document: record,
  safety,
  canReview,
  pending,
  isChecklistEvidence,
  checklistItemId,
  onDownload,
  onPreview,
  onReview,
}: {
  document: DocumentSummary;
  safety: DocumentSafety;
  canReview: boolean;
  pending: boolean;
  isChecklistEvidence: boolean;
  checklistItemId: string;
  onDownload: (documentId: string, expectedVersionId?: string) => void;
  onPreview: (documentId: string, fileName: string, expectedVersionId?: string) => void;
  onReview: (input: {
    caseId: string;
    documentId: string;
    expectedDocumentVersionId: string;
    checklistItemId?: string;
    decision: "verified" | "rejected";
    reason?: string;
  }) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reasonCode, setReasonCode] = useState<DocumentRejectionReasonCode>("missing-page");
  const [note, setNote] = useState("");
  const queryClient = useQueryClient();

  // "other" with no note records nothing a client could act on.
  const noteRequired = reasonCode === "other";
  const canSubmitRejection =
    canReview &&
    Boolean(record.currentVersionId) &&
    !pending &&
    (!noteRequired || note.trim().length > 0);

  if (
    !record.currentVersionId ||
    record.availability === "metadata_only" ||
    record.availability === "missing_object"
  ) {
    return (
      <div className="space-y-2">
        <p className="text-sm text-status-orange-text md:text-right">
          {!record.currentVersionId || record.availability === "metadata_only"
            ? "文件登記未有完整上載來源；物件尚未核對。"
            : "已核對但找不到儲存物件。"}
          不能預覽或批准，請先核對來源或受控補傳。
        </p>
        <DocumentRecoveryPanel
          documentId={record.id}
          onRecovered={() => void queryClient.invalidateQueries({ queryKey: ["documents"] })}
        />
      </div>
    );
  }

  if (safety === "unsafe") {
    return (
      <p className="text-sm text-status-red-text md:text-right">
        掃描拒絕，不能開啟。請要求客戶重新提供。
      </p>
    );
  }

  if (safety === "pending") {
    return (
      <p className="text-sm text-muted-foreground md:text-right">等待掃描完成後才可預覽及覆核。</p>
    );
  }

  if (safety === "unknown") {
    return (
      <div className="space-y-2">
        <p className="text-sm text-status-orange-text md:text-right">
          此檔案的來源或實際掃描尚未核實，不能批准。請核對來源並取得真實掃描結果。
        </p>
        <DocumentRecoveryPanel
          documentId={record.id}
          onRecovered={() => void queryClient.invalidateQueries({ queryKey: ["documents"] })}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 md:items-end">
      <div className="flex flex-wrap justify-start gap-2 md:justify-end">
        <Button
          onClick={() =>
            onPreview(record.id, record.fileName, record.currentVersionId ?? undefined)
          }
          type="button"
        >
          <Eye /> 開啟原件
        </Button>
        <Button
          onClick={() => onDownload(record.id, record.currentVersionId ?? undefined)}
          type="button"
        >
          <Download /> 下載
        </Button>
        {record.reviewStatus === "pending" ? (
          <>
            <Button
              variant="primary"
              disabled={!canReview || !record.currentVersionId || pending}
              onClick={() =>
                onReview({
                  caseId: record.caseId!,
                  documentId: record.id,
                  expectedDocumentVersionId: record.currentVersionId!,
                  checklistItemId: isChecklistEvidence ? checklistItemId : undefined,
                  decision: "verified",
                })
              }
              type="button"
            >
              {pending ? "覆核中…" : "核對"}
            </Button>
            <Button
              disabled={!canReview || !record.currentVersionId || pending}
              onClick={() => setRejecting((current) => !current)}
              type="button"
            >
              退回
            </Button>
          </>
        ) : null}
      </div>

      {rejecting && record.reviewStatus === "pending" ? (
        <div className="w-full space-y-2 rounded-md border p-2 md:max-w-sm">
          <label className="sr-only" htmlFor={`reject-reason-${record.id}`}>
            退回原因
          </label>
          <Select
            size="sm"
            id={`reject-reason-${record.id}`}
            aria-label={`「${record.fileName}」的退回原因`}
            className="w-full"
            value={reasonCode}
            onChange={(event) => setReasonCode(event.target.value as DocumentRejectionReasonCode)}
          >
            {DOCUMENT_REJECTION_REASONS.map((reason) => (
              <option key={reason.code} value={reason.code}>
                {reason.label}
              </option>
            ))}
          </Select>
          <label className="sr-only" htmlFor={`reject-note-${record.id}`}>
            給客戶的說明
          </label>
          <Textarea
            id={`reject-note-${record.id}`}
            aria-label={`給客戶的「${record.fileName}」說明`}
            className="w-full"
            placeholder="給客戶的說明（例如：第 2 頁未有董事簽署）"
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          <Button
            variant="destructive"
            className="w-full"
            disabled={!canSubmitRejection}
            onClick={() => {
              onReview({
                caseId: record.caseId!,
                documentId: record.id,
                expectedDocumentVersionId: record.currentVersionId!,
                checklistItemId: isChecklistEvidence ? checklistItemId : undefined,
                decision: "rejected",
                reason: composeRejectionReason(reasonCode, note),
              });
              setRejecting(false);
              setNote("");
            }}
            type="button"
          >
            確認退回
          </Button>
        </div>
      ) : null}
      <DocumentRecoveryPanel
        documentId={record.id}
        onRecovered={() => void queryClient.invalidateQueries({ queryKey: ["documents"] })}
      />
    </div>
  );
}
