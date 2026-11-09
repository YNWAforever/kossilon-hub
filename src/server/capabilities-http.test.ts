import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { runtimeCapabilities } from "./capabilities-http";

const FULLY_PROVISIONED = {
  FIRM_ID: "kossilon",
  DATABASE_URL: "postgres://must-not-appear",
  NEON_AUTH_URL: "https://auth.example.test",
  NEON_AUTH_COOKIE_SECRET: "must-not-appear",
  R2_ACCOUNT_ID: "account",
  R2_ACCESS_KEY_ID: "must-not-appear",
  R2_SECRET_ACCESS_KEY: "must-not-appear",
  R2_BUCKET_NAME: "documents",
  RESEND_API_KEY: "must-not-appear",
  EMAIL_FROM: "no-reply@example.test",
  WOZTELL_API_BASE_URL: "https://woztell.example.test",
  WOZTELL_ACCESS_TOKEN: "must-not-appear",
  WOZTELL_CHANNEL_ID: "channel",
  WOZTELL_WEBHOOK_SECRET: "must-not-appear",
  DOCUMENT_SCANNER_URL: "https://scanner.example.test",
  DOCUMENT_SCANNER_API_KEY: "must-not-appear",
  MAINTENANCE_SCHEDULER_OWNER: "vercel",
  CRON_SECRET: "must-not-appear-but-long-enough",
};

describe("runtime capabilities", () => {
  it("reports everything configured when the bindings exist", () => {
    const { capabilities } = runtimeCapabilities(FULLY_PROVISIONED);

    expect(capabilities.every((capability) => capability.configured)).toBe(true);
    expect(capabilities.every((capability) => capability.missing.length === 0)).toBe(true);
  });

  it("names missing bindings without leaking values", () => {
    const { capabilities } = runtimeCapabilities({
      FIRM_ID: "kossilon",
      DATABASE_URL: "postgres://user:secret@host/db",
    });
    const text = JSON.stringify(capabilities);

    expect(text).not.toContain("postgres://");
    expect(text).not.toContain("secret");
    expect(capabilities.find((item) => item.id === "firm")?.configured).toBe(true);
    expect(capabilities.find((item) => item.id === "auth")?.missing).toEqual([
      "NEON_AUTH_URL",
      "NEON_AUTH_COOKIE_SECRET",
    ]);
    expect(capabilities.find((item) => item.id === "whatsapp")?.configured).toBe(false);
  });

  it("accepts either the Workers bucket binding or the R2 S3 trio on Vercel", () => {
    const workers = runtimeCapabilities({ DOCUMENTS_BUCKET: "bucket" });
    const vercel = runtimeCapabilities({
      R2_ACCOUNT_ID: "a",
      R2_ACCESS_KEY_ID: "b",
      R2_SECRET_ACCESS_KEY: "c",
      R2_BUCKET_NAME: "documents",
    });

    expect(workers.capabilities.find((item) => item.id === "documents")?.configured).toBe(true);
    expect(vercel.capabilities.find((item) => item.id === "documents")?.configured).toBe(true);
  });

  it("requires a sender as well as the Resend key", () => {
    const { capabilities } = runtimeCapabilities({ RESEND_API_KEY: "key" });
    const email = capabilities.find((item) => item.id === "email");

    expect(email?.configured).toBe(false);
    expect(email?.missing).toEqual(["EMAIL_FROM|RESEND_FROM"]);

    const withSender = runtimeCapabilities({ RESEND_API_KEY: "key", RESEND_FROM: "x@y.test" });
    expect(withSender.capabilities.find((item) => item.id === "email")?.configured).toBe(true);
  });

  it("treats the scheduler as configured only for the Vercel owner with a secret", () => {
    const wrongOwner = runtimeCapabilities({
      MAINTENANCE_SCHEDULER_OWNER: "cloudflare",
      CRON_SECRET: "secret",
    });
    expect(wrongOwner.capabilities.find((item) => item.id === "scheduler")?.missing).toEqual([
      "MAINTENANCE_SCHEDULER_OWNER=vercel",
    ]);
  });

  it("is served from the worker entry", () => {
    const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
    expect(server).toContain('pathname === "/api/capabilities"');
    expect(server).toContain("runtimeCapabilities");
  });
});
