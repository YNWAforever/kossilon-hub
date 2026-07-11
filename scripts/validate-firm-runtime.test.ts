import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";
import { parse } from "jsonc-parser";

const projectRoot = resolve(import.meta.dirname, "..");
const temporaryDirectories: string[] = [];

function runValidator(args: string[]) {
  return spawnSync(
    process.execPath,
    ["--experimental-strip-types", "scripts/validate-firm-runtime.ts", ...args],
    { cwd: projectRoot, encoding: "utf8" },
  );
}

function createEnvFile(contents: string): string {
  const directory = mkdtempSync(join(tmpdir(), "kossilon-runtime-"));
  temporaryDirectories.push(directory);
  const path = join(directory, ".env");
  writeFileSync(path, contents, "utf8");
  return path;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("firm runtime deployment validation", () => {
  it("declares fixed non-secret firm configuration and resource bindings", () => {
    const template = parse(readFileSync(join(projectRoot, "wrangler.template.jsonc"), "utf8"));

    expect(template.vars).toMatchObject({
      FIRM_ID: "${FIRM_ID}",
      NEON_AUTH_URL: "${NEON_AUTH_URL}",
      WOZTELL_API_BASE_URL: "${WOZTELL_API_BASE_URL}",
      WOZTELL_CHANNEL_ID: "${WOZTELL_CHANNEL_ID}",
      EMAIL_FROM: "${EMAIL_FROM}",
    });
    expect(template.r2_buckets).toContainEqual(
      expect.objectContaining({ binding: "DOCUMENTS_BUCKET" }),
    );
    expect(template.hyperdrive).toContainEqual(expect.objectContaining({ binding: "HYPERDRIVE" }));
  });

  it("reports missing config names without treating declared resources as dotenv", () => {
    const result = runValidator([
      "--env-file",
      ".env.example",
      "--wrangler-file",
      "wrangler.template.jsonc",
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr.trim().split(/\r?\n/).slice(1)).toEqual([
      "- FIRM_ID",
      "- NEON_AUTH_URL",
      "- NEON_AUTH_COOKIE_SECRET",
      "- WOZTELL_API_BASE_URL",
      "- WOZTELL_ACCESS_TOKEN",
      "- WOZTELL_CHANNEL_ID",
      "- WOZTELL_WEBHOOK_SECRET",
      "- EMAIL_FROM",
    ]);
    expect(result.stderr).not.toContain("DOCUMENTS_BUCKET");
    expect(result.stderr).not.toContain("DATABASE_URL");
  });

  it("can validate a complete deployment manifest without printing secrets", () => {
    const cookieSecret = "cookie-secret-value-at-least-32-characters";
    const accessToken = "whatsapp-access-token";
    const webhookSecret = "whatsapp-webhook-secret";
    const envFile = createEnvFile(`
FIRM_ID=firm-a
NEON_AUTH_URL=https://firm-a.example.neon.tech/auth
NEON_AUTH_COOKIE_SECRET=${cookieSecret}
WOZTELL_API_BASE_URL=https://api.example.test
WOZTELL_ACCESS_TOKEN=${accessToken}
WOZTELL_CHANNEL_ID=test-channel
WOZTELL_WEBHOOK_SECRET=${webhookSecret}
EMAIL_FROM=operations@example.test
`);

    const result = runValidator([
      "--env-file",
      envFile,
      "--wrangler-file",
      "wrangler.template.jsonc",
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Firm runtime deployment is ready.");
    expect(`${result.stdout}${result.stderr}`).not.toContain(cookieSecret);
    expect(`${result.stdout}${result.stderr}`).not.toContain(accessToken);
    expect(`${result.stdout}${result.stderr}`).not.toContain(webhookSecret);
  });
});
