export type DataMode = "demo" | "production";

/** The Vercel project whose build may switch to the browser fixture demo. */
export const DEMO_FIXTURE_PROJECT_ID = "prj_gGAnJ3UeweOczw3nRj1Po3sDwZMm";

export function resolveDataMode(input: {
  demoEnabled: boolean;
  isProductionBuild: boolean;
}): DataMode {
  return !input.isProductionBuild && input.demoEnabled ? "demo" : "production";
}

/**
 * A built deployment can run the fixture demo only when the demo project's build
 * carries both flags. `scripts/verify-demo-build.ts` refuses to produce a
 * fixture bundle on any other Vercel project, so a production build cannot get
 * here by accident.
 */
export function isFixtureDemoBuild(
  mode = import.meta.env.VITE_DEMO_FIXTURE_MODE,
  projectId = import.meta.env.VITE_DEMO_PROJECT_ID,
): boolean {
  return mode === "true" && projectId === DEMO_FIXTURE_PROJECT_ID;
}

export function currentDataMode(): DataMode {
  if (isFixtureDemoBuild()) return "demo";
  return resolveDataMode({
    demoEnabled: import.meta.env.VITE_ENABLE_DEMO_AUTH === "true",
    isProductionBuild: import.meta.env.PROD,
  });
}
