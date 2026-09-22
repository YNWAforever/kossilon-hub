import { describe, expect, it } from "vitest";

import { hongKongBusinessDate, toHongKongBusinessDate } from "@/lib/hong-kong-time";

describe("toHongKongBusinessDate", () => {
  // The contract the reminder sweeps depend on: whatever the cron tick hands
  // down -- a full instant or an already-resolved business date -- both spellings
  // of the same Hong Kong day must produce the same sweep.
  it("resolves a full ISO instant to the Hong Kong calendar day it falls in", () => {
    expect(toHongKongBusinessDate("2026-07-05T17:00:00.000Z")).toBe("2026-07-06");
    expect(toHongKongBusinessDate("2026-07-05T17:00:00.000Z")).toBe(
      toHongKongBusinessDate("2026-07-06"),
    );
  });

  it("leaves a date-only string alone", () => {
    // Not a no-op by accident: a bare YYYY-MM-DD is already the firm's day, and
    // re-projecting it through a timezone is what would corrupt it.
    expect(toHongKongBusinessDate("2026-07-06")).toBe("2026-07-06");
    expect(toHongKongBusinessDate("2026-01-01")).toBe("2026-01-01");
  });

  it("accepts a Date and agrees with hongKongBusinessDate", () => {
    const instant = new Date("2026-07-05T16:30:00.000Z");
    expect(toHongKongBusinessDate(instant)).toBe(hongKongBusinessDate(instant));
    expect(toHongKongBusinessDate(instant)).toBe("2026-07-06");
  });

  it("does not roll the day over before Hong Kong midnight", () => {
    expect(toHongKongBusinessDate("2026-07-05T15:59:00.000Z")).toBe("2026-07-05");
  });

  it("resolves an instant carrying an explicit non-UTC offset", () => {
    // The tick is UTC today, but nothing stops a caller (a runbook step, a
    // future scheduler) handing down an offset-bearing instant. It is the
    // instant that decides the Hong Kong day, not the spelling of the offset.
    expect(toHongKongBusinessDate("2026-07-05T20:00:00-08:00")).toBe("2026-07-06");
    expect(toHongKongBusinessDate("2026-07-06T01:00:00+08:00")).toBe("2026-07-06");
    expect(toHongKongBusinessDate("2026-07-05T09:00:00+02:00")).toBe("2026-07-05");
  });

  it("rejects a value it cannot resolve rather than inventing a day", () => {
    expect(() => toHongKongBusinessDate("not-a-date")).toThrow(/business date/i);
  });

  it("rejects a date-shaped string that is not a calendar day", () => {
    // The shape check is not a validity check: "2026-13-45" is ten characters
    // in the right pattern and used to pass straight through, becoming a sweep
    // window and a rendered due date for a day that does not exist. A value
    // this function cannot vouch for has to stop here, not downstream.
    expect(() => toHongKongBusinessDate("2026-13-45")).toThrow(/business date/i);
    expect(() => toHongKongBusinessDate("2026-02-30")).toThrow(/business date/i);
    expect(() => toHongKongBusinessDate("2026-00-10")).toThrow(/business date/i);
    // The leap day itself is a real day and must survive the check.
    expect(toHongKongBusinessDate("2028-02-29")).toBe("2028-02-29");
  });
});
