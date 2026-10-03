import { defineConfig } from "@playwright/test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { localBrowserRunRoot } from "./e2e/local-evidence-guard";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5180";
const target = new URL(baseURL);
if (
  target.protocol !== "http:" ||
  !["localhost", "127.0.0.1"].includes(target.hostname) ||
  target.port !== "5180"
)
  throw new Error("Local UX runner permits only dedicated localhost5180.");
// Every invocation owns its artifacts; later runs must not replace old evidence.
const runBase = fileURLToPath(new URL("./.worktrees/local-browser-runs/", import.meta.url));
const runRoot = localBrowserRunRoot(
  runBase,
  process.env.KOSSILON_LOCAL_BROWSER_RUN_ROOT,
  process.env.TEST_WORKER_INDEX !== undefined,
);
process.env.KOSSILON_LOCAL_BROWSER_RUN_ROOT = runRoot;
console.log(`[local-browser-evidence] run root: ${runRoot}`);
export default defineConfig({
  testDir: "./e2e",
  testMatch: [
    "local-ux.spec.ts",
    "performance.spec.ts",
    "audit-release-demo.spec.ts",
    "audit-persona-local.spec.ts",
  ],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["json", { outputFile: join(runRoot, "results.json") }]],
  outputDir: join(runRoot, "artifacts"),
  globalSetup: fileURLToPath(new URL("./e2e/local-evidence-guard.ts", import.meta.url)),
  use: {
    baseURL,
    browserName: "chromium",
    channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "mobile390", use: { viewport: { width: 390, height: 844 } } },
    { name: "desktop1280", use: { viewport: { width: 1280, height: 900 } } },
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5180",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
    env: { VITE_ENABLE_DEMO_AUTH: "true" },
  },
});
