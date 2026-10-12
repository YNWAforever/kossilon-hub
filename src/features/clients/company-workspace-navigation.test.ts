import { it, expect } from "vitest";
import { companyWorkspaceSearch, companyWorkspaceReturnPath } from "./company-workspace-navigation";
import { safeListReturnTo } from "@/lib/list-navigation";
import { dailyWorkSearch, dailyWorkReturnPath } from "@/features/daily-work/view-state";
it("preserves validated company tab/list return state while rejecting external or foreign route shapes", () => {
  const id = "11111111-1111-4111-8111-111111111111",
    path = companyWorkspaceReturnPath(
      id,
      companyWorkspaceSearch({
        tab: "documents",
        q: "同名",
        returnTo: "/clients?q=%E5%90%8C%E5%90%8D",
      }),
    );
  expect(safeListReturnTo(path)).toBe(path);
  expect(safeListReturnTo("/clients/" + id + "?tab=forged")).toBe("/today");
  expect(safeListReturnTo("/clients/" + id + "?returnTo=https://foreign.invalid")).toBe("/today");
  const daily = dailyWorkReturnPath(dailyWorkSearch({ sourceType: "incorporation" }));
  expect(safeListReturnTo(daily)).toBe(daily);
});
