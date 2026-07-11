import { describe, expect, it } from "vitest";
import { addBusinessMinutes } from "./business-calendar";
import type { BusinessCalendar } from "./types";

const workingDay = [
  { start: "09:00", end: "12:00" },
  { start: "13:00", end: "18:00" },
];

const hkCalendar: BusinessCalendar = {
  id: "hk-v1",
  timezone: "Asia/Hong_Kong",
  weeklySchedule: {
    monday: workingDay,
    tuesday: workingDay,
    wednesday: workingDay,
    thursday: workingDay,
    friday: workingDay,
    saturday: [],
    sunday: [],
  },
  holidays: [],
};

describe("business calendar arithmetic", () => {
  it("adds minutes inside configured business intervals", () => {
    expect(addBusinessMinutes("2026-07-10T08:00:00.000Z", 120, hkCalendar)).toBe(
      "2026-07-10T10:00:00.000Z",
    );
  });

  it("skips a closed lunch interval", () => {
    expect(addBusinessMinutes("2026-07-10T03:30:00.000Z", 120, hkCalendar)).toBe(
      "2026-07-10T06:30:00.000Z",
    );
  });

  it("carries work across weekends", () => {
    expect(addBusinessMinutes("2026-07-10T09:00:00.000Z", 120, hkCalendar)).toBe(
      "2026-07-13T02:00:00.000Z",
    );
  });
  it("carries partial closing minutes without extending past business hours", () => {
    expect(addBusinessMinutes("2026-07-10T09:59:59.000Z", 1, hkCalendar)).toBe(
      "2026-07-13T01:00:59.000Z",
    );
  });


  it("skips closed holidays and honors exceptional working intervals", () => {
    const calendar: BusinessCalendar = {
      ...hkCalendar,
      holidays: [
        { date: "2026-07-13", closed: true },
        {
          date: "2026-07-14",
          closed: false,
          workingIntervals: [{ start: "10:00", end: "12:00" }],
        },
      ],
    };

    expect(addBusinessMinutes("2026-07-10T10:00:00.000Z", 120, calendar)).toBe(
      "2026-07-14T04:00:00.000Z",
    );
  });

  it("rejects invalid inputs instead of reading the current clock", () => {
    expect(() => addBusinessMinutes("invalid", 10, hkCalendar)).toThrow(/timestamp/i);
    expect(() => addBusinessMinutes("2026-07-10T08:00:00.000Z", -1, hkCalendar)).toThrow(
      /minutes/i,
    );
  });
});
