import { describe, expect, it } from "vitest";
import { daysBetween, oneYearLater } from "./date-math";

describe("oneYearLater", () => {
  it("advances the year, keeping month and day", () => {
    expect(oneYearLater("2026-03-15")).toBe("2027-03-15");
  });

  it("handles a leap-year Feb 29 by rolling to Mar 1 the following (non-leap) year", () => {
    expect(oneYearLater("2028-02-29")).toBe("2029-03-01");
  });
});

describe("daysBetween", () => {
  it("returns a positive count when the end date is in the future", () => {
    expect(daysBetween("2026-08-01", "2026-08-11")).toBe(10);
  });

  it("returns a negative count when the end date is in the past", () => {
    expect(daysBetween("2026-08-11", "2026-08-01")).toBe(-10);
  });

  it("returns zero for the same date", () => {
    expect(daysBetween("2026-08-01", "2026-08-01")).toBe(0);
  });
});
