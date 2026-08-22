import { describe, expect, it } from "vitest";
import { INCORPORATION_STATUSES, type IncorporationStatus } from "./types";
import { isAllowedIntakeStatusTransition, oneYearLater } from "./workflow";

describe("isAllowedIntakeStatusTransition", () => {
  it("allows moving forward exactly one step", () => {
    expect(isAllowedIntakeStatusTransition("Intake", "Documents pending")).toBe(true);
    expect(isAllowedIntakeStatusTransition("Documents pending", "Ready to file")).toBe(true);
    expect(isAllowedIntakeStatusTransition("Ready to file", "Filed with Registrar")).toBe(true);
    expect(isAllowedIntakeStatusTransition("Filed with Registrar", "Completed")).toBe(true);
  });

  it("rejects skipping a step", () => {
    expect(isAllowedIntakeStatusTransition("Intake", "Ready to file")).toBe(false);
  });

  it("rejects moving backward", () => {
    expect(isAllowedIntakeStatusTransition("Ready to file", "Intake")).toBe(false);
  });

  it("rejects a no-op transition", () => {
    expect(isAllowedIntakeStatusTransition("Intake", "Intake")).toBe(false);
  });

  // indexOf returns -1 outside the enum, which made `toIndex === fromIndex + 1`
  // true for an unknown `from` and the first status — so a case whose status had
  // drifted from the enum could be walked back to the start of the workflow.
  it("refuses a transition out of a status that is not in the workflow", () => {
    expect(
      isAllowedIntakeStatusTransition("Archived" as IncorporationStatus, INCORPORATION_STATUSES[0]),
    ).toBe(false);
  });
});

describe("oneYearLater", () => {
  it("advances the year, keeping month and day", () => {
    expect(oneYearLater("2026-03-15")).toBe("2027-03-15");
  });

  it("handles a leap-year Feb 29 by rolling to Mar 1 the following (non-leap) year", () => {
    // 2028 is a leap year; 2029 is not, so Feb 29 2028 -> Mar 1 2029 is the
    // correct, unambiguous JS Date rollover behavior (setUTCFullYear onto a
    // date that doesn't exist in the target year rolls forward).
    expect(oneYearLater("2028-02-29")).toBe("2029-03-01");
  });
});
