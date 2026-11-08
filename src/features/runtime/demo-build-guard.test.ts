import { describe, expect, it } from "vitest";

import { DEMO_FIXTURE_PROJECT_ID } from "./data-mode";
import { checkDemoBuildEnv } from "./demo-build-guard";

describe("demo build guard", () => {
  it("does nothing when the fixture flag is absent", () => {
    expect(checkDemoBuildEnv({})).toEqual({ ok: true });
    expect(checkDemoBuildEnv({ VITE_DEMO_FIXTURE_MODE: "false" })).toEqual({ ok: true });
  });

  it("refuses the fixture bundle on any project other than the demo project", () => {
    for (const projectId of [undefined, "prj_production", "prj_FLAfZbaiLb9sAhrssXTUtlOYfBdC"]) {
      const verdict = checkDemoBuildEnv({
        VERCEL_PROJECT_ID: projectId,
        VITE_DEMO_FIXTURE_MODE: "true",
        VITE_DEMO_PROJECT_ID: DEMO_FIXTURE_PROJECT_ID,
      });
      expect(verdict.ok).toBe(false);
    }
  });

  it("accepts the guarded demo build", () => {
    expect(
      checkDemoBuildEnv({
        VERCEL_PROJECT_ID: DEMO_FIXTURE_PROJECT_ID,
        VITE_DEMO_FIXTURE_MODE: "true",
        VITE_DEMO_PROJECT_ID: DEMO_FIXTURE_PROJECT_ID,
      }),
    ).toEqual({ ok: true });
  });

  it("refuses a mismatched guard id", () => {
    const verdict = checkDemoBuildEnv({
      VERCEL_PROJECT_ID: DEMO_FIXTURE_PROJECT_ID,
      VITE_DEMO_FIXTURE_MODE: "true",
      VITE_DEMO_PROJECT_ID: "prj_something_else",
    });
    expect(verdict.ok).toBe(false);
  });
});
