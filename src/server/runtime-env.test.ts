import { describe, expect, it } from "vitest";

import { getFirmRuntimeEnv, getRuntimeReadiness } from "./runtime-env";

describe("firm runtime", () => {
  const fakeR2Bucket = {};
  const validEnv = {
    FIRM_ID: "firm-a",
    NEON_AUTH_URL: "https://firm-a.example.neon.tech/auth",
    NEON_AUTH_COOKIE_SECRET: "test-cookie-secret-at-least-32-characters",
    DATABASE_URL: "postgres://test:test@localhost:5432/test",
    DOCUMENTS_BUCKET: fakeR2Bucket,
    WOZTELL_API_BASE_URL: "https://api.example.test",
    WOZTELL_ACCESS_TOKEN: "test-token",
    WOZTELL_CHANNEL_ID: "test-channel",
    WOZTELL_WEBHOOK_SECRET: "test-webhook-secret",
    EMAIL_FROM: "operations@example.test",
  };

  it("requires one fixed firm id and every production binding", () => {
    expect(() => getFirmRuntimeEnv({ FIRM_ID: "" })).toThrow(/FIRM_ID/);
    expect(getRuntimeReadiness({ FIRM_ID: "firm-a" })).toEqual({
      ready: false,
      missing: [
        "NEON_AUTH_URL",
        "NEON_AUTH_COOKIE_SECRET",
        "DATABASE_URL",
        "DOCUMENTS_BUCKET",
        "WOZTELL_API_BASE_URL",
        "WOZTELL_ACCESS_TOKEN",
        "WOZTELL_CHANNEL_ID",
        "WOZTELL_WEBHOOK_SECRET",
        "EMAIL_FROM",
      ],
    });
  });

  it("returns a ready, normalized per-firm runtime", () => {
    expect(getRuntimeReadiness(validEnv)).toEqual({ ready: true, missing: [] });
    expect(getFirmRuntimeEnv(validEnv)).toMatchObject({
      firmId: "firm-a",
      documentsBucket: fakeR2Bucket,
      emailFrom: "operations@example.test",
    });
  });

  it("normalizes a Cloudflare Hyperdrive binding", () => {
    const { DATABASE_URL: _databaseUrl, ...workerEnv } = validEnv;
    const env = {
      ...workerEnv,
      HYPERDRIVE: {
        connectionString: "postgres://hyperdrive.example.test/database",
      },
    };

    expect(getRuntimeReadiness(env)).toEqual({ ready: true, missing: [] });
    expect(getFirmRuntimeEnv(env).databaseUrl).toBe("postgres://hyperdrive.example.test/database");
  });

  it("does not expose a request-controlled tenant field", () => {
    expect(Object.keys(getFirmRuntimeEnv(validEnv))).not.toContain("tenantId");
  });
});
