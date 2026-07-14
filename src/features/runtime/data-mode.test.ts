import { describe, expect, it } from "vitest";
import { resolveDataMode } from "./data-mode";

describe("resolveDataMode", () => {
  it("never enables demo data in a production build", () => {
    expect(resolveDataMode({ demoEnabled: true, isProductionBuild: true })).toBe("production");
  });

  it("requires an explicit flag outside production", () => {
    expect(resolveDataMode({ demoEnabled: false, isProductionBuild: false })).toBe("production");
    expect(resolveDataMode({ demoEnabled: true, isProductionBuild: false })).toBe("demo");
  });
});
