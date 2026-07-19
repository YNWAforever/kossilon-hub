import { describe, expect, it } from "vitest";
import { resolveProviderMode } from "./provider-mode";

describe("provider mode", () => {
  it("allows simulated providers only for the exact demo firm", () => {
    expect(
      resolveProviderMode({
        requested: "simulated",
        isProductionBuild: true,
        firmId: "kossilon-demo",
      }),
    ).toBe("simulated");

    expect(() =>
      resolveProviderMode({
        requested: "simulated",
        isProductionBuild: true,
        firmId: "customer-firm",
      }),
    ).toThrow("Simulated providers are available only for kossilon-demo.");
  });

  it("continues to reject local providers in production", () => {
    expect(() =>
      resolveProviderMode({
        requested: "local",
        isProductionBuild: true,
        firmId: "kossilon-demo",
      }),
    ).toThrow("Local providers are unavailable in production builds.");
  });

  it("allows explicit local providers outside production builds", () => {
    expect(resolveProviderMode({ requested: "local", isProductionBuild: false })).toBe("local");
  });
});
