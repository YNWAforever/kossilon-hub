import { useEffect, useMemo, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckCircle2, FileUp, ReceiptText } from "lucide-react";

import {
  type AnnualReturnCase,
  getPacketStatus,
  useAnnualReturnCases,
} from "../lib/annual-return-store";
import {
  acknowledgePaymentInstructions,
  approveClientPacket,
  getClientPortalActivity,
  getClientPortalProgress,
  getClientPortalRequiredActions,
  getDocumentArchiveRows,
  recordReceiptViewed,
  replaceClientDocument,
  uploadClientDocument,
  useClientPortalSnapshot,
  type ClientPortalArchiveRow,
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
  const cases = useAnnualReturnCases();
  const snapshot = useClientPortalSnapshot();
  const { caseId } = Route.useSearch();
  const navigate = useNavigate({ from: "/portal" });
  const [warning, setWarning] = useState<string | undefined>();

  const selectedCase = cases.find((caseItem) => caseItem.id === caseId) ?? cases[0];

  useEffect(() => {
    if (!selectedCase || caseId === selectedCase.id) return;

    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, caseId: selectedCase.id }),
    });
  }, [caseId, navigate, selectedCase]);

  if (!selectedCase) {
    return (
      <div className="space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Portal case not found</h1>
        <Link className="inline-flex rounded-md border px-3 py-2 text-sm" to="/annual-returns">
          Back to staff app
        </Link>
      </div>
    );
  }

  const progress = getClientPortalProgress(selectedCase, snapshot);
  const requiredActions = getClientPortalRequiredActions(selectedCase, snapshot);
  const activity = getClientPortalActivity(selectedCase.id, snapshot);
  const archiveRows = getDocumentArchiveRows([selectedCase], snapshot);
  const packetStatus = getPacketStatus(selectedCase);
  const isReadOnly = progress.isReadOnly;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-muted-foreground">Client portal demo</p>
          <h1 className="mt-1 text-3xl font-semibold">{selectedCase.companyName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Annual return due {selectedCase.dueDate} / Packet {packetStatus}
          </p>
        </div>
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
      </div>

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

      <ArchivePreview rows={archiveRows} selectedCase={selectedCase} />
    </div>
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
  const replaceDisabled = action.status === "blocked" || isReadOnly;

  function handlePrimaryAction() {
    onWarning(undefined);

    if (action.kind === "document" && action.requirementId) {
      const result = uploadClientDocument(
        caseItem,
        action.requirementId,
        `${caseItem.id}-${action.requirementId}.pdf`,
      );
      onWarning(result.ok ? undefined : result.reason);
      return;
    }

    if (action.kind === "payment") {
      const result = acknowledgePaymentInstructions(caseItem);
      onWarning(result.ok ? undefined : result.reason);
      return;
    }

    if (action.kind === "packet") {
      const result = approveClientPacket(caseItem);
      onWarning(result.ok ? undefined : result.reason);
      return;
    }

    if (action.kind === "receipt") {
      const result = recordReceiptViewed(caseItem);
      onWarning(result.ok ? undefined : result.reason);
    }
  }

  function handleReplace() {
    if (!action.requirementId) return;
    const result = replaceClientDocument(
      caseItem,
      action.requirementId,
      `${caseItem.id}-${action.requirementId}-replacement.pdf`,
    );
    onWarning(result.ok ? undefined : result.reason);
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
        {action.kind === "document" && action.status === "complete" ? (
          <button
            className="inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
            disabled={replaceDisabled}
            onClick={handleReplace}
            type="button"
          >
            <FileUp className="h-4 w-4" />
            Replace
          </button>
        ) : null}
        {action.kind !== "document" || action.status !== "complete" ? (
          <button
            className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
            disabled={primaryDisabled}
            onClick={handlePrimaryAction}
            type="button"
          >
            {action.kind === "document"
              ? "Upload"
              : action.kind === "payment"
                ? "Acknowledge payment"
                : action.kind === "packet"
                  ? "Approve packet"
                  : "View receipt"}
          </button>
        ) : null}
      </div>
    </div>
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
              <span className="font-medium">{row.title}</span>
              <span>{row.source}</span>
              <span>{row.status}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
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
