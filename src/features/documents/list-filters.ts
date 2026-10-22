import { z } from "zod";
import { DOCUMENT_CATEGORIES } from "./types";

/** Shared by the register and bulk count/snapshot queries. All are optional. */
export const documentSearchFields = {
  q: z.string().trim().max(200).optional(),
  category: z.enum(DOCUMENT_CATEGORIES).optional(),
  source: z.enum(["staff", "client", "system"]).optional(),
  reviewStatus: z.enum(["pending", "verified", "rejected"]).optional(),
};
export type DocumentSearchFilters = {
  q?: string;
  category?: string;
  source?: string;
  reviewStatus?: "pending" | "verified" | "rejected";
};

/** Requires documents d and companies c aliases. Run before LIMIT/cursor paging.
 * Review is effective only when it names the latest unsuperseded version, just
 * like mapDocumentSummary. A historic verified label is pending on a new version.
 */
const fragmentMarker = Symbol("document-query-fragment");
type DocumentQuery = { strings: TemplateStringsArray; values: unknown[] };
type DocumentFragment = DocumentQuery & { [fragmentMarker]: true };

/** Compose parameters before invoking an executor. A fragment is inert data,
 * never a driver thenable that an async executor/transaction proxy could run.
 */
export function bindDocumentQuery(
  strings: TemplateStringsArray,
  ...args: unknown[]
): DocumentQuery {
  const parts = [strings[0]];
  const values: unknown[] = [];
  args.forEach((arg, index) => {
    if (arg && typeof arg === "object" && fragmentMarker in arg) {
      const fragment = arg as DocumentFragment;
      parts[parts.length - 1] += fragment.strings[0];
      fragment.values.forEach((value, partIndex) => {
        values.push(value);
        parts.push(fragment.strings[partIndex + 1]);
      });
    } else {
      values.push(arg);
      parts.push("");
    }
    parts[parts.length - 1] += strings[index + 1];
  });
  return { strings: Object.assign(parts, { raw: [...parts] }), values };
}
function documentFragment(strings: TemplateStringsArray, ...values: unknown[]): DocumentFragment {
  return { strings, values, [fragmentMarker]: true };
}

export function documentSearchPredicate(filters: DocumentSearchFilters) {
  const q = filters.q?.trim()
    ? `%${filters.q.trim().replace(/[\\%_]/g, (value) => "\\" + value)}%`
    : null;
  return documentFragment`
    (${q}::text is null or d.file_name ilike ${q} escape '\\' or c.company_name ilike ${q} escape '\\')
    and (${filters.category ?? null}::text is null or d.file_type=${filters.category ?? null})
    and (${filters.source ?? null}::text is null or d.upload_source=${filters.source ?? null})
    and (${filters.reviewStatus ?? null}::text is null or
      (case when d.reviewed_document_version_id=(select v.id from document_versions v
        where v.document_id=d.id and v.superseded_by_version_id is null
        order by v.version_number desc limit 1)
        then d.verification_status else 'pending' end)=${filters.reviewStatus ?? null})`;
}
