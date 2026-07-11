export type R2BucketLike = {
  delete(key: string | string[]): Promise<void>;
  get(key: string, options?: Record<string, unknown>): Promise<unknown>;
  head(key: string): Promise<unknown>;
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
};

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

const REQUIRED_STRING_BINDINGS = [
  "FIRM_ID",
  "NEON_AUTH_URL",
  "NEON_AUTH_COOKIE_SECRET",
  "WOZTELL_API_BASE_URL",
  "WOZTELL_ACCESS_TOKEN",
  "WOZTELL_CHANNEL_ID",
  "WOZTELL_WEBHOOK_SECRET",
  "EMAIL_FROM",
] as const;

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
  if (hasText(env.DATABASE_URL)) return env.DATABASE_URL.trim();

  const hyperdrive = env.HYPERDRIVE;
  if (
    typeof hyperdrive === "object" &&
    hyperdrive !== null &&
    "connectionString" in hyperdrive &&
    hasText(hyperdrive.connectionString)
  ) {
    return hyperdrive.connectionString.trim();
  }

  return undefined;
}

function hasBinding(env: Record<string, unknown>, name: string): boolean {
  if (name === "DOCUMENTS_BUCKET") {
    return typeof env[name] === "object" && env[name] !== null;
  }
  if (name === "DATABASE_URL") return getDatabaseUrl(env) !== undefined;

  return hasText(env[name]);
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

  const strings = Object.fromEntries(
    REQUIRED_STRING_BINDINGS.map((name) => [name, (env[name] as string).trim()]),
  ) as Record<(typeof REQUIRED_STRING_BINDINGS)[number], string>;

  return {
    firmId: strings.FIRM_ID,
    neonAuthUrl: strings.NEON_AUTH_URL,
    neonAuthCookieSecret: strings.NEON_AUTH_COOKIE_SECRET,
    databaseUrl: getDatabaseUrl(env) as string,
    documentsBucket: env.DOCUMENTS_BUCKET as R2BucketLike,
    woztellApiBaseUrl: strings.WOZTELL_API_BASE_URL,
    woztellAccessToken: strings.WOZTELL_ACCESS_TOKEN,
    woztellChannelId: strings.WOZTELL_CHANNEL_ID,
    woztellWebhookSecret: strings.WOZTELL_WEBHOOK_SECRET,
    emailFrom: strings.EMAIL_FROM,
  };
}
