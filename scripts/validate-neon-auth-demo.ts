import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "dotenv";

export const FIRM_ID = "FIRM_ID";
export const NEON_AUTH_URL = "NEON_AUTH_URL";
export const NEON_AUTH_COOKIE_SECRET = "NEON_AUTH_COOKIE_SECRET";
export const DATABASE_URL = "DATABASE_URL";

type Environment = Readonly<Record<string, string | undefined>>;
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

const REQUIRED_BINDINGS = [FIRM_ID, NEON_AUTH_URL, NEON_AUTH_COOKIE_SECRET, DATABASE_URL] as const;
const ENVIRONMENT_LOAD_FAILURE_MESSAGE = "Unable to load environment configuration.";

function trimmedValue(environment: Environment, name: string): string | undefined {
  const value = environment[name]?.trim();
  return value || undefined;
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isPlaceholderFirmId(value: string): boolean {
  const normalized = value.toLowerCase();

  return (
    value.includes("${") ||
    value.includes("{{") ||
    value.includes("<%") ||
    /placeholder|change[-_ ]?me|your[-_ ]?firm(?:[-_ ]?id)?/.test(normalized)
  );
}

function requiredCheck(
  environment: Environment,
  name: (typeof REQUIRED_BINDINGS)[number],
): ValidationCheck {
  const value = trimmedValue(environment, name);
  if (!value) return { name, status: "missing" };

  if (name === FIRM_ID && isPlaceholderFirmId(value)) return { name, status: "fail" };
  if (name === NEON_AUTH_URL && !isHttpsUrl(value)) return { name, status: "fail" };

  return { name, status: "pass" };
}

function flagCheck(environment: Environment, name: string, unsafeValue: string): ValidationCheck {
  const value = trimmedValue(environment, name)?.toLowerCase();
  return { name, status: value === unsafeValue ? "fail" : "pass" };
}

export function validateNeonAuthDemoEnvironment(environment: Environment): ValidationResult {
  const checks = [
    ...REQUIRED_BINDINGS.map((name) => requiredCheck(environment, name)),
    flagCheck(environment, "VITE_ENABLE_DEMO_AUTH", "true"),
    flagCheck(environment, "VITE_PROVIDER_MODE", "local"),
  ];

  return { checks };
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
