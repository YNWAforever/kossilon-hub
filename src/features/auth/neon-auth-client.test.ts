import { describe, expect, it, vi } from "vitest";

const createAuthClient = vi.hoisted(() => vi.fn());
const magicLinkClient = vi.hoisted(() => vi.fn(() => ({ id: "magic-link" })));

vi.mock("better-auth/client", () => ({ createAuthClient }));
vi.mock("better-auth/client/plugins", () => ({ magicLinkClient }));

import { createNeonAuthClient } from "./neon-auth-client";

describe("createNeonAuthClient", () => {
  it("configures Better Auth with a normalized HTTPS URL and magic-link plugin", () => {
    createNeonAuthClient("https://auth.example.test/");

    expect(createAuthClient).toHaveBeenCalledWith({
      baseURL: "https://auth.example.test",
      plugins: [{ id: "magic-link" }],
    });
    expect(magicLinkClient).toHaveBeenCalledOnce();
  });
});
