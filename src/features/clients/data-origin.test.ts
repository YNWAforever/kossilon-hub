import { describe, expect, it } from "vitest";
import { dataOriginLabel, originFilterForActor } from "./data-origin";

describe("explicit data origin diagnostics", () => {
  it("defaults to production scope and only active Admin can include fixtures", () => {
    expect(originFilterForActor({ role: "Staff", active: true }, false)).toEqual({
      includeFixtures: false,
    });
    expect(originFilterForActor({ role: "Admin", active: true }, true)).toEqual({
      includeFixtures: true,
    });
    expect(() => originFilterForActor({ role: "Manager", active: true }, true)).toThrow("Admin");
    expect(() => originFilterForActor({ role: "Admin", active: false }, true)).toThrow("inactive");
  });
  it("labels unknown as pending review; a company name or UUID is not input to classification", () => {
    expect(dataOriginLabel("client")).toBe("客戶資料");
    expect(dataOriginLabel("fixture")).toBe("測試資料");
    expect(dataOriginLabel("historical")).toBe("歷史資料（不外發）");
    expect(dataOriginLabel(undefined)).toBe("來源待核對");
  });
});
