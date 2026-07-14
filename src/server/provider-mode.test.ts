import { describe, expect, it } from "vitest";
import { resolveProviderMode } from "./provider-mode";

describe("provider mode", () => {
  it("blocks local providers in a production build", () => {
    expect(() => resolveProviderMode({ requested: "local", isProductionBuild: true })).toThrow(
      "Local providers are unavailable in production builds.",
    );
  });

  it("allows explicit local providers outside production builds", () => {
    expect(resolveProviderMode({ requested: "local", isProductionBuild: false })).toBe("local");
  });
});
