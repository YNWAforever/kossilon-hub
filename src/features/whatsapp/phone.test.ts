import { describe, expect, it } from "vitest";
import { toPhoneDigits } from "./phone";

describe("toPhoneDigits", () => {
  it("strips the spaces a sweep recipient carries", () => {
    expect(toPhoneDigits("+852 6090 3521")).toBe("85260903521");
  });

  it("leaves WOZTELL's bare-digit inbound format unchanged", () => {
    expect(toPhoneDigits("85260903521")).toBe("85260903521");
  });

  it("strips the plus a staff-entered number carries", () => {
    expect(toPhoneDigits("+85260903521")).toBe("85260903521");
  });

  it("collapses all three real formats to the same value", () => {
    expect(toPhoneDigits("+852 6090 3521")).toBe(toPhoneDigits("85260903521"));
    expect(toPhoneDigits("+85260903521")).toBe(toPhoneDigits("85260903521"));
  });

  it("strips dashes and parentheses", () => {
    expect(toPhoneDigits("+852-6090-3521")).toBe("85260903521");
    expect(toPhoneDigits("(852) 6090 3521")).toBe("85260903521");
  });

  it("returns null for values with no digits at all", () => {
    expect(toPhoneDigits(null)).toBeNull();
    expect(toPhoneDigits(undefined)).toBeNull();
    expect(toPhoneDigits("")).toBeNull();
    expect(toPhoneDigits("   ")).toBeNull();
    expect(toPhoneDigits("+")).toBeNull();
  });

  it("strips non-ASCII digits, matching Postgres [^0-9]", () => {
    expect(toPhoneDigits("５８５２")).toBeNull();
    expect(toPhoneDigits("+852 6090 352５")).toBe("8526090352");
  });
});
