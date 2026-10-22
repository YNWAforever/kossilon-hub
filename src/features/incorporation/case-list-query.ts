import { z } from "zod";
import type { AuthenticatedActor } from "@/features/auth/types";

export const caseListQuerySchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    status: z.string().max(80).optional(),
    ownerId: z.string().uuid().optional(),
    teamId: z.string().uuid().optional(),
    dueFrom: z.string().date().optional(),
    dueTo: z.string().date().optional(),
    sort: z.enum(["created", "company", "due"]).optional(),
    limit: z.number().int().min(1).max(100).optional(),
    cursor: z.string().max(8192).optional(),
    changeType: z.string().max(80).optional(),
  })
  .strict()
  .refine((q) => !q.dueFrom || !q.dueTo || q.dueFrom <= q.dueTo, "Invalid date range.");
export type CaseListQuery = z.infer<typeof caseListQuerySchema>;
export type CaseListPage<T> = { items: T[]; nextCursor: string | null };
const cursorSchema = z
  .object({
    v: z.literal(1),
    scope: z.string().max(4096),
    value: z.string().max(1000),
    id: z.string().uuid(),
  })
  .strict();
export type PreparedCaseListQuery = ReturnType<typeof prepareCaseListQuery>;

export function prepareCaseListQuery(
  actor: AuthenticatedActor,
  domain: string,
  input: CaseListQuery,
) {
  const query = caseListQuerySchema.parse(input);
  const sort = query.sort ?? "created";
  const limit = query.limit ?? 25;
  const scope = JSON.stringify([
    domain,
    actor.authUserId,
    actor.userId,
    actor.role,
    actor.teamId,
    query.q ?? "",
    query.status ?? null,
    query.ownerId ?? null,
    query.teamId ?? null,
    query.dueFrom ?? null,
    query.dueTo ?? null,
    sort,
    limit,
    query.changeType ?? null,
  ]);
  let cursor: z.infer<typeof cursorSchema> | null = null;
  if (query.cursor) {
    try {
      cursor = cursorSchema.parse(JSON.parse(query.cursor));
      if (cursor.scope !== scope) throw new Error();
    } catch {
      throw new Error("Invalid or changed case cursor; refresh this list.");
    }
  }
  return { ...query, sort, limit, scope, cursor };
}

export function finishCaseListPage<R extends { id: string; sort_value: string }, T>(
  rows: R[],
  query: PreparedCaseListQuery,
  map: (row: R) => T,
): CaseListPage<T> {
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: page.map(map),
    nextCursor:
      rows.length > query.limit && last
        ? JSON.stringify({ v: 1, scope: query.scope, value: last.sort_value, id: last.id })
        : null,
  };
}

export function caseListSearchPattern(q?: string) {
  return q ? `%${q.replace(/[\\%_]/g, (s) => `\\${s}`)}%` : null;
}

export function caseListPath(path: "/incorporation" | "/corporate-changes", query: CaseListQuery) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined && value !== "") params.set(key, String(value));
  return path + (params.size ? `?${params.toString()}` : "");
}
export function readCaseListSearch(search: string): CaseListQuery {
  const params = new URLSearchParams(search);
  const raw: Record<string, unknown> = {};
  for (const key of [
    "q",
    "status",
    "ownerId",
    "teamId",
    "dueFrom",
    "dueTo",
    "sort",
    "cursor",
    "changeType",
  ]) {
    if (params.has(key)) raw[key] = params.getAll(key).length === 1 ? params.get(key) : [];
  }
  if (params.has("limit"))
    raw.limit = params.getAll("limit").length === 1 ? Number(params.get("limit")) : [];
  // Invalid URL input stays visibly recoverable rather than broadening a query.
  const parsed = caseListQuerySchema.safeParse(raw);
  return parsed.success ? parsed.data : { cursor: "invalid" };
}
