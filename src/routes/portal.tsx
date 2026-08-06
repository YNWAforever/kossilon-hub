import { annualReturnQueryKeys } from "../features/annual-return/query-keys";
import { getAnnualReturnCase } from "../features/annual-return/server-fns";
import type { AnnualReturnCase as ProductionAnnualReturnCase } from "../features/annual-return/types";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, Download, ReceiptText } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import type { StatusTone } from "@/lib/status";
import { formatDate } from "@/lib/format-date";
import {
  getClientPortalCase,
  listClientPortalCases,
  type ClientPortalCaseDetail,
} from "../features/annual-return/client-portal-server-fns";
import {
  createDocumentUploadIntent,
  downloadDocument,
  finalizeDocumentUpload,
  listDocuments,
} from "../features/documents/server-fns";
import { DOCUMENT_CATEGORIES, type DocumentCategory } from "../features/documents/types";

import {
  type AnnualReturnCase,
  getPacketStatus,
  useAnnualReturnCases,
} from "../lib/annual-return-store";
import {
  getClientPortalActivity,
  getClientPortalProgress,
  getClientPortalRequiredActions,
  getDocumentArchiveRows,
  getPaymentProofsForCase,
  useClientPortalSnapshot,
  type ClientPortalArchiveRow,
  type ClientPortalPaymentProof,
  type ClientPortalRequiredAction,
} from "../lib/client-portal-store";

type PortalSearch = {
  caseId?: string;
};

export const Route = createFileRoute("/portal")({
  validateSearch: (search): PortalSearch => ({
    caseId: typeof search.caseId === "string" ? search.caseId : undefined,
  }),
  component: PortalRoute,
});

function PortalRoute() {
  const { dataMode, actor } = Route.useRouteContext();
  const cases = useAnnualReturnCases();
  const snapshot = useClientPortalSnapshot();
  const { caseId } = Route.useSearch();
  const navigate = useNavigate({ from: "/portal" });
  const productionCaseId = caseId && isUuid(caseId) ? caseId : undefined;
  const productionCaseQuery = useQuery({
    queryKey: annualReturnQueryKeys.detail(productionCaseId ?? "portal"),
    queryFn: () => getAnnualReturnCase({ data: { id: productionCaseId! } }),
    // getAnnualReturnCase resolves a staff actor, so firing it for a Client is a
    // guaranteed Forbidden. The client branch below has its own scoped read.
    enabled: Boolean(productionCaseId) && actor?.role !== "Client",
    retry: false,
  });
  const [warning, setWarning] = useState<string | undefined>();

  const matchedCase = caseId ? cases.find((caseItem) => caseItem.id === caseId) : undefined;
  const selectedCase = caseId ? matchedCase : cases[0];

  useEffect(() => {
    if (dataMode !== "demo" || !selectedCase || caseId || caseId === selectedCase.id) return;

    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, caseId: selectedCase.id }),
    });
  }, [caseId, dataMode, navigate, selectedCase]);

  if (dataMode !== "demo") {
    // A Client sign-in gets its own companies' cases. Every other read in this
    // feature resolves a staff actor, so before this a client landed on the
    // "unavailable" branch below and had no route anywhere.
    if (actor?.role === "Client") {
      return <ClientPortalView caseId={productionCaseId} />;
    }

    if (!productionCaseId) {
      return (
        <main className="flex-1 space-y-3 p-6">
          <PageHeader eyebrow="Operations" title="Production portal" />
          {/* The sidebar links here with no caseId, so this is the screen staff
              actually land on. It used to stop at a sentence, leaving the only
              route onward as editing the URL by hand. */}
          <p className="text-sm text-muted-foreground">
            Open a case from the annual returns board to see its client portal.
          </p>
          <Link className="inline-flex rounded-md border px-3 py-2 text-sm" to="/annual-returns">
            Browse annual returns
          </Link>
        </main>
      );
    }
    if (productionCaseQuery.isLoading) {
      return <div className="p-6 text-sm text-muted-foreground">Loading production portal...</div>;
    }
    if (productionCaseQuery.data) {
      return <ProductionPortalCaseView caseItem={productionCaseQuery.data} />;
    }
    return (
      <main className="flex-1 space-y-3 p-6">
        <PageHeader eyebrow="Operations" title="Portal case unavailable" />
        <p className="text-sm text-destructive">
          Unable to load the production annual return case.
        </p>
      </main>
    );
  }

  if (!selectedCase) {
    return (
      <main className="flex-1 space-y-4 p-6">
        <PageHeader eyebrow="Operations" title="Portal case not found" />
        <Link className="inline-flex rounded-md border px-3 py-2 text-sm" to="/annual-returns">
          Back to staff app
        </Link>
      </main>
    );
  }

  const progress = getClientPortalProgress(selectedCase, snapshot);
  const requiredActions = getClientPortalRequiredActions(selectedCase, snapshot);
  const activity = getClientPortalActivity(selectedCase.id, snapshot);
  const archiveRows = getDocumentArchiveRows([selectedCase], snapshot);
  const paymentProofs = getPaymentProofsForCase(selectedCase.id, snapshot);
  const packetStatus = getPacketStatus(selectedCase);
  const isReadOnly = progress.isReadOnly;

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader
        eyebrow="Client portal demo"
        title={selectedCase.companyName}
        subtitle={`Annual return due ${selectedCase.dueDate} / Packet ${packetStatus}`}
        actions={
          <select
            aria-label="Select portal case"
            className="rounded-md border bg-background px-3 py-2 text-sm"
            value={selectedCase.id}
            onChange={(event) => {
              setWarning(undefined);
              void navigate({
                search: (previous) => ({ ...previous, caseId: event.target.value }),
              });
            }}
          >
            {cases.map((caseItem) => (
              <option key={caseItem.id} value={caseItem.id}>
                {caseItem.companyName}
              </option>
            ))}
          </select>
        }
      />

      {warning ? (
        <div className="rounded-md bg-status-yellow-soft px-3 py-2 text-sm text-status-yellow">
          {warning}
        </div>
      ) : null}

      <section className="rounded-lg border bg-card p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_220px] md:items-center">
          <div>
            <h2 className="text-lg font-semibold">Next client action</h2>
            <p className="mt-1 text-sm text-muted-foreground">{progress.nextAction}</p>
          </div>
          <div>
            <div className="h-2 rounded-full bg-muted">
              <div
                className="h-2 rounded-full bg-primary"
                style={{ width: `${progress.percentage}%` }}
              />
            </div>
            <p className="mt-2 text-right text-sm text-muted-foreground">
              {progress.completed}/{progress.total} complete
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Required actions</h2>
              <p className="text-sm text-muted-foreground">
                Mock client actions update the staff archive and case timeline.
              </p>
            </div>
            <CheckCircle2 className="h-5 w-5 text-primary" />
          </div>
          <div className="mt-4 space-y-3">
            {requiredActions.map((action) => (
              <PortalActionRow
                key={action.id}
                action={action}
                caseItem={selectedCase}
                isReadOnly={isReadOnly}
                onWarning={setWarning}
              />
            ))}
            {requiredActions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No client action is needed.</p>
            ) : null}
          </div>
        </section>

        <section className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Portal activity</h2>
              <p className="text-sm text-muted-foreground">Newest client actions appear first.</p>
            </div>
            <ReceiptText className="h-5 w-5 text-primary" />
          </div>
          <div className="mt-4 space-y-3">
            {activity.length === 0 ? (
              <p className="text-sm text-muted-foreground">No portal activity yet.</p>
            ) : (
              activity.map((item) => (
                <div key={item.id} className="rounded-md border px-3 py-3 text-sm">
                  <p className="font-medium">{item.summary}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatTimestamp(item.createdAt)}
                  </p>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <PaymentProofHistory proofs={paymentProofs} />

      <ArchivePreview rows={archiveRows} selectedCase={selectedCase} />

      <ProductionDocumentPanel
        companyId={selectedCase.clientId}
        caseId={selectedCase.id}
        onWarning={setWarning}
      />
    </main>
  );
}

function PortalActionRow({
  action,
  caseItem,
  isReadOnly,
  onWarning,
}: {
  action: ClientPortalRequiredAction;
  caseItem: AnnualReturnCase;
  isReadOnly: boolean;
  onWarning: (warning: string | undefined) => void;
}) {
  const primaryDisabled = action.status !== "open" || (action.kind !== "receipt" && isReadOnly);
  const documentPrimaryLabel =
    action.kind === "document"
      ? action.documentAction === "replace"
        ? "Replace"
        : "Upload"
      : undefined;
  const showPrimaryAction =
    action.kind === "document"
      ? action.status === "open" && Boolean(action.documentAction)
      : action.kind === "payment-proof"
        ? action.status === "open" && Boolean(action.paymentProofAction)
        : true;

  function handlePrimaryAction() {
    onWarning(undefined);

    if (action.kind === "document") {
      onWarning("Use the production document uploader below to submit this file.");
      return;
    }

    if (action.kind === "payment-proof" && action.paymentProofAction) {
      onWarning("Use the production document uploader for private proof files.");
      return;
    }

    if (action.kind === "payment") {
      onWarning(
        "Production payment acknowledgement is handled by the annual-return server action.",
      );
      return;
    }

    if (action.kind === "packet") {
      onWarning("Production packet approval is handled by the annual-return server action.");
      return;
    }

    if (action.kind === "receipt") {
      onWarning("Production receipt viewing is handled by the annual-return server action.");
    }
  }

  return (
    <div className="rounded-md border px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{action.label}</p>
          <p className="mt-1 text-sm text-muted-foreground">{action.detail}</p>
        </div>
        <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">{action.status}</span>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {showPrimaryAction ? (
          <button
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
            disabled={primaryDisabled}
            onClick={handlePrimaryAction}
            type="button"
            aria-label={
              action.kind === "payment-proof"
                ? `${primaryActionLabel(action)} for ${caseItem.companyName}`
                : documentPrimaryLabel
                  ? `${documentPrimaryLabel} ${action.label}`
                  : undefined
            }
          >
            {primaryActionLabel(action)}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function PaymentProofHistory({ proofs }: { proofs: ClientPortalPaymentProof[] }) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <div>
        <h2 className="text-lg font-semibold">Payment proof history</h2>
        <p className="text-sm text-muted-foreground">Uploaded proof and staff review outcomes.</p>
      </div>
      <div className="mt-4 divide-y">
        {proofs.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">No payment proof uploaded yet.</p>
        ) : (
          proofs.map((proof) => (
            <div
              key={proof.id}
              className="grid gap-2 py-3 text-sm md:grid-cols-[minmax(0,1fr)_140px_120px]"
            >
              <div className="min-w-0">
                <p className="font-medium">{proof.filename}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Uploaded by {proof.uploadedBy} on {formatTimestamp(proof.uploadedAt)}
                </p>
                {proof.reviewedBy && proof.reviewedAt ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Reviewed by {proof.reviewedBy} on {formatTimestamp(proof.reviewedAt)}
                  </p>
                ) : null}
                {proof.reviewReasonLabel ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Reason: {proof.reviewReasonLabel}
                    {proof.reviewNote ? ` - ${proof.reviewNote}` : ""}
                  </p>
                ) : null}
              </div>
              <span>{proof.origin}</span>
              <span>{proof.status}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function ArchivePreview({
  rows,
  selectedCase,
}: {
  rows: ClientPortalArchiveRow[];
  selectedCase: AnnualReturnCase;
}) {
  const previewRows = useMemo(() => rows.slice(0, 5), [rows]);

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Shared archive</h2>
          <p className="text-sm text-muted-foreground">
            Portal uploads and generated filing records appear here and in Documents.
          </p>
        </div>
        <Link
          className="rounded-md border px-3 py-2 text-sm"
          to="/documents"
          search={{ caseId: selectedCase.id }}
        >
          Open documents
        </Link>
      </div>
      <div className="mt-4 divide-y">
        {previewRows.length === 0 ? (
          <p className="py-3 text-sm text-muted-foreground">No archive rows yet.</p>
        ) : (
          previewRows.map((row) => (
            <div key={row.id} className="grid gap-2 py-3 text-sm md:grid-cols-[1fr_140px_120px]">
              <span className="font-medium">
                {row.title}
                {row.reviewSummary ? (
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    {row.reviewSummary}
                    {row.reviewReasonLabel ? ` - ${row.reviewReasonLabel}` : ""}
                    {row.reviewNote ? ` - ${row.reviewNote}` : ""}
                  </span>
                ) : null}
              </span>
              <span>{row.source}</span>
              <span>{row.status}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

// Mapped here rather than reusing lib/status's caseStatusTone, which is typed
// against the demo CaseStatus vocabulary and differs from the production one.
function clientPortalStatusTone(status: ProductionAnnualReturnCase["currentStatus"]): StatusTone {
  switch (status) {
    case "Documents pending":
    case "Signature pending":
      return "yellow";
    case "Payment pending":
      return "orange";
    case "Filed":
    case "Completed":
      return "blue";
    default:
      return "green";
  }
}

/**
 * The client's own view of one filing. Deliberately NOT ProductionPortalCaseView:
 * that is the staff screen and takes the internal AnnualReturnCase, which carries
 * the owner, reviewer and risk grade. This renders the projection instead.
 */
function ClientPortalCaseView({ caseItem }: { caseItem: ClientPortalCaseDetail }) {
  const [, setWarning] = useState<string | undefined>();
  const outstanding = caseItem.checklist.filter(
    (item) => item.required && item.status !== "Verified",
  );

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader
        eyebrow="Client portal"
        title={caseItem.companyName}
        subtitle={`Annual return ${caseItem.returnYear} · due ${formatDate(caseItem.filingDueDate)}`}
      />

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-base font-semibold text-foreground">Progress</h2>
          <StatusPill tone={clientPortalStatusTone(caseItem.currentStatus)}>
            {caseItem.currentStatus}
          </StatusPill>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {outstanding.length === 0
            ? "Everything we need from you has been received."
            : `We are still waiting on ${outstanding.length} document${outstanding.length === 1 ? "" : "s"} from you.`}
        </p>
        {outstanding.length > 0 ? (
          <ul className="mt-3 list-inside list-disc text-sm text-muted-foreground">
            {outstanding.map((item) => (
              <li key={item.id}>{item.itemLabel}</li>
            ))}
          </ul>
        ) : null}
        {caseItem.payment ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Invoice {caseItem.payment.invoiceNumber} — {caseItem.payment.currency}{" "}
            {caseItem.payment.amount} · {caseItem.payment.status}
          </p>
        ) : null}
        {caseItem.filingReference ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Filing reference {caseItem.filingReference}
          </p>
        ) : null}
      </section>

      <ProductionDocumentPanel
        companyId={caseItem.companyId}
        caseId={caseItem.id}
        onWarning={setWarning}
      />
      <Link className="inline-flex rounded-md border px-3 py-2 text-sm" to="/portal">
        Back to your filings
      </Link>
    </main>
  );
}

/**
 * What a client signing in actually sees: their own companies' annual returns,
 * and the document panel for whichever one they open. Read-only apart from the
 * uploads the documents feature already authorises for Client actors.
 */
function ClientPortalView({ caseId }: { caseId?: string }) {
  const casesQuery = useQuery({
    queryKey: ["client-portal", "cases"],
    queryFn: () => listClientPortalCases({ data: {} }),
    retry: false,
  });
  const caseQuery = useQuery({
    queryKey: ["client-portal", "case", caseId ?? "none"],
    queryFn: () => getClientPortalCase({ data: { caseId: caseId! } }),
    enabled: Boolean(caseId),
    retry: false,
  });

  if (caseId) {
    if (caseQuery.isPending) {
      return <div className="p-6 text-sm text-muted-foreground">Loading your annual return...</div>;
    }
    if (caseQuery.data) {
      return <ClientPortalCaseView caseItem={caseQuery.data} />;
    }
    return (
      <main className="flex-1 space-y-3 p-6">
        <PageHeader eyebrow="Client portal" title="Annual return not found" />
        <p className="text-sm text-muted-foreground">
          This annual return is not one of your company&rsquo;s filings.
        </p>
        <Link className="inline-flex rounded-md border px-3 py-2 text-sm" to="/portal">
          Back to your filings
        </Link>
      </main>
    );
  }

  if (casesQuery.isPending) {
    return <div className="p-6 text-sm text-muted-foreground">Loading your filings...</div>;
  }

  const cases = casesQuery.data ?? [];

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader
        eyebrow="Client portal"
        title="Your annual returns"
        subtitle="Filings we are preparing for your company"
      />
      {cases.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          There are no annual returns on file for your company yet. Your company secretary will be
          in touch when one is due.
        </p>
      ) : (
        <ul className="space-y-3">
          {cases.map((caseItem) => (
            <li key={caseItem.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-display text-base font-semibold text-foreground">
                  {caseItem.companyName} — {caseItem.returnYear}
                </p>
                <StatusPill tone={clientPortalStatusTone(caseItem.currentStatus)}>
                  {caseItem.currentStatus}
                </StatusPill>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Due {formatDate(caseItem.filingDueDate)}
                {caseItem.outstandingRequiredItems > 0
                  ? ` · ${caseItem.outstandingRequiredItems} document${
                      caseItem.outstandingRequiredItems === 1 ? "" : "s"
                    } still needed from you`
                  : " · nothing outstanding from you"}
              </p>
              <Link
                className="mt-3 inline-flex rounded-md border px-3 py-2 text-sm"
                to="/portal"
                search={{ caseId: caseItem.id }}
              >
                Open
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function ProductionPortalCaseView({ caseItem }: { caseItem: ProductionAnnualReturnCase }) {
  const [, setWarning] = useState<string | undefined>();
  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader
        eyebrow="Client portal"
        title={caseItem.companyName}
        subtitle={`Production annual return ${caseItem.returnYear}`}
      />
      <ProductionDocumentPanel
        companyId={caseItem.companyId}
        caseId={caseItem.id}
        onWarning={setWarning}
      />
    </main>
  );
}
function ProductionDocumentPanel({
  companyId,
  caseId,
  onWarning,
}: {
  companyId: string;
  caseId: string;
  onWarning: (warning: string | undefined) => void;
}) {
  const queryClient = useQueryClient();
  const [category, setCategory] = useState<DocumentCategory>("other");
  const [file, setFile] = useState<File | undefined>();
  const productionReady = isUuid(companyId) && isUuid(caseId);
  const documentsQuery = useQuery({
    queryKey: annualReturnQueryKeys.documents(caseId),
    queryFn: () => listDocuments({ data: { companyId, caseId } }),
    enabled: productionReady,
    retry: false,
  });
  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a document first.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const checksum = await sha256Hex(bytes);
      const intent = await createDocumentUploadIntent({
        data: {
          companyId,
          caseId,
          category,
          fileName: file.name,
          contentType: file.type,
          sizeBytes: file.size,
          checksum,
        },
      });
      return finalizeDocumentUpload({
        data: { intentId: intent.id, bodyBase64: bytesToBase64(bytes) },
      });
    },
    onSuccess: () => {
      setFile(undefined);
      onWarning("Document uploaded and quarantined for staff scanning.");
      void queryClient.invalidateQueries({ queryKey: annualReturnQueryKeys.documents(caseId) });
    },
    onError: (error) => onWarning(error instanceof Error ? error.message : "Upload failed."),
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
      onWarning(error instanceof Error ? error.message : "Unable to download document.");
    }
  }

  return (
    <section className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Production document upload</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Files are uploaded to private storage and remain quarantined until staff scanning.
          </p>
        </div>
        <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">Private upload</span>
      </div>
      {!productionReady ? (
        <p className="mt-4 rounded-md bg-muted px-3 py-3 text-sm text-muted-foreground">
          This demo case is not connected to production company and case IDs yet.
        </p>
      ) : (
        <>
          <div className="mt-4 grid gap-3 md:grid-cols-[180px_minmax(0,1fr)_auto] md:items-end">
            <label className="grid gap-1 text-sm">
              Category
              <select
                className="rounded-md border bg-background px-3 py-2"
                value={category}
                onChange={(event) => setCategory(event.target.value as DocumentCategory)}
              >
                {DOCUMENT_CATEGORIES.map((item) => (
                  <option key={item} value={item}>
                    {labelValue(item)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1 text-sm">
              File
              <input
                className="rounded-md border bg-background px-3 py-2"
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                onChange={(event) => setFile(event.target.files?.[0])}
              />
            </label>
            <button
              className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
              disabled={!file || uploadMutation.isPending}
              onClick={() => uploadMutation.mutate()}
              type="button"
            >
              {uploadMutation.isPending ? "Uploading..." : "Upload securely"}
            </button>
          </div>
          <div className="mt-4 divide-y">
            {documentsQuery.error ? (
              <p className="py-3 text-sm text-status-yellow">Production documents unavailable.</p>
            ) : null}
            {!documentsQuery.isLoading &&
            !documentsQuery.error &&
            (documentsQuery.data?.length ?? 0) === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">No production documents yet.</p>
            ) : null}
            {documentsQuery.data?.map((document) => (
              <div
                key={document.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
              >
                <div>
                  <p className="font-medium">{document.fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {labelValue(document.uploadStatus)} / {labelValue(document.reviewStatus)}
                  </p>
                </div>
                {document.uploadStatus === "available" && document.reviewStatus === "verified" ? (
                  <button
                    className="inline-flex items-center gap-2 rounded-md border px-3 py-2"
                    onClick={() => handleDownload(document.id)}
                    type="button"
                  >
                    <Download className="h-4 w-4" /> Download
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
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

function primaryActionLabel(action: ClientPortalRequiredAction): string {
  if (action.kind === "document") return action.documentAction === "replace" ? "Replace" : "Upload";
  if (action.kind === "payment-proof") {
    return action.paymentProofAction === "replace"
      ? "Replace payment proof"
      : "Upload payment proof";
  }
  if (action.kind === "payment") return "Acknowledge payment";
  if (action.kind === "packet") return "Approve packet";
  return "View receipt";
}
