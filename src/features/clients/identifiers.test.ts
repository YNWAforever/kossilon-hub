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
});
