import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { downloadDocument, listDocuments, reviewDocument } from "../features/documents/server-fns";
import type { PrivateDocument } from "../features/documents/repository";

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
  caseId?: string;
};

export const Route = createFileRoute("/documents")({
  validateSearch: (search): DocumentsSearch => ({
    caseId: typeof search.caseId === "string" ? search.caseId : undefined,
  }),
  component: DocumentsRoute,
});

function DocumentsRoute() {
  const cases = useAnnualReturnCases();
  const snapshot = useClientPortalSnapshot();
  const queryClient = useQueryClient();
  const { caseId } = Route.useSearch();
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [caseFilter, setCaseFilter] = useState(caseId ?? "all");
  const [warning, setWarning] = useState<string | undefined>();
  const productionCaseId = isUuid(caseFilter) ? caseFilter : undefined;
  const productionDocumentsQuery = useQuery({
    queryKey: ["documents", "archive", productionCaseId ?? "all"],
    queryFn: () => listDocuments({ data: productionCaseId ? { caseId: productionCaseId } : {} }),
    retry: false,
  });
  const reviewMutation = useMutation({
    mutationFn: (input: {
      documentId: string;
      decision: "verified" | "rejected";
      reason?: string;
    }) => reviewDocument({ data: input }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["documents"] }),
  });

  async function handleDownload(documentId: string) {
    try {
      const response = await downloadDocument({ data: { documentId } });
      if (!response.ok) throw new Error(`Download failed (${response.status}).`);
      const href = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = "document";
      anchor.click();
      URL.revokeObjectURL(href);
    } catch (error) {
      setWarning(error instanceof Error ? error.message : "Unable to download document.");
    }
  }

  useEffect(() => {
    setCaseFilter(caseId ?? "all");
  }, [caseId]);

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
    <div className="space-y-6 p-6">
      <div>
        <p className="text-sm font-medium text-muted-foreground">Workspace</p>
        <h1 className="mt-1 text-3xl font-semibold">Documents</h1>
      </div>

      {warning ? (
        <div className="rounded-md bg-status-yellow-soft px-3 py-2 text-sm text-status-yellow">
          {warning}
        </div>
      ) : null}

      <ProductionDocumentsSection
        documents={productionDocumentsQuery.data ?? []}
        error={productionDocumentsQuery.error}
        loading={productionDocumentsQuery.isLoading}
        onDownload={handleDownload}
        onReview={(input) => reviewMutation.mutate(input)}
      />

      <section className="rounded-lg border bg-card">
        <div className="grid gap-3 border-b p-4 xl:grid-cols-[1fr_180px_180px_180px_220px]">
          <input
            aria-label="Search documents"
            className="rounded-md border bg-background px-3 py-2 text-sm"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search company, contact, title, or filename"
            value={query}
          />
          <FilterSelect
            label="Filter by source"
            value={source}
            onChange={setSource}
            values={["client-portal", "staff-packet", "filing-submission", "filing-receipt"]}
          />
          <FilterSelect
            label="Filter by category"
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
            label="Filter by status"
            value={status}
            onChange={setStatus}
            values={["required", "uploaded", "superseded", "accepted", "rejected", "generated"]}
          />
          <select
            aria-label="Filter by case"
            className="rounded-md border bg-background px-3 py-2 text-sm"
            value={caseFilter}
            onChange={(event) => setCaseFilter(event.target.value)}
          >
            <option value="all">All cases</option>
            {cases.map((caseItem) => (
              <option key={caseItem.id} value={caseItem.id}>
                {caseItem.companyName}
              </option>
            ))}
          </select>
        </div>

        <div className="hidden grid-cols-[1.4fr_1fr_120px_130px_130px_150px_140px_170px_100px] gap-3 border-b px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:grid">
          <span>Document</span>
          <span>Company</span>
          <span>Category</span>
          <span>Source</span>
          <span>Status</span>
          <span>Uploaded by</span>
          <span>Updated</span>
          <span>Review</span>
          <span className="text-right">Case</span>
        </div>

        <div className="divide-y">
          {visibleRows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No documents match these filters.</p>
          ) : (
            visibleRows.map((row) => (
              <DocumentRow
                key={row.id}
                row={row}
                cases={cases}
                snapshot={snapshot}
                onWarning={setWarning}
                onReview={(input) => reviewMutation.mutate(input)}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: string;
  values: string[];
  onChange: (value: string) => void;
}) {
  return (
    <select
      aria-label={label}
      className="rounded-md border bg-background px-3 py-2 text-sm"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="all">{label.replace("Filter by ", "All ")}</option>
      {values.map((item) => (
        <option key={item} value={item}>
          {labelValue(item)}
        </option>
      ))}
    </select>
  );
}

function DocumentRow({
  row,
  cases,
  snapshot,
  onWarning,
  onReview,
}: {
  row: ClientPortalArchiveRow;
  cases: ReturnType<typeof useAnnualReturnCases>;
  snapshot: ReturnType<typeof useClientPortalSnapshot>;
  onReview: (input: {
    documentId: string;
    decision: "verified" | "rejected";
    reason?: string;
  }) => void;
  onWarning: (warning: string | undefined) => void;
}) {
  const followUp = getDocumentReviewFollowUpDrafts(cases, snapshot).find(
    (draft) => draft.documentId === row.documentId,
  );

  function handleReview(
    decision: ClientPortalDocumentReviewDecision,
    options: { reasonCode?: ClientPortalReviewReasonCode; note?: string } = {},
  ) {
    if (!row.documentId || !isUuid(row.documentId)) {
      onWarning("Demo archive rows are read-only; production records are reviewed above.");
      return;
    }
    onReview({
      documentId: row.documentId,
      decision: decision === "accepted" ? "verified" : "rejected",
      reason: options.note || options.reasonCode,
    });
  }

  return (
    <div className="grid gap-3 px-4 py-4 text-sm lg:grid-cols-[1.4fr_1fr_120px_130px_130px_150px_140px_170px_100px] lg:items-center">
      <div className="min-w-0">
        <p className="truncate font-medium">{row.title}</p>
        <p className="truncate text-muted-foreground">{row.filename}</p>
      </div>
      <Field label="Company" value={row.companyName} />
      <Field label="Category" value={labelValue(row.category)} />
      <Field label="Source" value={labelValue(row.source)} />
      <Field label="Status" value={labelValue(row.status)} />
      <Field label="Uploaded by" value={row.actor} />
      <Field label="Updated" value={formatTimestamp(row.createdAt)} />
      <ReviewCell row={row} followUpStatus={followUp?.status} onReview={handleReview} />
      <div className="flex justify-start lg:justify-end">
        <Link
          className="rounded-md border px-3 py-2 text-sm"
          to="/annual-returns/$id"
          params={{ id: row.caseId }}
        >
          Open
        </Link>
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
          <button
            aria-label={`Accept ${row.title}`}
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
            onClick={() => onReview("accepted")}
            type="button"
          >
            Accept
          </button>
          <button
            aria-label={`Reject ${row.title}`}
            className="rounded-md border px-3 py-2 text-sm"
            onClick={() => setIsRejecting((current) => !current)}
            type="button"
          >
            Reject
          </button>
        </div>
        {isRejecting ? (
          <div className="space-y-2">
            <select
              aria-label={`Rejection reason for ${row.title}`}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
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
            </select>
            <input
              aria-label={`Optional review note for ${row.title}`}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Optional review note"
            />
            <button
              className="rounded-md border px-3 py-2 text-sm"
              onClick={() => onReview("rejected", { reasonCode, note })}
              type="button"
            >
              Confirm rejection
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  if (row.reviewSummary || row.reviewedBy || row.reviewedAt) {
    return (
      <div className="space-y-1 text-xs text-muted-foreground">
        <p className="truncate text-sm font-medium text-foreground">
          {row.reviewSummary ?? "Reviewed"}
        </p>
        {row.reviewReasonLabel ? <p>{row.reviewReasonLabel}</p> : null}
        {row.reviewNote ? <p>{row.reviewNote}</p> : null}
        {followUpStatus ? <p>{`Follow-up: ${followUpStatus}`}</p> : null}
        {row.reviewedBy ? <p>{`Reviewed by ${row.reviewedBy}`}</p> : null}
        {row.reviewedAt ? <p>{`Reviewed ${formatTimestamp(row.reviewedAt)}`}</p> : null}
      </div>
    );
  }

  return (
    <Field
      label="Review"
      value={row.reviewSummary ?? (row.readonly ? "Read-only" : "No review needed")}
    />
  );
}

function ProductionDocumentsSection({
  documents,
  error,
  loading,
  onDownload,
  onReview,
}: {
  documents: PrivateDocument[];
  error: Error | null;
  loading: boolean;
  onDownload: (documentId: string) => void;
  onReview: (input: {
    documentId: string;
    decision: "verified" | "rejected";
    reason?: string;
  }) => void;
}) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Production document vault</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Private R2-backed records stay quarantined until staff review.
          </p>
        </div>
        <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">Neon + R2</span>
      </div>
      {error ? (
        <p className="mt-4 text-sm text-status-yellow">Production records unavailable.</p>
      ) : null}
      {loading ? (
        <p className="mt-4 text-sm text-muted-foreground">Loading production records...</p>
      ) : null}
      {!loading && !error && documents.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No production documents match this scope.
        </p>
      ) : null}
      <div className="mt-4 divide-y">
        {documents.map((document) => (
          <div
            key={document.id}
            className="grid gap-3 py-3 text-sm md:grid-cols-[minmax(0,1fr)_120px_120px_180px] md:items-center"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{document.fileName}</p>
              <p className="mt-1 text-xs text-muted-foreground">{labelValue(document.category)}</p>
            </div>
            <span>{labelValue(document.uploadStatus)}</span>
            <span>{labelValue(document.reviewStatus)}</span>
            <div className="flex flex-wrap justify-start gap-2 md:justify-end">
              {document.uploadStatus === "available" && document.reviewStatus === "verified" ? (
                <button
                  className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
                  onClick={() => onDownload(document.id)}
                  type="button"
                >
                  <Download className="h-4 w-4" /> Download
                </button>
              ) : null}
              {document.uploadStatus === "available" && document.reviewStatus === "pending" ? (
                <>
                  <button
                    className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground"
                    onClick={() => onReview({ documentId: document.id, decision: "verified" })}
                    type="button"
                  >
                    Verify
                  </button>
                  <button
                    className="rounded-md border px-3 py-2 text-sm"
                    onClick={() =>
                      onReview({
                        documentId: document.id,
                        decision: "rejected",
                        reason: "Rejected during staff review",
                      })
                    }
                    type="button"
                  >
                    Reject
                  </button>
                </>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function isUuid(value: string | undefined): value is string {
  return Boolean(
    value &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:hidden">
        {label}
      </p>
      <p className="truncate">{value}</p>
    </div>
  );
}

function labelValue(value: string): string {
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString("en-HK", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
