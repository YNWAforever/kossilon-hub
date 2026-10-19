import { describe, expect, it } from "vitest";

import {
  isValidBrNumber,
  isValidCrNumber,
  normalizeBrNumber,
  normalizeCrNumber,
} from "./identifiers";

describe("Hong Kong company identifiers", () => {
  it.each(["1200042", "12000420", "F0012345", "f0012345", " 1200 042 "])(
    "accepts CR number %j",
    (value) => expect(isValidCrNumber(value)).toBe(true),
  );

  it.each(["12", "abc", "123456789", "F12", "12-00042", ""])("rejects CR number %j", (value) =>
    expect(isValidCrNumber(value)).toBe(false),
  );

  it.each(["60000138", "60000138-000", " 6000 0138 "])("accepts BR number %j", (value) =>
    expect(isValidBrNumber(value)).toBe(true),
  );

  it.each(["abc", "6000013", "600001380", "60000138-00", ""])("rejects BR number %j", (value) =>
    expect(isValidBrNumber(value)).toBe(false),
  );

  it("normalises what gets stored, so the unique constraints compare like with like", () => {
    expect(normalizeCrNumber(" f001 2345 ")).toBe("F0012345");
    expect(normalizeBrNumber("6000 0138-000")).toBe("60000138-000");
  });

  // The number printed on a BR certificate carries the certificate's expiry and
  // a check character after the branch number. Staff paste it whole; the
  // business registration number itself is only the first two parts.
  it("accepts a BR number pasted in its full certificate form and keeps the number itself", () => {
    expect(isValidBrNumber("60000138-000-07-27-A")).toBe(true);
    expect(isValidBrNumber("60000138-000-07-27-3")).toBe(true);
    expect(normalizeBrNumber("60000138-000-07-27-a")).toBe("60000138-000");
    expect(isValidBrNumber("60000138-000-07-27")).toBe(false);
  });
});
