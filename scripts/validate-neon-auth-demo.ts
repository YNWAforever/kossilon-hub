import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "dotenv";

export const FIRM_ID = "FIRM_ID";
export const DEMO_FIRM_ID = "DEMO_FIRM_ID";
export const DEMO_AUTH_USER_ID = "DEMO_AUTH_USER_ID";
export const DEMO_DATABASE_URL = "DEMO_DATABASE_URL";
export const NEON_AUTH_URL = "NEON_AUTH_URL";
export const NEON_AUTH_COOKIE_SECRET = "NEON_AUTH_COOKIE_SECRET";
export const DATABASE_URL = "DATABASE_URL";
export const PRODUCTION_DATABASE_URL = "PRODUCTION_DATABASE_URL";
export const PRODUCTION_NEON_AUTH_URL = "PRODUCTION_NEON_AUTH_URL";
export const VITE_ENABLE_NEON_AUTH_DEMO = "VITE_ENABLE_NEON_AUTH_DEMO";

type Environment = Readonly<Record<string, string | undefined>>;

export function canonicalPostgresIdentity(value: string, variableName: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL URL.`);
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(`${variableName} must use the postgres: or postgresql: scheme.`);
  }

  if (!url.hostname) {
    throw new Error(`${variableName} must be a valid PostgreSQL URL.`);
  }

  let databaseName: string;
  try {
    databaseName = decodeURIComponent(url.pathname)
      .replace(/^\/+|\/+$/g, "")
      .toLowerCase();
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL URL.`);
  }

  if (!databaseName) {
    throw new Error(`${variableName} must include a non-empty database path.`);
  }

  const hostname = url.hostname.toLowerCase();
  const [firstLabel, ...remainingLabels] = hostname.split(".");
  const normalizedHostname = hostname.endsWith(".neon.tech")
    ? [firstLabel.replace(/-pooler$/, ""), ...remainingLabels].join(".")
    : hostname;

  return `${normalizedHostname}:${url.port || "5432"}/${databaseName}`;
}
type CheckStatus = "pass" | "fail" | "missing";

export type ValidationCheck = {
  name: string;
  status: CheckStatus;
};

export type ValidationResult = {
  checks: ValidationCheck[];
};

export type CliOptions = {
  envFile?: string;
};

const REQUIRED_BINDINGS = [
  FIRM_ID,
  DEMO_FIRM_ID,
  DEMO_AUTH_USER_ID,
  NEON_AUTH_URL,
  NEON_AUTH_COOKIE_SECRET,
  DATABASE_URL,
  DEMO_DATABASE_URL,
  PRODUCTION_DATABASE_URL,
  PRODUCTION_NEON_AUTH_URL,
] as const;
const ENVIRONMENT_LOAD_FAILURE_MESSAGE = "Unable to load environment configuration.";

function trimmedValue(environment: Environment, name: string): string | undefined {
  const value = environment[name]?.trim();
  return value || undefined;
}

function canonicalAuthIdentity(value: string): string | undefined {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return undefined;
  }

  if (url.protocol !== "https:" || !url.hostname) return undefined;

  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname).replace(/\/+$/, "");
  } catch {
    return undefined;
  }

  return `${url.hostname.toLowerCase()}:${url.port || "443"}${pathname}`;
}

function isHttpsUrl(value: string): boolean {
  return canonicalAuthIdentity(value) !== undefined;
}

function isValidPostgresUrl(value: string, variableName: string): boolean {
  try {
    canonicalPostgresIdentity(value, variableName);
    return true;
  } catch {
    return false;
  }
}

function identitiesMatch(
  firstValue: string | undefined,
  secondValue: string | undefined,
  canonicalize: (value: string) => string | undefined,
): boolean {
  if (!firstValue || !secondValue) return false;

  const firstIdentity = canonicalize(firstValue);
  const secondIdentity = canonicalize(secondValue);
  return firstIdentity !== undefined && firstIdentity === secondIdentity;
}

function requiredCheck(
  environment: Environment,
  name: (typeof REQUIRED_BINDINGS)[number],
): ValidationCheck {
  const value = trimmedValue(environment, name);
  if (!value) return { name, status: "missing" };

  if ((name === FIRM_ID || name === DEMO_FIRM_ID) && value !== "kossilon-demo")
    return { name, status: "fail" };
  if ((name === NEON_AUTH_URL || name === PRODUCTION_NEON_AUTH_URL) && !isHttpsUrl(value)) {
    return { name, status: "fail" };
  }
  if (
    (name === DATABASE_URL || name === DEMO_DATABASE_URL || name === PRODUCTION_DATABASE_URL) &&
    !isValidPostgresUrl(value, name)
  ) {
    return { name, status: "fail" };
  }

  return { name, status: "pass" };
}

function flagCheck(environment: Environment, name: string, unsafeValue: string): ValidationCheck {
  const value = trimmedValue(environment, name)?.toLowerCase();
  return { name, status: value === unsafeValue ? "fail" : "pass" };
}

function demoAuthFeatureCheck(environment: Environment): ValidationCheck {
  const value = trimmedValue(environment, VITE_ENABLE_NEON_AUTH_DEMO)?.toLowerCase();
  if (!value) return { name: VITE_ENABLE_NEON_AUTH_DEMO, status: "missing" };
  return {
    name: VITE_ENABLE_NEON_AUTH_DEMO,
    status: value === "true" ? "pass" : "fail",
  };
}

function demoProviderModeCheck(environment: Environment): ValidationCheck {
  const value = trimmedValue(environment, "VITE_PROVIDER_MODE")?.toLowerCase();
  if (!value) return { name: "VITE_PROVIDER_MODE", status: "missing" };
  return {
    name: "VITE_PROVIDER_MODE",
    status: value === "simulated" ? "pass" : "fail",
  };
}

export function validateNeonAuthDemoEnvironment(environment: Environment): ValidationResult {
  const checks = [
    ...REQUIRED_BINDINGS.map((name) => requiredCheck(environment, name)),
    flagCheck(environment, "VITE_ENABLE_DEMO_AUTH", "true"),
    demoAuthFeatureCheck(environment),
    demoProviderModeCheck(environment),
  ];
  const demoDatabaseUrl = trimmedValue(environment, DEMO_DATABASE_URL);
  const configuredDatabaseUrl = trimmedValue(environment, DATABASE_URL);
  const productionDatabaseUrl = trimmedValue(environment, PRODUCTION_DATABASE_URL);
  const demoAuthUrl = trimmedValue(environment, NEON_AUTH_URL);
  const productionAuthUrl = trimmedValue(environment, PRODUCTION_NEON_AUTH_URL);
  const demoDatabaseBindingsMatch = identitiesMatch(
    configuredDatabaseUrl,
    demoDatabaseUrl,
    (value) => {
      try {
        return canonicalPostgresIdentity(value, DATABASE_URL);
      } catch {
        return undefined;
      }
    },
  );
  const demoDatabaseMatchesProduction =
    identitiesMatch(configuredDatabaseUrl, productionDatabaseUrl, (value) => {
      try {
        return canonicalPostgresIdentity(value, DATABASE_URL);
      } catch {
        return undefined;
      }
    }) ||
    identitiesMatch(demoDatabaseUrl, productionDatabaseUrl, (value) => {
      try {
        return canonicalPostgresIdentity(value, DEMO_DATABASE_URL);
      } catch {
        return undefined;
      }
    });
  const authIdentitiesMatch = identitiesMatch(
    demoAuthUrl,
    productionAuthUrl,
    canonicalAuthIdentity,
  );

  return {
    checks: checks.map((check) => {
      if (check.status !== "pass") return check;
      if (
        (check.name === DATABASE_URL || check.name === DEMO_DATABASE_URL) &&
        (!demoDatabaseBindingsMatch || demoDatabaseMatchesProduction)
      ) {
        return { ...check, status: "fail" };
      }
      if (check.name === NEON_AUTH_URL && authIdentitiesMatch) {
        return { ...check, status: "fail" };
      }
      return check;
    }),
  };
}

function isReady(result: ValidationResult): boolean {
  return result.checks.every((check) => check.status === "pass");
}

export function formatValidationOutput(result: ValidationResult): string {
  const heading = isReady(result)
    ? "Neon Auth demo runtime is ready."
    : "Neon Auth demo runtime is not ready.";
  return [heading, ...result.checks.map((check) => `- ${check.name}: ${check.status}`)].join("\n");
}

export function getCliOptions(args: string[]): CliOptions {
  const index = args.indexOf("--env-file");
  if (index === -1) return {};

  const envFile = args[index + 1];
  if (!envFile || envFile.startsWith("--")) {
    throw new Error("--env-file requires a file path");
  }

  return { envFile };
}

export function loadEnvironment(envFile: string | undefined): Environment {
  if (!envFile) return process.env;

  try {
    return parse(readFileSync(resolve(envFile), "utf8"));
  } catch {
    throw new Error(ENVIRONMENT_LOAD_FAILURE_MESSAGE);
  }
}

export function runCli(args = process.argv.slice(2)): number {
  const options = getCliOptions(args);
  const result = validateNeonAuthDemoEnvironment(loadEnvironment(options.envFile));
  const output = formatValidationOutput(result);

  if (isReady(result)) {
    console.log(output);
    return 0;
  }

  console.error(output);
  return 1;
}

if (import.meta.main) {
  try {
    process.exitCode = runCli();
  } catch {
    console.error(ENVIRONMENT_LOAD_FAILURE_MESSAGE);
    process.exitCode = 1;
  }
}
