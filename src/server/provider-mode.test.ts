import { describe, expect, it } from "vitest";
import { normalizeProviderMode, resolveProviderMode } from "./provider-mode";

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

/**
 * The safety-check bypass this normaliser closes.
 *
 * The runtime compared the raw value while the demo validator trims and
 * lowercases before comparing, so `Simulated` passed the check that exists to
 * confirm a deployment is a safe demo and then resolved to live -- real sends to
 * real clients from a deployment everything said was simulated.
 */
describe("normalizeProviderMode", () => {
  it("accepts the casing and padding the demo validator accepts", () => {
    for (const value of ["Simulated", " simulated ", "SIMULATED"]) {
      expect(normalizeProviderMode(value)).toBe("simulated");
    }
    expect(normalizeProviderMode("Local")).toBe("local");
    expect(normalizeProviderMode("LIVE")).toBe("live");
  });

  // Production sets nothing, so absent is a deliberate default.
  it("defaults to live only when nothing is configured", () => {
    expect(normalizeProviderMode(undefined)).toBe("live");
    expect(normalizeProviderMode("")).toBe("live");
    expect(normalizeProviderMode("   ")).toBe("live");
  });

  /**
   * The direction that matters. A present-but-unrecognised value means somebody
   * tried to configure this and got it wrong, and the safe answer to a typo is
   * not "send real messages".
   */
  it("refuses a typo rather than falling through to live", () => {
    for (const value of ["simulate", "demo", "sandbox", "prod", "simulated;"]) {
      expect(() => normalizeProviderMode(value)).toThrow(/unrecognised/i);
    }
  });

  it("does not echo the configured value in the error", () => {
    expect(() => normalizeProviderMode("sandbox-2026")).not.toThrow(/sandbox-2026/);
  });
});
