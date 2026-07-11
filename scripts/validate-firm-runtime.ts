import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parse } from "dotenv";

import { getRuntimeReadiness } from "../src/server/runtime-env.ts";

function getEnvFileArgument(args: string[]): string | undefined {
  const index = args.indexOf("--env-file");
  if (index === -1) return undefined;

  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error("--env-file requires a file path");
  }

  return value;
}

function loadEnvironment(envFile: string | undefined): Record<string, unknown> {
  if (!envFile) return process.env;

  return parse(readFileSync(resolve(envFile), "utf8"));
}

try {
  const envFile = getEnvFileArgument(process.argv.slice(2));
  const readiness = getRuntimeReadiness(loadEnvironment(envFile));

  if (!readiness.ready) {
    console.error("Runtime is missing required production bindings:");
    for (const binding of readiness.missing) console.error(`- ${binding}`);
    process.exitCode = 1;
  } else {
    console.log("Firm runtime bindings are ready.");
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "Validation failed";
  console.error(message);
  process.exitCode = 1;
}
