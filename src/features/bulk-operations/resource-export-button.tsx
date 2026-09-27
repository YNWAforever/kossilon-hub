import { useState } from "react";
import { exportResourceSelectionCsv } from "./server-fns";
import type { BulkExportInput } from "./types";

export function ResourceExportButton({
  selection,
  disabled = false,
}: {
  selection: BulkExportInput["selection"];
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function download() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await exportResourceSelectionCsv({ data: { selection } });
      const url = URL.createObjectURL(new Blob([result.csv], { type: "text/csv;charset=utf-8" }));
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = `${selection.resource}-authorized-${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 0);
      }
      setMessage(
        `Exported ${result.exportedCount} authorized rows` +
          (result.selectedCount > result.exportedCount
            ? `; ${result.selectedCount - result.exportedCount} unavailable or outside your scope.`
            : "."),
      );
    } catch {
      setMessage("Export unavailable. Refresh the selection and try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        onClick={() => void download()}
        disabled={disabled || busy}
        className="rounded-md border border-border px-2.5 py-1.5 text-xs disabled:opacity-50"
      >
        {busy ? "Exporting…" : "Export authorized CSV"}
      </button>
      {message ? (
        <p role="status" className="w-full text-xs text-muted-foreground">
          {message}
        </p>
      ) : null}
    </>
  );
}
