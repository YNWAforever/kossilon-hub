type BulkSelectionToolbarProps = {
  selectedCount: number;
  visibleCount: number;
  notice: string | null;
  isBusy?: boolean;
  onSelectVisible: () => void;
  onClear: () => void;
  onPreview: () => void;
};

/** Selection only. The caller must use a server preview before any batch commit. */
export function BulkSelectionToolbar({
  selectedCount,
  visibleCount,
  notice,
  isBusy = false,
  onSelectVisible,
  onClear,
  onPreview,
}: BulkSelectionToolbarProps) {
  return (
    <div
      aria-label="Bulk selection"
      className="sticky bottom-3 z-20 mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background p-3 shadow-lg"
    >
      <span className="text-sm font-medium">{selectedCount} selected</span>
      <button
        type="button"
        onClick={onSelectVisible}
        disabled={isBusy || visibleCount === 0}
        className="rounded-md border border-border px-2.5 py-1.5 text-xs disabled:opacity-50"
      >
        Select current view ({visibleCount})
      </button>
      <button
        type="button"
        onClick={onClear}
        disabled={isBusy || selectedCount === 0}
        className="rounded-md border border-border px-2.5 py-1.5 text-xs disabled:opacity-50"
      >
        Clear
      </button>
      <button
        type="button"
        onClick={onPreview}
        disabled={isBusy || selectedCount === 0}
        className="rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
      >
        Preview assignment
      </button>
      {notice ? (
        <p role="status" className="w-full text-xs text-muted-foreground">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
