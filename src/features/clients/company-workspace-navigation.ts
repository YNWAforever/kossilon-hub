import { z } from "zod";
import { safeListReturnTo } from "@/lib/list-navigation";
import { COMPANY_WORKSPACE_TABS, type CompanyWorkspaceSearch } from "./company-workspace-types";
export function companyWorkspaceSearch(raw: Record<string, unknown>): CompanyWorkspaceSearch {
  return {
    tab: z.enum(COMPANY_WORKSPACE_TABS).safeParse(raw.tab).success
      ? (raw.tab as CompanyWorkspaceSearch["tab"])
      : "overview",
    q: typeof raw.q === "string" ? raw.q.slice(0, 200) : "",
    history: raw.history === true || raw.history === "true",
    kind: ["annual_return", "incorporation", "corporate_change_request"].includes(String(raw.kind))
      ? (raw.kind as CompanyWorkspaceSearch["kind"])
      : "all",
    eventType: typeof raw.eventType === "string" ? raw.eventType.slice(0, 80) : "all",
    ...(typeof raw.cursor === "string" && raw.cursor.length <= 8192 ? { cursor: raw.cursor } : {}),
    ...(raw.returnTo !== undefined ? { returnTo: safeListReturnTo(raw.returnTo) } : {}),
  };
}
export function companyWorkspaceReturnPath(companyId: string, search: CompanyWorkspaceSearch) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(search))
    if (value !== undefined && value !== "") q.set(key, String(value));
  return `/clients/${companyId}?${q}`;
}
