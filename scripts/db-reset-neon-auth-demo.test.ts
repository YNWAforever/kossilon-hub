import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { readDemoSeedConfig } from "./db-seed-neon-auth-demo";
import {
  DEMO_RESET_CLI_FAILURE_MESSAGE,
  readDemoResetOptions,
  runDemoReset,
  runDemoResetCli,
} from "./db-reset-neon-auth-demo";

describe("Neon Auth demo reset confirmation", () => {
  it("requires the exact demo firm in --confirm-firm", () => {
    expect(() => readDemoResetOptions([])).toThrow("--confirm-firm requires kossilon-demo.");
    expect(() => readDemoResetOptions(["--confirm-firm", "production"])).toThrow(
      "--confirm-firm requires kossilon-demo.",
    );
    expect(readDemoResetOptions(["--confirm-firm", "kossilon-demo"])).toEqual({
      confirmFirmId: "kossilon-demo",
    });
  });

  it("does not run or connect when confirmation fails", async () => {
    const runReset = vi.fn();
    const writeFailure = vi.fn();

    await expect(
      runDemoResetCli([], {
        loadEnvironment: vi.fn().mockResolvedValue({}),
        readConfig: vi.fn(),
        readOptions: readDemoResetOptions,
        runReset,
        writeFailure,
      }),
    ).resolves.toBe(1);
    expect(runReset).not.toHaveBeenCalled();
    expect(writeFailure).toHaveBeenCalledWith(DEMO_RESET_CLI_FAILURE_MESSAGE);
  });
});

describe("Neon Auth demo reset boundary", () => {
  it("truncates only public application tables, then reapplies the Admin seed", async () => {
    const config = readDemoSeedConfig({
      DEMO_DATABASE_URL: "postgresql://demo.example.test/kossilon_demo",
      DEMO_AUTH_USER_ID: "demo-admin-user",
      DEMO_FIRM_ID: "kossilon-demo",
      PRODUCTION_DATABASE_URL: "postgresql://production.example.test/kossilon_production",
    });
    const unsafe = vi.fn().mockResolvedValue(undefined);
    const begin = vi.fn(
      async (callback: (tx: { unsafe(query: string): Promise<void> }) => unknown) =>
        callback({ unsafe }),
    );
    const end = vi.fn().mockResolvedValue(undefined);
    const seedAnnualReturn = vi.fn().mockResolvedValue(undefined);
    const writeSuccess = vi.fn();

    await runDemoReset(config, {
      createSqlClient: vi.fn().mockReturnValue({ begin, end }),
      seedAnnualReturn,
      writeSuccess,
    });

    const statement = unsafe.mock.calls[0][0] as string;
    expect(statement).toContain("truncate table");
    expect(statement).toContain("public.notification_outbox");
    expect(statement).toContain("public.whatsapp_messages");
    expect(statement).not.toContain("schema_migrations");
    expect(statement).not.toContain("neon_auth");
    expect(seedAnnualReturn).toHaveBeenCalledWith(expect.anything(), {
      adminAuthUserId: config.authUserId,
    });
    expect(unsafe.mock.invocationCallOrder[0]).toBeLessThan(
      seedAnnualReturn.mock.invocationCallOrder[0],
    );
    expect(end).toHaveBeenCalledTimes(1);
    expect(writeSuccess).toHaveBeenCalledWith(
      "Reset Neon Auth demo data for DEMO_FIRM_ID=kossilon-demo.",
    );
  });
});

describe("Neon Auth demo reset runbook", () => {
  it("documents persistent simulated delivery and the guarded reset procedure", async () => {
    const runbook = await readFile(
      fileURLToPath(new URL("../docs/runbooks/neon-auth-demo.md", import.meta.url)),
      "utf8",
    );

    expect(runbook).toContain(
      'bun --env-file="$demoEnvFile" scripts/db-reset-neon-auth-demo.ts --confirm-firm kossilon-demo',
    );
    expect(runbook).toContain("Demo changes persist until an operator runs the guarded reset.");
    expect(runbook).toContain("No external WhatsApp or email message is sent.");
    expect(runbook).toContain("preserves `schema_migrations` and Neon Auth records");
    expect(runbook).toContain("reapplies deterministic seed data");
    expect(runbook).toContain("reuses `DEMO_AUTH_USER_ID` for the Admin mapping");
  });

  it("limits acceptance evidence to non-secret operational facts", async () => {
    const runbook = await readFile(
      fileURLToPath(new URL("../docs/runbooks/neon-auth-demo.md", import.meta.url)),
      "utf8",
    );

    expect(runbook).toContain(
      "Record only booleans, counts, deployment IDs, HTTP status codes, and route names.",
    );
    for (const forbiddenEvidence of [
      "credentials",
      "reset URLs",
      "connection strings",
      "Auth user IDs",
      "cookies",
      "request authorization headers",
    ]) {
      expect(runbook).toContain(forbiddenEvidence);
    }
  });
});
