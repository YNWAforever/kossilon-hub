import { describe, expect, it } from "vitest";
import {
  addPageToSelection,
  changeSelectionFilter,
  newBulkSelection,
  retryFailedSelection,
} from "./selection";

describe("T22 bulk assignment selection", () => {
  it("t22_scenario_1 keeps 401 distinct cross-page IDs, clears on filter change, and retries failed items only", () => {
    const ids = Array.from(
      { length: 401 },
      (_, index) => `30000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}`,
    );
    let selection = newBulkSelection("team=open");
    selection = addPageToSelection(selection, ids.slice(0, 201));
    selection = addPageToSelection(selection, [ids[200]!, ...ids.slice(201)]);
    expect(selection.ids).toHaveLength(401);
    expect(new Set(selection.ids).size).toBe(401);
    selection = changeSelectionFilter(selection, "team=blocked");
    expect(selection.ids).toEqual([]);
    expect(selection.notice).toMatch(/cleared/i);
    selection = retryFailedSelection("team=blocked", [
      { resourceId: ids[0]!, state: "succeeded" },
      { resourceId: ids[1]!, state: "failed" },
      { resourceId: ids[2]!, state: "forbidden" },
      { resourceId: ids[1]!, state: "failed" },
    ]);
    expect(selection.ids).toEqual([ids[1]]);
  });
});
