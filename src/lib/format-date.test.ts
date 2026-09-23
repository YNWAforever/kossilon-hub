import { afterEach, describe, expect, it } from "vitest";

import { formatDate } from "@/lib/format-date";

const originalTimeZone = process.env.TZ;

afterEach(() => {
  process.env.TZ = originalTimeZone;
});

describe("formatDate", () => {
  it("renders a date-only string as that date", () => {
    expect(formatDate("2026-07-05")).toBe("05 Jul 2026");
    expect(formatDate("2026-01-01")).toBe("01 Jan 2026");
    expect(formatDate("2026-12-31")).toBe("31 Dec 2026");
  });

  it("renders a date-only string as that date in a negative-offset timezone", () => {
    // A filing due date is a calendar fact, not an instant. Parsing it through
    // `new Date` makes it UTC midnight, which in any negative-offset zone is
    // still the previous day -- so a viewer outside Hong Kong was shown a due
    // date one day earlier than the one the firm filed against.
    process.env.TZ = "America/Los_Angeles";
    expect(formatDate("2026-07-05")).toBe("05 Jul 2026");

    process.env.TZ = "Pacific/Honolulu";
    expect(formatDate("2026-01-01")).toBe("01 Jan 2026");
  });

  it("renders a full instant as its Hong Kong calendar day", () => {
    // 17:00Z is already tomorrow in Hong Kong, and the firm's screens speak the
    // firm's day wherever the viewer happens to be sitting.
    process.env.TZ = "America/Los_Angeles";
    expect(formatDate("2026-07-05T17:00:00.000Z")).toBe("06 Jul 2026");
    expect(formatDate("2026-07-05T15:59:00.000Z")).toBe("05 Jul 2026");
  });
});
