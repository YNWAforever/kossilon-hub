import { describe, expect, it } from "vitest";
import { addCalendarMonths, daysBetween, oneYearLater } from "./date-math";

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

describe("addCalendarMonths", () => {
  it("keeps the day of the month when it exists in the target month", () => {
    expect(addCalendarMonths("2026-03-15", 3)).toBe("2026-06-15");
    expect(addCalendarMonths("2026-05-15", -3)).toBe("2026-02-15");
  });

  /**
   * The decision this function exists to make.
   *
   * oneYearLater builds its result straight from Date.UTC and so rolls forward:
   * three months before 31 May would become 3 March, silently shortening the
   * window by three days at month ends. Clamping to 28 February is how the
   * phrase reads to a person.
   */
  it("clamps to the end of the target month rather than rolling forward", () => {
    expect(addCalendarMonths("2026-05-31", -3)).toBe("2026-02-28");
    expect(addCalendarMonths("2026-03-31", -1)).toBe("2026-02-28");
    expect(addCalendarMonths("2026-01-31", 1)).toBe("2026-02-28");
  });

  it("clamps to 29 February in a leap year", () => {
    expect(addCalendarMonths("2028-05-31", -3)).toBe("2028-02-29");
  });

  // Deliberately different from oneYearLater, which is pinned to roll forward
  // for the statutory anniversary and is not changed here.
  it("does not share oneYearLater's overflow behaviour", () => {
    expect(oneYearLater("2028-02-29")).toBe("2029-03-01");
    expect(addCalendarMonths("2028-02-29", 12)).toBe("2029-02-28");
  });

  it("crosses year boundaries in both directions", () => {
    expect(addCalendarMonths("2026-01-15", -3)).toBe("2025-10-15");
    expect(addCalendarMonths("2026-11-15", 3)).toBe("2027-02-15");
    expect(addCalendarMonths("2026-06-15", -18)).toBe("2024-12-15");
  });

  it("returns the same date for a zero offset", () => {
    expect(addCalendarMonths("2026-02-29".replace("29", "28"), 0)).toBe("2026-02-28");
  });
});
