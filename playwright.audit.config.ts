import { defineConfig } from "@playwright/test";
import { auditStagingTarget } from "./scripts/audit-staging-config";
const target = auditStagingTarget(process.env);
export default defineConfig({
  testDir: "./e2e",
  testMatch: "audit-remediation.spec.ts",
  workers: 1,
  retries: 0,
  reporter: "list",
  outputDir: ".worktrees/audit-baseline-20261001/staging-browser-artifacts",
  metadata: {
    buildSha: target.buildSha,
    evidenceLevel: "isolated-staging-fresh-password-login-only",
  },
  use: {
    baseURL: target.origin,
    browserName: "chromium",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  // No webServer, storageState, demo login or provider fixture.
});
