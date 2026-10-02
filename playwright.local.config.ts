import { defineConfig } from "@playwright/test";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:5180";
const target = new URL(baseURL);
if (
  target.protocol !== "http:" ||
  !["localhost", "127.0.0.1"].includes(target.hostname) ||
  target.port !== "5180"
)
  throw new Error("Local UX runner permits only dedicated localhost5180.");
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["local-ux.spec.ts", "performance.spec.ts"],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["json", { outputFile: ".worktrees/audit-baseline-20261001/t20-browser-results.json" }],
  ],
  outputDir: ".worktrees/audit-baseline-20261001/browser-artifacts",
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
