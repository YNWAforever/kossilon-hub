import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  DEMO_SEED_CLI_FAILURE_MESSAGE,
  readDemoSeedConfig,
  runDemoSeed,
  runDemoSeedCli,
  type DemoSeedConfig,
} from "./db-seed-neon-auth-demo";

const demoHost = "demo.example.test";
const demoDatabaseName = "kossilon_demo";
const demoProtocol = "postgresql";
const urlSeparator = [":", "//"].join("");
const demoFirmId = "demo-firm-id";

function databaseUrl(
  protocol = demoProtocol,
  host = demoHost,
  databaseName = demoDatabaseName,
  query = "",
  rootPath = false,
) {
  const path = databaseName ? `/${databaseName}` : rootPath ? "/" : "";
  return `${protocol}${urlSeparator}${host}${path}${query}`;
}

function demoAuthUserId() {
  return ["demo", "operator"].join("-");
}

function demoEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    DEMO_DATABASE_URL: databaseUrl(),
    DEMO_AUTH_USER_ID: demoAuthUserId(),
    DEMO_FIRM_ID: demoFirmId,
    PRODUCTION_DATABASE_URL: databaseUrl(demoProtocol, "production.example.test", demoDatabaseName),
    ...overrides,
  };
}

describe("Neon Auth demo seed configuration", () => {
  it("requires the operator-only production database identity before a demo database can be used", () => {
    expect(() =>
      readDemoSeedConfig(demoEnv({ PRODUCTION_DATABASE_URL: undefined })).toThrow(
        "PRODUCTION_DATABASE_URL is required.",
      ),
    );
  });

  it.each(["DEMO_DATABASE_URL", "DEMO_AUTH_USER_ID", "DEMO_FIRM_ID"] as const)(
    "rejects a missing required %s value without disclosing configuration values",
    (variableName) => {
      const secret = "secret-value-that-must-not-leak";
      const environment = demoEnv({ [variableName]: undefined });

      expect(() => readDemoSeedConfig({ ...environment, UNUSED_SECRET: secret })).toThrow(
        `${variableName} is required.`,
      );
      expect(() => readDemoSeedConfig({ ...environment, UNUSED_SECRET: secret })).not.toThrow(
        secret,
      );
    },
  );

  it.each(["DEMO_DATABASE_URL", "DEMO_AUTH_USER_ID", "DEMO_FIRM_ID"] as const)(
    "rejects a whitespace-only %s value",
    (variableName) => {
      expect(() => readDemoSeedConfig(demoEnv({ [variableName]: "   " }))).toThrow(
        `${variableName} is required.`,
      );
    },
  );

  it("rejects a non-Postgres demo database URL without exposing it", () => {
    const unsafeUrl = databaseUrl("https");

    expect(() => readDemoSeedConfig(demoEnv({ DEMO_DATABASE_URL: unsafeUrl }))).toThrow(
      "DEMO_DATABASE_URL must use the postgres: or postgresql: scheme.",
    );
    expect(() => readDemoSeedConfig(demoEnv({ DEMO_DATABASE_URL: unsafeUrl }))).not.toThrow(
      unsafeUrl,
    );
  });

  it.each([
    ["a malformed Postgres URL", [demoProtocol, urlSeparator, "["].join("")],
    ["a Postgres URL with no host", databaseUrl(demoProtocol, "", demoDatabaseName)],
  ])("rejects %s without exposing it", (_description, unsafeUrl) => {
    expect(() => readDemoSeedConfig(demoEnv({ DEMO_DATABASE_URL: unsafeUrl }))).toThrow(
      "DEMO_DATABASE_URL must be a valid PostgreSQL URL.",
    );
    expect(() => readDemoSeedConfig(demoEnv({ DEMO_DATABASE_URL: unsafeUrl }))).not.toThrow(
      unsafeUrl,
    );
  });

  it.each([
    ["DEMO_DATABASE_URL", databaseUrl(demoProtocol, demoHost, "", "", true)],
    ["DEMO_DATABASE_URL", databaseUrl(demoProtocol, demoHost, "")],
    ["PRODUCTION_DATABASE_URL", databaseUrl("postgres", demoHost, "", "", true)],
    ["PRODUCTION_DATABASE_URL", databaseUrl("postgres", demoHost, "")],
  ] as const)("rejects %s without an explicit database path", (variableName, databaseUrlValue) => {
    expect(() => readDemoSeedConfig(demoEnv({ [variableName]: databaseUrlValue }))).toThrow(
      `${variableName} must include a non-empty database path.`,
    );
    expect(() => readDemoSeedConfig(demoEnv({ [variableName]: databaseUrlValue }))).not.toThrow(
      databaseUrlValue,
    );
  });

  it("rejects a demo URL that identifies the configured production database after normalization", () => {
    expect(() =>
      readDemoSeedConfig(
        demoEnv({
          PRODUCTION_DATABASE_URL: databaseUrl(
            "postgres",
            demoHost.toUpperCase(),
            demoDatabaseName,
            "?application_name=production",
          ),
        }),
      ),
    ).toThrow("DEMO_DATABASE_URL must not identify the configured production database.");
  });

  it.each([
    [
      "same Neon direct and pooler endpoints",
      databaseUrl(demoProtocol, "demo-project-pooler.neon.tech", demoDatabaseName),
      databaseUrl(demoProtocol, "demo-project.neon.tech", demoDatabaseName),
    ],
    [
      "an omitted and explicit default port",
      databaseUrl(demoProtocol, demoHost, demoDatabaseName),
      databaseUrl(demoProtocol, `${demoHost}:5432`, demoDatabaseName),
    ],
    [
      "encoded and decoded database paths",
      databaseUrl(demoProtocol, demoHost, "kossilon%5Fdemo"),
      databaseUrl(demoProtocol, demoHost, demoDatabaseName),
    ],
  ])(
    "rejects %s after canonical database identity comparison",
    (_description, demoUrl, productionUrl) => {
      expect(() =>
        readDemoSeedConfig(
          demoEnv({
            DEMO_DATABASE_URL: demoUrl,
            PRODUCTION_DATABASE_URL: productionUrl,
          }),
        ),
      ).toThrow("DEMO_DATABASE_URL must not identify the configured production database.");
    },
  );

  it("allows a distinct Neon database project", () => {
    expect(() =>
      readDemoSeedConfig(
        demoEnv({
          DEMO_DATABASE_URL: databaseUrl(demoProtocol, "demo-project.neon.tech", demoDatabaseName),
          PRODUCTION_DATABASE_URL: databaseUrl(
            demoProtocol,
            "production-project.neon.tech",
            demoDatabaseName,
          ),
        }),
      ),
    ).not.toThrow();
  });
  it("returns internal seed values with a separate redacted summary", () => {
    const config = readDemoSeedConfig(demoEnv());

    type PasswordConfigurationKey = Extract<keyof DemoSeedConfig, `${string}password${string}`>;
    expectTypeOf<PasswordConfigurationKey>().toEqualTypeOf<never>();
    expect(config).toMatchObject({
      databaseUrl: databaseUrl(),
      authUserId: demoAuthUserId(),
      firmId: demoFirmId,
      redactedSummary: {
        DEMO_DATABASE_URL: "configured",
        DEMO_AUTH_USER_ID: "configured",
        DEMO_FIRM_ID: "configured",
        PRODUCTION_DATABASE_URL: "configured",
      },
    });
    expect(Object.keys(config)).not.toContain("password");
    expect(JSON.stringify(config.redactedSummary)).not.toContain(databaseUrl());
    expect(JSON.stringify(config.redactedSummary)).not.toContain(demoAuthUserId());
  });
});

describe("Neon Auth demo seed runner", () => {
  it("creates one demo client, delegates once to the reusable seed, and closes it", async () => {
    const config = readDemoSeedConfig(demoEnv());
    const client = { end: vi.fn().mockResolvedValue(undefined), begin: vi.fn() };
    const createSqlClient = vi.fn().mockReturnValue(client);
    const seedAnnualReturn = vi.fn().mockResolvedValue(undefined);
    const writeSuccess = vi.fn();

    await runDemoSeed(config, { createSqlClient, seedAnnualReturn, writeSuccess });

    expect(createSqlClient).toHaveBeenCalledTimes(1);
    expect(createSqlClient).toHaveBeenCalledWith(databaseUrl(), { max: 1 });
    expect(seedAnnualReturn).toHaveBeenCalledTimes(1);
    expect(seedAnnualReturn).toHaveBeenCalledWith(client, { adminAuthUserId: demoAuthUserId() });
    expect(client.begin).not.toHaveBeenCalled();
    expect(client.end).toHaveBeenCalledTimes(1);
    expect(writeSuccess).toHaveBeenCalledWith(
      `Seeded annual return demo data for DEMO_FIRM_ID=${demoFirmId}.`,
    );
    expect(writeSuccess.mock.calls.flat().join(" ")).not.toContain(databaseUrl());
    expect(writeSuccess.mock.calls.flat().join(" ")).not.toContain(demoAuthUserId());
  });

  it("closes the one demo client when the reusable seed fails", async () => {
    const client = { end: vi.fn().mockResolvedValue(undefined) };
    const seedFailure = new Error("seed failed");

    await expect(
      runDemoSeed(readDemoSeedConfig(demoEnv()), {
        createSqlClient: vi.fn().mockReturnValue(client),
        seedAnnualReturn: vi.fn().mockRejectedValue(seedFailure),
        writeSuccess: vi.fn(),
      }),
    ).rejects.toThrow(seedFailure);
    expect(client.end).toHaveBeenCalledTimes(1);
  });

  it("propagates cleanup failures after a successful reusable seed", async () => {
    const cleanupFailure = new Error("cleanup failed");
    const client = { end: vi.fn().mockRejectedValue(cleanupFailure) };

    await expect(
      runDemoSeed(readDemoSeedConfig(demoEnv()), {
        createSqlClient: vi.fn().mockReturnValue(client),
        seedAnnualReturn: vi.fn().mockResolvedValue(undefined),
        writeSuccess: vi.fn(),
      }),
    ).rejects.toThrow(cleanupFailure);
    expect(client.end).toHaveBeenCalledTimes(1);
  });
});

describe("Neon Auth demo seed CLI boundary", () => {
  it("returns success without writing an error when the seed succeeds", async () => {
    const writeFailure = vi.fn();
    const runSeed = vi.fn().mockResolvedValue(undefined);

    await expect(
      runDemoSeedCli({
        loadEnvironment: vi.fn().mockResolvedValue(demoEnv()),
        readConfig: vi.fn().mockReturnValue(readDemoSeedConfig(demoEnv())),
        runSeed,
        writeFailure,
      }),
    ).resolves.toBe(0);
    expect(runSeed).toHaveBeenCalledTimes(1);
    expect(writeFailure).not.toHaveBeenCalled();
  });

  it("redacts a provider failure containing database and Auth identities", async () => {
    const writeFailure = vi.fn();
    const providerFailure = new Error(
      `Provider rejected ${databaseUrl()} for Auth user ${demoAuthUserId()}.`,
    );

    await expect(
      runDemoSeedCli({
        loadEnvironment: vi.fn().mockResolvedValue(demoEnv()),
        readConfig: vi.fn().mockReturnValue(readDemoSeedConfig(demoEnv())),
        runSeed: vi.fn().mockRejectedValue(providerFailure),
        writeFailure,
      }),
    ).resolves.toBe(1);
    expect(writeFailure).toHaveBeenCalledWith(DEMO_SEED_CLI_FAILURE_MESSAGE);
    expect(writeFailure.mock.calls.flat().join(" ")).not.toContain(databaseUrl());
    expect(writeFailure.mock.calls.flat().join(" ")).not.toContain(demoAuthUserId());
  });

  it("redacts a cleanup failure", async () => {
    const writeFailure = vi.fn();

    await expect(
      runDemoSeedCli({
        loadEnvironment: vi.fn().mockResolvedValue(demoEnv()),
        readConfig: vi.fn().mockReturnValue(readDemoSeedConfig(demoEnv())),
        runSeed: vi.fn().mockRejectedValue(new Error("cleanup failed")),
        writeFailure,
      }),
    ).resolves.toBe(1);
    expect(writeFailure).toHaveBeenCalledTimes(1);
    expect(writeFailure).toHaveBeenCalledWith(DEMO_SEED_CLI_FAILURE_MESSAGE);
  });
});

describe("Neon Auth demo runbook", () => {
  it("binds validation, migration, and seed to the same approved environment file", async () => {
    const runbook = await readFile(
      fileURLToPath(new URL("../docs/runbooks/neon-auth-demo.md", import.meta.url)),
      "utf8",
    );
    const approvedEnvFile = "<approved-demo-env-file>";

    expect(runbook).toContain(`npm run validate:neon-auth-demo -- --env-file ${approvedEnvFile}`);
    expect(runbook).toContain(`bun --env-file="${approvedEnvFile}" scripts/db-migrate.ts`);
    expect(runbook).toContain(
      `bun --env-file="${approvedEnvFile}" scripts/db-seed-neon-auth-demo.ts`,
    );
    expect(runbook).not.toContain("npm.cmd run db:migrate");
    expect(runbook).not.toContain("npm.cmd run db:seed:neon-auth-demo");
  });
});
