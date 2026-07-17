import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  DATABASE_URL,
  DEMO_AUTH_USER_ID,
  DEMO_DATABASE_URL,
  DEMO_FIRM_ID,
  FIRM_ID,
  NEON_AUTH_COOKIE_SECRET,
  NEON_AUTH_URL,
  PRODUCTION_DATABASE_URL,
  PRODUCTION_NEON_AUTH_URL,
  formatValidationOutput,
  getCliOptions,
  loadEnvironment,
  validateNeonAuthDemoEnvironment,
} from "./validate-neon-auth-demo";

const temporaryDirectories: string[] = [];

function validEnvironment(): Record<string, string> {
  return {
    [FIRM_ID]: "kossilon-demo",
    [DEMO_FIRM_ID]: "kossilon-demo",
    [DEMO_AUTH_USER_ID]: "demo-auth-user-id",
    [NEON_AUTH_URL]: ["https:", "//", "auth.example.test"].join(""),
    [NEON_AUTH_COOKIE_SECRET]: randomUUID(),
    [DATABASE_URL]: ["postgresql:", "//", "demo.example.test/kossilon_demo"].join(""),
    [DEMO_DATABASE_URL]: ["postgresql:", "//", "demo.example.test/kossilon_demo"].join(""),
    [PRODUCTION_DATABASE_URL]: ["postgresql:", "//", "production.example.test/kossilon_demo"].join(
      "",
    ),
    [PRODUCTION_NEON_AUTH_URL]: ["https:", "//", "production-auth.example.test"].join(""),
  };
}

function createEnvFile(contents: string): string {
  const directory = mkdtempSync(join(tmpdir(), "kossilon-neon-auth-demo-"));
  temporaryDirectories.push(directory);
  const path = join(directory, ".env");
  writeFileSync(path, contents, "utf8");
  return path;
}

function runCliWithEnvFile(envFile: string): string {
  try {
    execFileSync(
      process.execPath,
      [
        "--experimental-strip-types",
        "scripts/validate-neon-auth-demo.ts",
        "--",
        "--env-file",
        envFile,
      ],
      { cwd: process.cwd(), encoding: "utf8", stdio: "pipe" },
    );
    return "";
  } catch (error) {
    return String((error as { stderr?: unknown }).stderr ?? "");
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("Neon Auth demo runtime validation", () => {
  it("requires operator-only production identities", () => {
    const environment = validEnvironment();
    delete environment[PRODUCTION_DATABASE_URL];
    delete environment[PRODUCTION_NEON_AUTH_URL];
    const checks = validateNeonAuthDemoEnvironment(environment).checks;

    expect(checks).toContainEqual({ name: PRODUCTION_DATABASE_URL, status: "missing" });
    expect(checks).toContainEqual({ name: PRODUCTION_NEON_AUTH_URL, status: "missing" });
  });

  it("reports each required binding as missing without exposing values", () => {
    const result = validateNeonAuthDemoEnvironment({});

    expect(result).toEqual({
      checks: [
        { name: FIRM_ID, status: "missing" },
        { name: DEMO_FIRM_ID, status: "missing" },
        { name: DEMO_AUTH_USER_ID, status: "missing" },
        { name: NEON_AUTH_URL, status: "missing" },
        { name: NEON_AUTH_COOKIE_SECRET, status: "missing" },
        { name: DATABASE_URL, status: "missing" },
        { name: DEMO_DATABASE_URL, status: "missing" },
        { name: PRODUCTION_DATABASE_URL, status: "missing" },
        { name: PRODUCTION_NEON_AUTH_URL, status: "missing" },
        { name: "VITE_ENABLE_DEMO_AUTH", status: "pass" },
        { name: "VITE_PROVIDER_MODE", status: "missing" },
      ],
    });
    expect(Object.keys(result)).toEqual(["checks"]);
  });

  it("trims required values and accepts the intended demo firm", () => {
    const environment = validEnvironment();
    environment[FIRM_ID] = "  kossilon-demo  ";
    environment[NEON_AUTH_URL] = "  https://auth.example.test  ";

    const result = validateNeonAuthDemoEnvironment(environment);

    expect(result).toEqual({
      checks: [
        { name: FIRM_ID, status: "pass" },
        { name: DEMO_FIRM_ID, status: "pass" },
        { name: DEMO_AUTH_USER_ID, status: "pass" },
        { name: NEON_AUTH_URL, status: "pass" },
        { name: NEON_AUTH_COOKIE_SECRET, status: "pass" },
        { name: DATABASE_URL, status: "pass" },
        { name: DEMO_DATABASE_URL, status: "pass" },
        { name: PRODUCTION_DATABASE_URL, status: "pass" },
        { name: PRODUCTION_NEON_AUTH_URL, status: "pass" },
        { name: "VITE_ENABLE_DEMO_AUTH", status: "pass" },
        { name: "VITE_PROVIDER_MODE", status: "missing" },
      ],
    });
    expect(Object.keys(result)).toEqual(["checks"]);
  });

  it("requires simulated provider mode for the isolated demo", () => {
    const missing = validEnvironment();
    expect(validateNeonAuthDemoEnvironment(missing).checks).toContainEqual({
      name: "VITE_PROVIDER_MODE",
      status: "missing",
    });

    const live = { ...validEnvironment(), VITE_PROVIDER_MODE: "live" };
    expect(validateNeonAuthDemoEnvironment(live).checks).toContainEqual({
      name: "VITE_PROVIDER_MODE",
      status: "fail",
    });

    const simulated = { ...validEnvironment(), VITE_PROVIDER_MODE: "simulated" };
    expect(validateNeonAuthDemoEnvironment(simulated).checks).toContainEqual({
      name: "VITE_PROVIDER_MODE",
      status: "pass",
    });
  });

  it("requires a valid HTTPS Neon Auth URL", () => {
    const environment = validEnvironment();
    environment[NEON_AUTH_URL] = "http://auth.example.test";

    expect(validateNeonAuthDemoEnvironment(environment).checks).toContainEqual({
      name: NEON_AUTH_URL,
      status: "fail",
    });
  });

  it.each(["", "${FIRM_ID}", "placeholder", "changeme", "your-firm-id"])(
    "rejects an unsafe firm ID: %s",
    (firmId) => {
      const environment = validEnvironment();
      environment[FIRM_ID] = firmId;

      expect(validateNeonAuthDemoEnvironment(environment).checks).toContainEqual({
        name: FIRM_ID,
        status: firmId ? "fail" : "missing",
      });
    },
  );

  it("requires the exact demo firm ID", () => {
    const environment = validEnvironment();
    environment[FIRM_ID] = "customer-demo-west";

    expect(validateNeonAuthDemoEnvironment(environment).checks).toContainEqual({
      name: FIRM_ID,
      status: "fail",
    });
  });

  it("rejects matching canonical production database and Auth identities", () => {
    const databaseEnvironment = validEnvironment();
    databaseEnvironment[DATABASE_URL] = [
      "postgresql:",
      "//",
      "demo-project-pooler.neon.tech/kossilon_demo",
    ].join("");
    databaseEnvironment[PRODUCTION_DATABASE_URL] = [
      "postgresql:",
      "//",
      "demo-project.neon.tech:5432/kossilon_demo",
    ].join("");

    expect(validateNeonAuthDemoEnvironment(databaseEnvironment).checks).toContainEqual({
      name: DATABASE_URL,
      status: "fail",
    });

    const authEnvironment = validEnvironment();
    authEnvironment[NEON_AUTH_URL] = ["https:", "//", "AUTH.example.test:443/login/"].join("");
    authEnvironment[PRODUCTION_NEON_AUTH_URL] = [
      "https:",
      "//",
      "auth.example.test/login?environment=production#ignored",
    ].join("");

    expect(validateNeonAuthDemoEnvironment(authEnvironment).checks).toContainEqual({
      name: NEON_AUTH_URL,
      status: "fail",
    });
  });

  it("rejects mismatched migration and seed database identities", () => {
    const environment = {
      ...validEnvironment(),
      [DEMO_DATABASE_URL]: ["postgresql:", "//", "other.example.test/kossilon_demo"].join(""),
    };

    const checks = validateNeonAuthDemoEnvironment(environment).checks;

    expect(checks).toContainEqual({ name: DATABASE_URL, status: "fail" });
    expect(checks).toContainEqual({ name: DEMO_DATABASE_URL, status: "fail" });
  });

  it("requires a valid HTTPS production Neon Auth URL", () => {
    const environment = validEnvironment();
    environment[PRODUCTION_NEON_AUTH_URL] = ["http:", "//", "auth.example.test"].join("");

    expect(validateNeonAuthDemoEnvironment(environment).checks).toContainEqual({
      name: PRODUCTION_NEON_AUTH_URL,
      status: "fail",
    });
  });
  it.each([
    ["VITE_ENABLE_DEMO_AUTH", " TrUe "],
    ["VITE_PROVIDER_MODE", " LOCAL "],
  ])("rejects unsafe production flag %s", (name, value) => {
    const environment = validEnvironment();
    environment[name] = value;

    expect(validateNeonAuthDemoEnvironment(environment).checks).toContainEqual({
      name,
      status: "fail",
    });
  });

  it("formats only names and statuses, never configured values", () => {
    const environment = validEnvironment();
    const result = validateNeonAuthDemoEnvironment(environment);
    const output = formatValidationOutput(result);

    expect(output).toContain(`${FIRM_ID}: pass`);
    expect(output).not.toContain(environment[NEON_AUTH_URL]);
    expect(output).not.toContain(environment[NEON_AUTH_COOKIE_SECRET]);
    expect(output).not.toContain(environment[DATABASE_URL]);
  });

  it("parses --env-file with dotenv semantics and rejects a missing path", () => {
    const environment = validEnvironment();
    const envFile = createEnvFile(
      Object.entries(environment)
        .map(([name, value]) => `${name}=${value}`)
        .join("\n"),
    );

    expect(getCliOptions(["--env-file", envFile])).toEqual({ envFile });
    expect(loadEnvironment(envFile)).toMatchObject(environment);
    expect(() => getCliOptions(["--env-file"])).toThrow("--env-file requires a file path");
  });

  it.each(["missing", "directory"])(
    "redacts CLI startup errors for an unreadable --env-file: %s",
    (kind) => {
      const directory = mkdtempSync(join(tmpdir(), "kossilon-neon-auth-demo-"));
      temporaryDirectories.push(directory);
      const envFile = kind === "missing" ? join(directory, ".env") : directory;
      const output = runCliWithEnvFile(envFile);

      expect(output).toBe("Unable to load environment configuration.\n");
      expect(output).not.toContain(envFile);
    },
  );
});
