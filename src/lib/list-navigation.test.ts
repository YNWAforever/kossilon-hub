import { describe, it, expect } from "vitest";
import { caseReturnPath } from "@/features/annual-return/daily-view-state";
describe("R16 safe list return", () => {
  it("returns to validated Queue query without following encoded or external targets", () => {
    expect(caseReturnPath("/work-queue?view=team&q=%E4%B8%AD%E6%96%87&sort=sla")).toBe(
      "/work-queue?view=team&q=%E4%B8%AD%E6%96%87&sort=sla",
    );
    for (const value of [
      "https://evil.test",
      "//evil.test",
      "/%2f%2fevil.test",
      "/work-queue?returnTo=https://evil.test",
      "/work-queue?view=evil",
      "/admin",
    ])
      expect(caseReturnPath(value)).toBe("/annual-returns");
  });
});
