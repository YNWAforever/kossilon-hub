import { z } from "zod";
import { dailyWorkInputSchema, type DailyWorkInput } from "./types";
import { WORK_VIEWS } from "@/features/annual-return/work-views";
export type DailyWorkSearch = z.output<typeof dailyWorkInputSchema> & { anchor?: string };
export function dailyWorkSearch(raw: Record<string, unknown>): DailyWorkSearch {
  const legacy = WORK_VIEWS.some((v) => v.key === raw.view);
  const view = legacy ? raw.view : "all",
    sourceType = ["annual_return", "incorporation", "corporate_change_request", "all"].includes(
      String(raw.sourceType),
    )
      ? raw.sourceType
      : legacy
        ? "annual_return"
        : "all";
  const value = dailyWorkInputSchema.parse({
    q: typeof raw.q === "string" ? raw.q.slice(0, 200) : "",
    scope: raw.scope === "team" ? "team" : "mine",
    sourceType,
    view: sourceType === "annual_return" ? view : "all",
    sort: raw.sort === "company" ? "company" : "deadline",
    ...(typeof raw.cursor === "string" && raw.cursor.length <= 8192 ? { cursor: raw.cursor } : {}),
    ...(z.string().uuid().safeParse(raw.companyId).success ? { companyId: raw.companyId } : {}),
  });
  return {
    ...value,
    ...(typeof raw.anchor === "string" &&
    /^(?:(annual_return|incorporation|corporate_change_request):)?[0-9a-f-]{36}$/i.test(raw.anchor)
      ? { anchor: raw.anchor }
      : {}),
  };
}
export function dailyWorkReturnPath(search: DailyWorkSearch, anchor?: string) {
  const { limit: _limit, history: _history, ...rest } = search;
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...rest, anchor: anchor ?? rest.anchor }))
    if (v !== undefined && v !== "") query.set(k, String(v));
  return "/today?" + query.toString();
}
export function dailyInput(search: DailyWorkSearch): DailyWorkInput {
  const { anchor: _anchor, ...input } = search;
  return { ...input, limit: 50 };
}
