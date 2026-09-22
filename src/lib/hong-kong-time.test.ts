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

  it("rejects a value it cannot resolve rather than inventing a day", () => {
    expect(() => toHongKongBusinessDate("not-a-date")).toThrow(/business date/i);
  });
});
