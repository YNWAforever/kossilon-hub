import { afterEach, describe, expect, it, vi } from "vitest";

describe("database client", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("does not require DATABASE_URL while importing the module", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const client = await import("./client");

    expect(client.getDatabaseUrl).toThrow(
      "DATABASE_URL is required for Annual Return Control Center data access.",
    );
  });
});
