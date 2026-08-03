import { afterEach, describe, expect, it, vi } from "vitest";
import { getCurrentActorId } from "./actor";

describe("getCurrentActorId", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers KOSSILON_ACTOR_ID", () => {
    vi.stubEnv("KOSSILON_ACTOR_ID", "20000000-0000-0000-0000-000000000001");
    vi.stubEnv("KOSSILON_ANNUAL_RETURN_ACTOR_ID", "20000000-0000-0000-0000-000000000002");

    expect(getCurrentActorId()).toBe("20000000-0000-0000-0000-000000000001");
  });

  it("falls back to KOSSILON_ANNUAL_RETURN_ACTOR_ID", () => {
    vi.stubEnv("KOSSILON_ACTOR_ID", "");
    vi.stubEnv("KOSSILON_ANNUAL_RETURN_ACTOR_ID", "20000000-0000-0000-0000-000000000003");

    expect(getCurrentActorId()).toBe("20000000-0000-0000-0000-000000000003");
  });

  it("trims surrounding whitespace", () => {
    vi.stubEnv("KOSSILON_ACTOR_ID", "  20000000-0000-0000-0000-000000000004  ");

    expect(getCurrentActorId()).toBe("20000000-0000-0000-0000-000000000004");
  });

  it("throws when neither variable is set", () => {
    vi.stubEnv("KOSSILON_ACTOR_ID", "");
    vi.stubEnv("KOSSILON_ANNUAL_RETURN_ACTOR_ID", "");

    expect(() => getCurrentActorId()).toThrow(
      "KOSSILON_ACTOR_ID actor is not configured.",
    );
  });
});
