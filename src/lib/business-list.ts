import { z } from "zod";
import { listPageSize, decodeListCursor, literalContains } from "./list-page";
import { assertTeamReadScope, type TeamReadScope } from "@/features/auth/team-read-scope";
export const businessListFields = {
  q: z.string().trim().max(200).default(""),
  history: z.boolean().default(false),
  view: z.enum(["all", "mine", "overdue", "unassigned"]).default("all"),
  owner: z.union([z.enum(["all", "unassigned"]), z.string().uuid()]).default("all"),
  due: z.enum(["all", "overdue", "next30", "none"]).default("all"),
  sort: z.enum(["deadline", "recent", "company"]).default("deadline"),
  companyId: z.string().uuid().optional(),
  cursor: z.string().max(8192).optional(),
  limit: listPageSize,
};
export type ParsedBusinessList = {
  q: string;
  history: boolean;
  view: "all" | "mine" | "overdue" | "unassigned";
  owner: string;
  due: "all" | "overdue" | "next30" | "none";
  sort: "deadline" | "recent" | "company";
  status: string;
  companyId?: string;
  cursor?: string;
  limit: number;
};
export type BusinessListSearch = ParsedBusinessList & { anchor?: string };
export function businessListSearch(
  raw: Record<string, unknown>,
  statusSchema: z.ZodTypeAny,
): BusinessListSearch {
  const fields = { ...businessListFields, status: statusSchema },
    values: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(fields)) {
    const candidate = key === "history" ? raw[key] === true || raw[key] === "true" : raw[key];
    const parsed = field.safeParse(candidate);
    if (parsed.success) values[key] = parsed.data;
  }
  const parsed = z.object(fields).parse(values) as ParsedBusinessList;
  return {
    ...parsed,
    ...(z.string().uuid().safeParse(raw.anchor).success ? { anchor: raw.anchor as string } : {}),
  };
}
export function businessReturnPath(
  path: "/incorporation" | "/corporate-changes",
  search: BusinessListSearch,
  anchor?: string,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...search, anchor: anchor ?? search.anchor })) {
    if (key !== "limit" && value !== undefined && value !== "" && value !== false)
      query.set(key, String(value));
  }
  return path + "?" + query.toString();
}
export function businessListContext(
  kind: string,
  scope: TeamReadScope,
  input: ParsedBusinessList,
  viewerUserId?: string,
) {
  const authorized = assertTeamReadScope(scope);
  if (input.view === "mine" && !z.string().uuid().safeParse(viewerUserId).success)
    throw Error("Forbidden: verified viewer required for My work.");
  const owner =
    input.view === "mine"
      ? viewerUserId!
      : input.view === "unassigned"
        ? "unassigned"
        : input.owner;
  const { cursor, ...filters } = input;
  const key = JSON.stringify([kind, authorized, viewerUserId ?? null, { ...filters, owner }]),
    values = decodeListCursor(cursor, key, 2);
  if (
    values &&
    (!z.string().uuid().safeParse(values[1]).success ||
      (input.sort === "deadline" && !/^\d{4}-\d{2}-\d{2}$/.test(values[0])) ||
      (input.sort === "recent" && !/^-?\d+(\.\d{1,6})?$/.test(values[0])))
  )
    throw Error("Invalid list cursor; return to the first page.");
  return {
    scope: authorized,
    owner,
    key,
    values,
    q: literalContains(input.q),
    due: input.view === "overdue" ? "overdue" : input.due,
  };
}
