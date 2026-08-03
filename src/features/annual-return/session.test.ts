import { afterEach, describe, expect, it, vi } from "vitest";
import { getCurrentAnnualReturnActorId } from "./session";

const STAFF_ACTOR_ID = "20000000-0000-0000-0000-000000000003";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("annual return session actor", () => {
  it("reads the configured server-side actor id", () => {
    vi.stubEnv("KOSSILON_ACTOR_ID", "");
    vi.stubEnv("KOSSILON_ANNUAL_RETURN_ACTOR_ID", STAFF_ACTOR_ID);

    expect(getCurrentAnnualReturnActorId()).toBe(STAFF_ACTOR_ID);
  });

  it("fails closed when no actor is configured", () => {
    vi.stubEnv("KOSSILON_ACTOR_ID", "");
    vi.stubEnv("KOSSILON_ANNUAL_RETURN_ACTOR_ID", "");

    expect(() => getCurrentAnnualReturnActorId()).toThrow(/actor is not configured/i);
  });
});
