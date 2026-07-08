import { useEffect, useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";

import { useAnnualReturnCases } from "../lib/annual-return-store";
import {
  getDocumentArchiveRows,
  useClientPortalSnapshot,
  type ClientPortalArchiveRow,
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
  const { caseId } = Route.useSearch();
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("all");
  const [category, setCategory] = useState("all");
  const [status, setStatus] = useState("all");
  const [caseFilter, setCaseFilter] = useState(caseId ?? "all");

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

        <div className="hidden grid-cols-[1.4fr_1fr_120px_130px_130px_150px_140px_100px] gap-3 border-b px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:grid">
          <span>Document</span>
          <span>Company</span>
          <span>Category</span>
          <span>Source</span>
          <span>Status</span>
          <span>Uploaded by</span>
          <span>Updated</span>
          <span className="text-right">Case</span>
        </div>

        <div className="divide-y">
          {visibleRows.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No documents match these filters.</p>
          ) : (
            visibleRows.map((row) => <DocumentRow key={row.id} row={row} />)
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

function DocumentRow({ row }: { row: ClientPortalArchiveRow }) {
  return (
    <div className="grid gap-3 px-4 py-4 text-sm lg:grid-cols-[1.4fr_1fr_120px_130px_130px_150px_140px_100px] lg:items-center">
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
