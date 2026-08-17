import type { R2Bucket } from "@cloudflare/workers-types";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, expectTypeOf, it } from "vitest";

import type { R2BucketLike } from "./runtime-env";
import { getFirmRuntimeEnv, getResendConfig, getRuntimeReadiness } from "./runtime-env";

describe("firm runtime", () => {
  const fakeR2Bucket = {
    delete: async () => undefined,
    get: async () => null,
    head: async () => null,
    put: async () => null,
  } as unknown as R2BucketLike;
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

  it("uses the official Cloudflare R2 method contract", () => {
    expectTypeOf<R2BucketLike>().toEqualTypeOf<Pick<R2Bucket, "delete" | "get" | "head" | "put">>();
  });

  it("declares the R2 boundary as an exact Cloudflare method pick", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./runtime-env.ts", import.meta.url)),
      "utf8",
    );
    expect(source).toContain('Pick<R2Bucket, "delete" | "get" | "head" | "put">');
  });

  it("rejects malformed production bindings", () => {
    expect(
      getRuntimeReadiness({
        ...validEnv,
        FIRM_ID: "Firm A!",
        NEON_AUTH_URL: "not-a-url",
        NEON_AUTH_COOKIE_SECRET: "short",
        DOCUMENTS_BUCKET: {},
        EMAIL_FROM: "not-an-email",
      }).missing,
    ).toEqual([
      "FIRM_ID",
      "NEON_AUTH_URL",
      "NEON_AUTH_COOKIE_SECRET",
      "DOCUMENTS_BUCKET",
      "EMAIL_FROM",
    ]);
  });

  it("preserves opaque credential values byte-for-byte", () => {
    const secret = "  opaque-secret-value-at-least-32-characters  ";
    expect(getFirmRuntimeEnv({ ...validEnv, NEON_AUTH_COOKIE_SECRET: secret })).toMatchObject({
      neonAuthCookieSecret: secret,
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

  it("accepts R2 S3 credentials when no Workers binding is available", () => {
    const { DOCUMENTS_BUCKET: _binding, ...env } = validEnv;
    const withCredentials = {
      ...env,
      R2_ACCOUNT_ID: "acct123",
      R2_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
      R2_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      R2_BUCKET_NAME: "firm-documents",
    };

    expect(getRuntimeReadiness(withCredentials)).toEqual({ ready: true, missing: [] });

    const bucket = getFirmRuntimeEnv(withCredentials).documentsBucket;
    for (const method of ["get", "put", "head", "delete"] as const) {
      expect(typeof bucket[method]).toBe("function");
    }
  });

  it("reports the documents bucket missing when R2 credentials are incomplete", () => {
    const { DOCUMENTS_BUCKET: _binding, ...env } = validEnv;

    expect(
      getRuntimeReadiness({ ...env, R2_ACCOUNT_ID: "acct123", R2_BUCKET_NAME: "firm-documents" }),
    ).toEqual({ ready: false, missing: ["DOCUMENTS_BUCKET"] });
  });

  it("prefers the Workers binding when both a binding and credentials are present", () => {
    const bucket = getFirmRuntimeEnv({
      ...validEnv,
      R2_ACCOUNT_ID: "acct123",
      R2_ACCESS_KEY_ID: "AKIAIOSFODNN7EXAMPLE",
      R2_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      R2_BUCKET_NAME: "firm-documents",
    }).documentsBucket;

    expect(bucket).toBe(fakeR2Bucket);
  });

  it("does not expose a request-controlled tenant field", () => {
    expect(Object.keys(getFirmRuntimeEnv(validEnv))).not.toContain("tenantId");
  });
});

describe("getResendConfig", () => {
  it("returns null when either RESEND_API_KEY or RESEND_FROM is missing", () => {
    expect(getResendConfig({})).toBeNull();
    expect(getResendConfig({ RESEND_API_KEY: "re_test_key" })).toBeNull();
    expect(getResendConfig({ RESEND_FROM: "auth@example.test" })).toBeNull();
  });

  it("returns null when either value is blank", () => {
    expect(getResendConfig({ RESEND_API_KEY: "   ", RESEND_FROM: "auth@example.test" })).toBeNull();
    expect(getResendConfig({ RESEND_API_KEY: "re_test_key", RESEND_FROM: "   " })).toBeNull();
  });

  it("returns a trimmed config when both are present", () => {
    expect(
      getResendConfig({
        RESEND_API_KEY: "  re_test_key  ",
        RESEND_FROM: "  Kossilon Hub <auth@example.test>  ",
      }),
    ).toEqual({ apiKey: "re_test_key", from: "Kossilon Hub <auth@example.test>" });
  });

  it("is independent of every other runtime binding", () => {
    // A firm with no WOZTELL/Neon Auth config at all can still have a valid
    // Resend config — this must never route through getRuntimeReadiness/
    // getFirmRuntimeEnv's REQUIRED_BINDINGS check.
    expect(
      getResendConfig({ RESEND_API_KEY: "re_test_key", RESEND_FROM: "auth@example.test" }),
    ).toEqual({ apiKey: "re_test_key", from: "auth@example.test" });
  });
});
