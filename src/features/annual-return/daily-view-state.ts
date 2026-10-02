import { WORK_VIEWS, type WorkViewKey } from "./work-views";
import { getSafeRedirectPath } from "@/features/auth/route-guard";
export type DailyViewSearch = { view: WorkViewKey; q: string; sort: "deadline" | "company" };
export function dailyViewSearch(input: Record<string, unknown>): DailyViewSearch {
  return {
    view: WORK_VIEWS.some((x) => x.key === input.view) ? (input.view as WorkViewKey) : "chaseToday",
    q: typeof input.q === "string" ? input.q.slice(0, 200) : "",
    sort: input.sort === "company" ? "company" : "deadline",
  };
}
export function dailyReturnPath(search: DailyViewSearch) {
  return "/today?" + new URLSearchParams(search).toString();
}
export function caseReturnPath(input: unknown): string {
  if (typeof input !== "string" || getSafeRedirectPath(input) !== input) return "/annual-returns";
  return ["/today", "/annual-returns"].includes(input.split(/[?#]/, 1)[0])
    ? input
    : "/annual-returns";
}
