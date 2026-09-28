import type { NarRowDisposition } from "../mapping";
import type { ImportPreviewRow } from "../preview";

export const IMPORT_PREVIEW_PAGE_SIZE = 50;

export function ImportPreviewPage({
  rows,
  page,
  labels,
}: {
  rows: readonly ImportPreviewRow[];
  page: number;
  labels: Record<NarRowDisposition, string>;
}) {
  const visible = rows.slice(
    page * IMPORT_PREVIEW_PAGE_SIZE,
    (page + 1) * IMPORT_PREVIEW_PAGE_SIZE,
  );
  return (
    <div className="mt-3 max-h-80 space-y-3 overflow-auto text-xs">
      {visible.map((row) => (
        <div key={row.rowId} data-import-preview-row className="rounded-md border bg-card p-2">
          <p className="font-medium">{`第 ${row.rowNumber} 行 · ${row.externalClientId} · ${labels[row.disposition]}`}</p>
          {row.fields.map((field) => (
            <p key={field.field} className="mt-1 break-words">
              {`${field.field}: ${field.before ?? "空"} → ${field.after ?? "空"} · ${field.policy} · ${field.source}`}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}
