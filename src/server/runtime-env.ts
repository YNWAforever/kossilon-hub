import type { R2Bucket } from "@cloudflare/workers-types";

// Explicit .ts extension: scripts/validate-firm-runtime.ts loads this module under raw
// Node ESM, which does not resolve extensionless relative specifiers.
import { createR2S3Bucket } from "./r2-s3-bucket.ts";

export type R2BucketLike = Pick<R2Bucket, "delete" | "get" | "head" | "put">;

export type FirmRuntimeEnv = {
  firmId: string;
  neonAuthUrl: string;
  neonAuthCookieSecret: string;
  databaseUrl: string;
  documentsBucket: R2BucketLike;
  woztellApiBaseUrl: string;
  woztellAccessToken: string;
  woztellChannelId: string;
  woztellWebhookSecret: string;
  emailFrom: string;
};

export type RuntimeReadiness = {
  ready: boolean;
  missing: string[];
};

// Every entry here is required by getFirmRuntimeEnv() for EVERY caller, since it
// takes no arguments and throws all-or-nothing. Do not add RESEND_API_KEY/
// RESEND_FROM: they are read directly by server.ts for the magic-link webhook
// only, and adding them here once broke unrelated callers (WhatsApp dispatch,
// document storage) that need this same function for fields that have nothing
// to do with email. scripts/verify-firm-deployment.ts intentionally keeps its
// own, longer list — that one only feeds an audit report and gates nothing.
const REQUIRED_BINDINGS = [
  "FIRM_ID",
  "NEON_AUTH_URL",
  "NEON_AUTH_COOKIE_SECRET",
  "DATABASE_URL",
  "DOCUMENTS_BUCKET",
  "WOZTELL_API_BASE_URL",
  "WOZTELL_ACCESS_TOKEN",
  "WOZTELL_CHANNEL_ID",
  "WOZTELL_WEBHOOK_SECRET",
  "EMAIL_FROM",
] as const;

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function getDatabaseUrl(env: Record<string, unknown>): string | undefined {
  if (hasText(env.DATABASE_URL)) return env.DATABASE_URL;

  const hyperdrive = env.HYPERDRIVE;
  if (
    typeof hyperdrive === "object" &&
    hyperdrive !== null &&
    "connectionString" in hyperdrive &&
    hasText(hyperdrive.connectionString)
  ) {
    return hyperdrive.connectionString;
  }

  return undefined;
}

function isSecureUrl(value: unknown): boolean {
  if (!hasText(value)) return false;

  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isEmail(value: unknown): boolean {
  return hasText(value) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// Workers exposes R2 as a binding object. Every other runtime (Vercel, Node) reaches the
// same bucket over R2's S3-compatible API, so either form satisfies DOCUMENTS_BUCKET.
const R2_S3_CREDENTIAL_KEYS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
] as const;

function r2S3Config(env: Record<string, unknown>) {
  if (!R2_S3_CREDENTIAL_KEYS.every((key) => hasText(env[key]))) return undefined;

  return {
    accountId: (env.R2_ACCOUNT_ID as string).trim(),
    accessKeyId: (env.R2_ACCESS_KEY_ID as string).trim(),
    secretAccessKey: (env.R2_SECRET_ACCESS_KEY as string).trim(),
    bucketName: (env.R2_BUCKET_NAME as string).trim(),
    endpoint: hasText(env.R2_ENDPOINT) ? env.R2_ENDPOINT.trim() : undefined,
  };
}

function resolveDocumentsBucket(env: Record<string, unknown>): R2BucketLike {
  if (isR2Bucket(env.DOCUMENTS_BUCKET)) return env.DOCUMENTS_BUCKET;

  const config = r2S3Config(env);
  if (!config) {
    throw new Error("DOCUMENTS_BUCKET requires a Workers R2 binding or R2 S3 credentials.");
  }

  return createR2S3Bucket(config);
}

function isR2Bucket(value: unknown): value is R2BucketLike {
  if (typeof value !== "object" || value === null) return false;

  const bucket = value as Record<string, unknown>;
  return ["delete", "get", "head", "put"].every((method) => typeof bucket[method] === "function");
}

function hasBinding(env: Record<string, unknown>, name: string): boolean {
  switch (name) {
    case "FIRM_ID":
      return hasText(env[name]) && /^[a-z0-9][a-z0-9-]{1,62}$/.test(env[name].trim());
    case "NEON_AUTH_URL":
    case "WOZTELL_API_BASE_URL":
      return isSecureUrl(env[name]);
    case "NEON_AUTH_COOKIE_SECRET":
      return hasText(env[name]) && env[name].trim().length >= 32;
    case "DATABASE_URL":
      return getDatabaseUrl(env) !== undefined;
    case "DOCUMENTS_BUCKET":
      return isR2Bucket(env[name]) || r2S3Config(env) !== undefined;
    case "WOZTELL_ACCESS_TOKEN":
      return hasText(env[name]) && env[name].trim().length >= 8;
    case "WOZTELL_WEBHOOK_SECRET":
      return hasText(env[name]) && env[name].trim().length >= 16;
    case "EMAIL_FROM":
      return isEmail(env[name]);
    default:
      return hasText(env[name]);
  }
}

function defaultRuntimeSource(): Record<string, unknown> {
  return (
    (
      globalThis as typeof globalThis & {
        process?: { env?: Record<string, string | undefined> };
      }
    ).process?.env ?? {}
  );
}

export function getRuntimeReadiness(env: Record<string, unknown>): RuntimeReadiness {
  const missing = REQUIRED_BINDINGS.filter((name) => !hasBinding(env, name));
  return { ready: missing.length === 0, missing };
}

export function getFirmRuntimeEnv(
  env: Record<string, unknown> = defaultRuntimeSource(),
): FirmRuntimeEnv {
  const readiness = getRuntimeReadiness(env);
  if (!readiness.ready) {
    throw new Error(`Missing required firm runtime bindings: ${readiness.missing.join(", ")}`);
  }

  return {
    firmId: (env.FIRM_ID as string).trim(),
    neonAuthUrl: (env.NEON_AUTH_URL as string).trim(),
    neonAuthCookieSecret: env.NEON_AUTH_COOKIE_SECRET as string,
    databaseUrl: getDatabaseUrl(env) as string,
    documentsBucket: resolveDocumentsBucket(env),
    woztellApiBaseUrl: (env.WOZTELL_API_BASE_URL as string).trim(),
    woztellAccessToken: env.WOZTELL_ACCESS_TOKEN as string,
    woztellChannelId: (env.WOZTELL_CHANNEL_ID as string).trim(),
    woztellWebhookSecret: env.WOZTELL_WEBHOOK_SECRET as string,
    emailFrom: (env.EMAIL_FROM as string).trim(),
  };
}
