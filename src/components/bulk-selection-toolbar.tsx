import { ResourceExportButton } from "@/features/bulk-operations/resource-export-button";
import type { BulkExportInput } from "@/features/bulk-operations/types";

type BulkSelectionToolbarProps = {
  selectedCount: number;
  visibleCount: number;
  notice: string | null;
  isBusy?: boolean;
  onSelectVisible: () => void;
  onSelectMatching?: () => void;
  selectionLabel?: string;
  previewEnabled?: boolean;
  onClear: () => void;
  onPreview: () => void;
  onTag?: () => void;
  tagEnabled?: boolean;
  exportSelection?: BulkExportInput["selection"];
  exportEnabled?: boolean;
};

/** Selection only. The caller must use a server preview before any batch commit. */
export function BulkSelectionToolbar({
  selectedCount,
  visibleCount,
  notice,
  isBusy = false,
  onSelectVisible,
  onSelectMatching,
  selectionLabel,
  previewEnabled,
  onClear,
  onPreview,
  onTag,
  tagEnabled,
  exportSelection,
  exportEnabled,
}: BulkSelectionToolbarProps) {
  return (
    <div
      aria-label="Bulk selection"
      className="sticky bottom-3 z-20 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background p-3 shadow-lg"
    >
      <span className="text-sm font-medium">{selectionLabel ?? `${selectedCount} selected`}</span>
      <button
        type="button"
        onClick={onSelectVisible}
        disabled={isBusy || visibleCount === 0}
        className="rounded-md border border-border px-2.5 py-1.5 text-xs disabled:opacity-50"
      >
        Select current view ({visibleCount})
      </button>
      {onSelectMatching ? (
        <button
          type="button"
          onClick={onSelectMatching}
          disabled={isBusy}
          className="rounded-md border border-border px-2.5 py-1.5 text-xs disabled:opacity-50"
        >
          Select all matching filter (max 1000)
        </button>
      ) : null}
      <button
        type="button"
        onClick={onClear}
        disabled={isBusy || (selectedCount === 0 && !selectionLabel)}
        className="rounded-md border border-border px-2.5 py-1.5 text-xs disabled:opacity-50"
      >
        Clear
      </button>
      <button
        type="button"
        onClick={onPreview}
        disabled={isBusy || !(previewEnabled ?? selectedCount > 0)}
        className="rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
      >
        Preview assignment
      </button>
      {onTag ? (
        <button
          type="button"
          onClick={onTag}
          disabled={isBusy || !(tagEnabled ?? previewEnabled ?? selectedCount > 0)}
          className="rounded-md border border-border px-2.5 py-1.5 text-xs disabled:opacity-50"
        >
          Tag selected
        </button>
      ) : null}
      {exportSelection ? (
        <ResourceExportButton
          selection={exportSelection}
          disabled={isBusy || !(exportEnabled ?? previewEnabled ?? selectedCount > 0)}
        />
      ) : null}
      {notice ? (
        <p role="status" className="w-full text-xs text-muted-foreground">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
