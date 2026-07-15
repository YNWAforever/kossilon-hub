import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { readDemoSeedConfig, runDemoSeed, type DemoSeedConfig } from "./db-seed-neon-auth-demo";

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
    ...overrides,
  };
}

describe("Neon Auth demo seed configuration", () => {
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
        PRODUCTION_DATABASE_URL: "not provided",
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
});
