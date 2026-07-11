import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "dotenv";
import { parse as parseJsonc } from "jsonc-parser";

import { getRuntimeReadiness } from "../src/server/runtime-env.ts";

type WranglerTemplate = {
  name?: string;
  vars?: Record<string, unknown>;
  hyperdrive?: Array<{ binding?: string; id?: string }>;
  r2_buckets?: Array<{ binding?: string; bucket_name?: string }>;
};

type CliOptions = { envFile?: string; wranglerFile: string };

const REQUIRED_RENDERED_VARS = [
  "FIRM_ID",
  "NEON_AUTH_URL",
  "WOZTELL_API_BASE_URL",
  "WOZTELL_CHANNEL_ID",
  "EMAIL_FROM",
] as const;

const DEPLOYMENT_REQUIREMENT_ORDER = [
  "WORKER_NAME",
  "FIRM_ID",
  "NEON_AUTH_URL",
  "NEON_AUTH_COOKIE_SECRET",
  "HYPERDRIVE",
  "DOCUMENTS_BUCKET",
  "WOZTELL_API_BASE_URL",
  "WOZTELL_ACCESS_TOKEN",
  "WOZTELL_CHANNEL_ID",
  "WOZTELL_WEBHOOK_SECRET",
  "EMAIL_FROM",
] as const;

function getEnvFileArgument(args: string[]): string | undefined {
  const index = args.indexOf("--env-file");
  if (index === -1) return undefined;

  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("--env-file requires a file path");
  }

  return value;
}

function getOptions(args: string[]): CliOptions {
  const wranglerIndex = args.indexOf("--wrangler-file");
  const wranglerFile = wranglerIndex === -1 ? "wrangler.template.jsonc" : args[wranglerIndex + 1];

  if (!wranglerFile || wranglerFile.startsWith("--")) {
    throw new Error("--wrangler-file requires a file path");
  }

  return { envFile: getEnvFileArgument(args), wranglerFile };
}

function loadEnvironment(envFile: string | undefined): Record<string, unknown> {
  if (!envFile) return process.env;

  return parse(readFileSync(resolve(envFile), "utf8"));
}

function loadWranglerTemplate(path: string): WranglerTemplate {
  return parseJsonc(readFileSync(resolve(path), "utf8")) as WranglerTemplate;
}

function isRenderedText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !value.includes("${");
}

function hasRenderedR2Binding(template: WranglerTemplate): boolean {
  return (
    template.r2_buckets?.some(
      (item) => item.binding === "DOCUMENTS_BUCKET" && isRenderedText(item.bucket_name),
    ) ?? false
  );
}

function hasRenderedHyperdriveBinding(template: WranglerTemplate): boolean {
  return (
    template.hyperdrive?.some((item) => item.binding === "HYPERDRIVE" && isRenderedText(item.id)) ??
    false
  );
}

function deploymentProbe(
  env: Record<string, unknown>,
  template: WranglerTemplate,
): Record<string, unknown> {
  const probe = { ...env };

  if (hasRenderedR2Binding(template)) {
    probe.DOCUMENTS_BUCKET = {
      delete() {},
      get() {},
      head() {},
      put() {},
    };
  }
  if (hasRenderedHyperdriveBinding(template)) {
    probe.HYPERDRIVE = { connectionString: "postgres://declared-hyperdrive-binding" };
  }

  return probe;
}

function deploymentMissing(env: Record<string, unknown>, template: WranglerTemplate): string[] {
  const missing = new Set<string>();

  if (!isRenderedText(template.name)) missing.add("WORKER_NAME");

  for (const name of REQUIRED_RENDERED_VARS) {
    const envValue = env[name];
    const templateValue = template.vars?.[name];
    if (
      !isRenderedText(templateValue) ||
      typeof envValue !== "string" ||
      templateValue !== envValue.trim()
    ) {
      missing.add(name);
    }
  }

  for (const name of getRuntimeReadiness(deploymentProbe(env, template)).missing) {
    missing.add(name === "DATABASE_URL" ? "HYPERDRIVE" : name);
  }

  return DEPLOYMENT_REQUIREMENT_ORDER.filter((name) => missing.has(name));
}

try {
  const options = getOptions(process.argv.slice(2));
  const env = loadEnvironment(options.envFile);
  const template = loadWranglerTemplate(options.wranglerFile);
  const missing = deploymentMissing(env, template);

  if (missing.length > 0) {
    console.error("Runtime is missing required production bindings:");
    for (const binding of missing) console.error(`- ${binding}`);
    process.exitCode = 1;
  } else {
    console.log("Firm runtime deployment is ready.");
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "Validation failed";
  console.error(message);
  process.exitCode = 1;
}
