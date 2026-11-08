import { afterEach, describe, expect, it, vi } from "vitest";

import { DEMO_FIXTURE_PROJECT_ID, currentDataMode, isFixtureDemoBuild } from "./data-mode";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("fixture demo build", () => {
  it("requires both the mode flag and the demo project id", () => {
    expect(isFixtureDemoBuild("true", DEMO_FIXTURE_PROJECT_ID)).toBe(true);
    expect(isFixtureDemoBuild("true", "prj_production")).toBe(false);
    expect(isFixtureDemoBuild("false", DEMO_FIXTURE_PROJECT_ID)).toBe(false);
    expect(isFixtureDemoBuild(undefined, undefined)).toBe(false);
  });

  it("switches the runtime data mode to demo only for the guarded build", () => {
    vi.stubEnv("VITE_DEMO_FIXTURE_MODE", "true");
    vi.stubEnv("VITE_DEMO_PROJECT_ID", DEMO_FIXTURE_PROJECT_ID);
    expect(currentDataMode()).toBe("demo");

    vi.stubEnv("VITE_DEMO_PROJECT_ID", "prj_production");
    expect(currentDataMode()).toBe("production");
  });
});
