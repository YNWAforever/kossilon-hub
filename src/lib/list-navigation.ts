import { z } from "zod";
import { getSafeRedirectPath } from "@/features/auth/route-guard";
import { INCORPORATION_STATUSES } from "@/features/incorporation/types";
import { CORPORATE_CHANGE_STATUSES } from "@/features/corporate-changes/types";
const id = z.string().uuid();
const q = z
  .string()
  .max(200)
  .refine((v) => !Array.from(v).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127));
const cursor = z.string().max(8192);
const business = {
  q,
  owner: z.union([z.enum(["all", "unassigned"]), id]),
  view: z.enum(["all", "mine", "overdue", "unassigned"]),
  history: z.enum(["true", "false"]),
  due: z.enum(["all", "overdue", "next30", "none"]),
  sort: z.enum(["deadline", "recent", "company"]),
  cursor,
  anchor: id,
  companyId: id,
};
const queue = {
  view: z.enum(["mine", "team", "breached"]),
  q,
  sort: z.enum(["sla", "recent"]),
  owner: z.union([z.enum(["all", "unassigned"]), id]),
  workType: z.string().max(100),
  sla: z.enum(["all", "none", "warning", "breach", "acknowledged"]),
  priority: z.enum(["all", "high", "normal"]),
  status: z.enum(["all", "open", "in_progress", "blocked"]),
  cursor,
  anchor: id,
};
const contracts: Record<string, Record<string, z.ZodTypeAny>> = {
  "/incorporation": { ...business, status: z.enum(["open", "all", ...INCORPORATION_STATUSES]) },
  "/corporate-changes": {
    ...business,
    status: z.enum(["open", "all", ...CORPORATE_CHANGE_STATUSES]),
  },
  "/work-queue": queue,
  "/clients": {
    q,
    status: z.enum(["all", "active", "inactive"]),
    team: z.union([z.literal("all"), id]),
    cursor,
    anchor: id,
  },
  "/today": {
    q,
    view: z.enum([
      "chaseToday",
      "newlyReceived",
      "awaitingMyReview",
      "readyToFile",
      "returnsAndExceptions",
    ]),
    sort: z.enum(["deadline", "company"]),
    cursor,
    anchor: id,
  },
  "/annual-returns": { q, cursor, anchor: id },
};
/** Same-origin allowlist plus validated search. Server reads still resolve the fresh actor. */
export function safeListReturnTo(input: unknown): string {
  if (typeof input !== "string" || getSafeRedirectPath(input) !== input) return "/today";
  try {
    const url = new URL(input, "https://kossilon.invalid");
    const schema = contracts[url.pathname];
    if (url.origin !== "https://kossilon.invalid" || !schema || url.hash) return "/today";
    for (const [key, value] of url.searchParams) {
      if (
        !schema[key] ||
        url.searchParams.getAll(key).length !== 1 ||
        !schema[key].safeParse(value).success
      )
        return "/today";
    }
    return url.pathname + url.search;
  } catch {
    return "/today";
  }
}
export function queueSearch(input: Record<string, unknown>) {
  const read = (key: string, fallback: string) =>
    queue[key as keyof typeof queue].safeParse(input[key]).success
      ? (input[key] as string)
      : fallback;
  return {
    view: read("view", "mine") as "mine" | "team" | "breached",
    q: read("q", ""),
    sort: read("sort", "sla") as "sla" | "recent",
    owner: read("owner", "all"),
    workType: read("workType", "all"),
    sla: read("sla", "all") as "all" | "none" | "warning" | "breach" | "acknowledged",
    priority: read("priority", "all") as "all" | "high" | "normal",
    status: read("status", "all") as "all" | "open" | "in_progress" | "blocked",
    ...(read("cursor", "") ? { cursor: read("cursor", "") } : {}),
    ...(read("anchor", "") ? { anchor: read("anchor", "") } : {}),
  };
}
export function clientListSearch(input: Record<string, unknown>) {
  const schema = contracts["/clients"];
  return {
    q: schema.q.safeParse(input.q).success ? (input.q as string) : "",
    status: schema.status.safeParse(input.status).success
      ? (input.status as "all" | "active" | "inactive")
      : ("all" as const),
    team: schema.team.safeParse(input.team).success ? (input.team as string) : "all",
    ...(schema.cursor.safeParse(input.cursor).success ? { cursor: input.cursor as string } : {}),
    ...(schema.anchor.safeParse(input.anchor).success ? { anchor: input.anchor as string } : {}),
  };
}
export type ClientListSearch = ReturnType<typeof clientListSearch>;
