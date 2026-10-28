import { WORK_VIEWS, type WorkViewKey } from "./work-views";
import { getSafeRedirectPath } from "@/features/auth/route-guard";
import { defaultStringifySearch } from "@tanstack/react-router";
import { parseEntityId } from "@/lib/entity-id";
export type DailyViewSearch = {
  view: WorkViewKey;
  q: string;
  sort: "deadline" | "company";
  cursor?: string;
  otherCursor?: string;
};
export function dailyViewSearch(input: Record<string, unknown>): DailyViewSearch {
  return {
    view: WORK_VIEWS.some((x) => x.key === input.view) ? (input.view as WorkViewKey) : "chaseToday",
    q: typeof input.q === "string" ? input.q.slice(0, 200) : "",
    sort: input.sort === "company" ? "company" : "deadline",
    ...(typeof input.cursor === "string" && input.cursor.length <= 2048
      ? { cursor: input.cursor }
      : {}),
    ...(typeof input.otherCursor === "string" && input.otherCursor.length <= 4096
      ? { otherCursor: input.otherCursor }
      : {}),
  };
}
export function dailyReturnPath(search: DailyViewSearch) {
  return "/today" + defaultStringifySearch(dailyViewSearch(search));
}
export function caseReturnPath(input: unknown): string {
  if (typeof input !== "string" || getSafeRedirectPath(input) !== input) return "/annual-returns";
  const pathname = input.split(/[?#]/, 1)[0];
  const clientId = pathname.startsWith("/clients/") ? pathname.slice("/clients/".length) : null;
  if (parseEntityId(clientId) !== null) return input;
  return [
    "/today",
    "/annual-returns",
    "/work-queue",
    "/clients",
    "/incorporation",
    "/corporate-changes",
  ].includes(pathname)
    ? input
    : "/annual-returns";
}
