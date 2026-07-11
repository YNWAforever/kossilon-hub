import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "dotenv";
import { parse as parseJsonc } from "jsonc-parser";

import { getRuntimeReadiness } from "../src/server/runtime-env.ts";

type WranglerTemplate = {
  hyperdrive?: Array<{ binding?: string }>;
  r2_buckets?: Array<{ binding?: string }>;
};

type CliOptions = { envFile?: string; wranglerFile: string };

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

function hasResourceBinding(
  bindings: Array<{ binding?: string }> | undefined,
  name: string,
): boolean {
  return bindings?.some((item) => item.binding === name) ?? false;
}

function deploymentProbe(
  env: Record<string, unknown>,
  template: WranglerTemplate,
): Record<string, unknown> {
  const probe = { ...env };

  if (hasResourceBinding(template.r2_buckets, "DOCUMENTS_BUCKET")) {
    probe.DOCUMENTS_BUCKET = {
      delete() {},
      get() {},
      head() {},
      put() {},
    };
  }
  if (hasResourceBinding(template.hyperdrive, "HYPERDRIVE")) {
    probe.HYPERDRIVE = { connectionString: "postgres://declared-hyperdrive-binding" };
  }

  return probe;
}

try {
  const options = getOptions(process.argv.slice(2));
  const env = loadEnvironment(options.envFile);
  const template = loadWranglerTemplate(options.wranglerFile);
  const readiness = getRuntimeReadiness(deploymentProbe(env, template));
  const missing = readiness.missing.map((name) => (name === "DATABASE_URL" ? "HYPERDRIVE" : name));

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
