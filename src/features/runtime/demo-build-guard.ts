// Explicit extension so `scripts/verify-demo-build.ts` can load this module with
// `node --experimental-strip-types` without a bundler.
import { DEMO_FIXTURE_PROJECT_ID } from "./data-mode.ts";

export type DemoBuildVerdict = { ok: true } | { ok: false; error: string };

export type DemoBuildEnv = {
  VERCEL_PROJECT_ID?: string;
  VITE_DEMO_FIXTURE_MODE?: string;
  VITE_DEMO_PROJECT_ID?: string;
};

/**
 * The build guard for the fixture demo. It only does something when
 * `VITE_DEMO_FIXTURE_MODE=true`, which only the demo project may set: any other
 * Vercel project is refused before `vite build` runs, so production can never be
 * one env var away from serving fixture data.
 */
export function checkDemoBuildEnv(env: DemoBuildEnv): DemoBuildVerdict {
  if (env.VITE_DEMO_FIXTURE_MODE !== "true") return { ok: true };

  if (env.VERCEL_PROJECT_ID !== DEMO_FIXTURE_PROJECT_ID) {
    return {
      ok: false,
      error: `VITE_DEMO_FIXTURE_MODE is set but this is not the demo project (VERCEL_PROJECT_ID=${env.VERCEL_PROJECT_ID ?? "unset"}).`,
    };
  }
  if (env.VITE_DEMO_PROJECT_ID !== DEMO_FIXTURE_PROJECT_ID) {
    return {
      ok: false,
      error: `VITE_DEMO_PROJECT_ID must be ${DEMO_FIXTURE_PROJECT_ID} when VITE_DEMO_FIXTURE_MODE is true.`,
    };
  }
  return { ok: true };
}
