import { describe, expect, it } from "vitest";
import { findImportProtectionViolation } from "./verify-dev-server-imports";

describe("findImportProtectionViolation", () => {
  it("returns null when the dev server output has no violation", () => {
    expect(findImportProtectionViolation("VITE v8.0.0  ready in 412 ms\n")).toBeNull();
  });

  it("extracts the violation message when present", () => {
    const output =
      "some earlier log line\n" +
      "[import-protection] Import denied in client environment — Denied by file pattern: **/server/**\n" +
      "more log output after it";

    const violation = findImportProtectionViolation(output);

    expect(violation).toContain("[import-protection] Import denied in client environment");
  });
});
