import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { listDocumentPage } from "@/features/documents/server-fns";
import type { DocumentSummary } from "@/features/documents/repository";
import { documentSafetyOf } from "@/features/documents/safety";
import type { DocumentCategory } from "@/features/documents/types";
import { listAssignableStaff } from "../server-fns";

/**
 * The pickers that replace this screen's UUID text boxes.
 *
 * Assigning an owner meant typing a database identifier into a box validated
 * with isUuid; recording payment proof and a filing receipt meant typing two
 * more. A staff member had no way to obtain any of them from the product, so the
 * ordinary path was to copy them out of somewhere else.
 *
 * Both lists are scoped server-side to what the actor may actually use, so the
 * picker never offers an option the mutation would then refuse.
 */

const STAFF_QUERY_KEY = ["annual-return", "assignable-staff"] as const;

export function StaffPicker({
  id,
  label,
  value,
  onChange,
  disabled,
  actorScope = "session",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  actorScope?: string;
}) {
  const [query, setQuery] = useState("");
  const staffQuery = useQuery({
    queryKey: [...STAFF_QUERY_KEY, actorScope, query],
    queryFn: () => listAssignableStaff({ data: { q: query, limit: 200 } }),
    retry: false,
    staleTime: 60_000,
  });

  const options = staffQuery.data ?? [];
  // The current owner may sit outside the actor's scope (an assignment made by
  // an Admin, or a cross-team reviewer). Showing the raw id would be a worse
  // answer than saying so plainly.
  const valueIsKnown = value === "" || options.some((member) => member.id === value);

  return (
    <div>
      <label className="text-sm">
        搜尋{label}
        <input
          className="min-h-11 w-full rounded border px-3"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <p className="text-xs text-muted-foreground">最多顯示200項；搜尋涵蓋全部獲授權同事。</p>
      <label className="text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
        disabled={disabled || staffQuery.isLoading || Boolean(staffQuery.error)}
        value={valueIsKnown ? value : ""}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">
          {staffQuery.isLoading
            ? "載入同事名單…"
            : staffQuery.error
              ? "無法載入同事名單"
              : "選擇負責同事"}
        </option>
        {!valueIsKnown && value ? (
          <option value={value} disabled>
            目前負責人不在此頁搜尋結果
          </option>
        ) : null}
        {options.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name} · {member.role}
            {member.teamName ? ` · ${member.teamName}` : ""}
          </option>
        ))}
      </select>
      {staffQuery.error ? (
        <button type="button" className="min-h-11" onClick={() => void staffQuery.refetch()}>
          重試同事搜尋
        </button>
      ) : null}
    </div>
  );
}

export type DocumentPickerProps = {
  id: string;
  label: string;
  caseId: string;
  /** Narrow to the categories that can legitimately answer this field. */
  categories: readonly DocumentCategory[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  /**
   * When true, only a document a real scanner passed AND a reviewer verified may
   * be selected. Used where the selection is itself an assertion about the file
   * -- a filing receipt, payment proof -- rather than a working reference.
   */
  requireVerified?: boolean;
  actorScope?: string;
  onSelectDocument?: (document: DocumentSummary | undefined) => void;
};

export function DocumentPicker({
  id,
  label,
  caseId,
  categories,
  value,
  onChange,
  disabled,
  requireVerified = true,
  actorScope = "session",
  onSelectDocument,
}: DocumentPickerProps) {
  const [query, setQuery] = useState("");
  const category = categories.length === 1 ? categories[0] : undefined;
  const documentsQuery = useInfiniteQuery({
    queryKey: ["documents", "picker", caseId, actorScope, query, categories],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      listDocumentPage({ data: { caseId, q: query, category, limit: 100, cursor: pageParam } }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    retry: false,
  });

  const all = documentsQuery.data?.pages.flatMap((page) => page.documents) ?? [];
  const candidates = all.filter((document) => {
    if (!categories.includes(document.category)) return false;
    if (!requireVerified) return true;
    // Safety and business review are separate dimensions and both matter here:
    // a file whose only "clean" came from the deterministic test scanner is not
    // evidence, however long ago a reviewer approved it.
    return documentSafetyOf(document) === "verified" && document.reviewStatus === "verified";
  });

  const valueIsKnown = value === "" || candidates.some((document) => document.id === value);

  return (
    <div className="min-w-0">
      <label className="text-sm">
        搜尋{label}文件
        <input
          className="min-h-11 w-full rounded border px-3"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <label className="text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
        disabled={disabled || documentsQuery.isLoading || Boolean(documentsQuery.error)}
        value={valueIsKnown ? value : ""}
        onChange={(event) => {
          onChange(event.target.value);
          onSelectDocument?.(candidates.find((document) => document.id === event.target.value));
        }}
      >
        <option value="">
          {documentsQuery.isLoading
            ? "載入文件…"
            : documentsQuery.error
              ? "無法載入文件"
              : candidates.length === 0 && !documentsQuery.hasNextPage
                ? "此案件沒有合適的已核實文件"
                : "選擇文件或載入更多"}
        </option>
        {!valueIsKnown && value ? (
          <option value={value} disabled>
            已選文件不在此清單內
          </option>
        ) : null}
        {candidates.map((document) => (
          <option key={document.id} value={document.id}>
            {document.fileName} · {formatUploadedAt(document.uploadedAt)}
          </option>
        ))}
      </select>
      {documentsQuery.hasNextPage ? (
        <button
          type="button"
          className="min-h-11 rounded border px-3"
          disabled={documentsQuery.isFetchingNextPage}
          onClick={() => void documentsQuery.fetchNextPage({ cancelRefetch: false })}
        >
          載入更多{label}文件
        </button>
      ) : null}
      {documentsQuery.error ? (
        <div role="alert">
          文件搜尋未完成。
          <button
            type="button"
            className="min-h-11"
            onClick={() =>
              void (documentsQuery.isFetchNextPageError
                ? documentsQuery.fetchNextPage({ cancelRefetch: false })
                : documentsQuery.refetch())
            }
          >
            重試文件搜尋
          </button>
        </div>
      ) : null}
      {/* Naming why the list is short is more useful than an empty dropdown. */}
      {!documentsQuery.isLoading &&
      !documentsQuery.error &&
      !documentsQuery.hasNextPage &&
      candidates.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          需要先上載並完成掃描及覆核，文件才會在此出現。
        </p>
      ) : null}
    </div>
  );
}

function formatUploadedAt(value: string): string {
  return new Date(value).toLocaleDateString("en-HK", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
