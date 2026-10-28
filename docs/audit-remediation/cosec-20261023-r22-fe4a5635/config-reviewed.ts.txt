import { defineConfig } from "@playwright/test";
import local from "./playwright.local.config";

// A separate bounded run: existing local suites retain their original matrix.
export default defineConfig({
  ...local,
  testMatch: ["r22-viewport-zoom.spec.ts"],
  use: { ...local.use, trace: "on" },
  projects: [
    { name: "full390", metadata: { zoom: 1, cssWidth: 390, cssHeight: 844 } },
    { name: "desktop100", metadata: { zoom: 1, cssWidth: 1280, cssHeight: 900 } },
    { name: "desktop200", metadata: { zoom: 2, cssWidth: 640, cssHeight: 450 } },
  ],
  webServer: { ...local.webServer, reuseExistingServer: false },
});
