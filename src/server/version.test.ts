import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildDeploymentVersion } from "./version";

describe("buildDeploymentVersion", () => {
  it("reports the deployed commit, environment and data mode", () => {
    expect(
      buildDeploymentVersion({
        env: {
          VERCEL_GIT_COMMIT_SHA: "8020f1c8c05efef8a464d1f9a46041a06c216d69",
          VERCEL_ENV: "production",
          VERCEL_URL: "kossilon-26u2bxfws-ynwaforevers-projects.vercel.app",
        },
        dataMode: "production",
      }),
    ).toEqual({
      sha: "8020f1c8c05efef8a464d1f9a46041a06c216d69",
      environment: "production",
      dataMode: "production",
      host: "kossilon-26u2bxfws-ynwaforevers-projects.vercel.app",
    });
  });

  it("says unknown instead of inventing a value outside Vercel", () => {
    expect(buildDeploymentVersion({ env: {}, dataMode: "demo" })).toEqual({
      sha: "unknown",
      environment: "unknown",
      dataMode: "demo",
      host: null,
    });
  });

  it("is served from the worker entry with no-store caching", () => {
    const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");

    expect(server).toContain('pathname === "/api/version"');
    expect(server).toContain("buildDeploymentVersion");
    expect(server).toContain('"cache-control": "no-store"');
  });

  it("contains no environment values", () => {
    const version = buildDeploymentVersion({
      env: {
        VERCEL_GIT_COMMIT_SHA: "abc123",
        VERCEL_ENV: "production",
        DATABASE_URL: "postgres://must-not-appear",
        NEON_AUTH_COOKIE_SECRET: "must-not-appear",
      },
      dataMode: "production",
    });

    expect(JSON.stringify(version)).not.toContain("must-not-appear");
  });
});
