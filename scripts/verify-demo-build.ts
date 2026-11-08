import { checkDemoBuildEnv } from "../src/features/runtime/demo-build-guard.ts";

const verdict = checkDemoBuildEnv({
  VERCEL_PROJECT_ID: process.env.VERCEL_PROJECT_ID,
  VITE_DEMO_FIXTURE_MODE: process.env.VITE_DEMO_FIXTURE_MODE,
  VITE_DEMO_PROJECT_ID: process.env.VITE_DEMO_PROJECT_ID,
});

if (!verdict.ok) {
  console.error(`demo build refused: ${verdict.error}`);
  process.exit(1);
}

console.log("demo build guard: ok");
