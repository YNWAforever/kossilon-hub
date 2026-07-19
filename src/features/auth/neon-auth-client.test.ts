import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createAuthClient = vi.hoisted(() => vi.fn());
const magicLinkClient = vi.hoisted(() => vi.fn(() => ({ id: "magic-link" })));

vi.mock("better-auth/client", () => ({ createAuthClient }));
vi.mock("better-auth/client/plugins", () => ({ magicLinkClient }));

import { createNeonAuthClient } from "./neon-auth-client";

describe("createNeonAuthClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("routes Better Auth through the app origin and keeps the magic-link plugin", () => {
    createNeonAuthClient("https://auth.example.test/", "https://app.example.test/");

    expect(createAuthClient).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: "https://app.example.test/api/auth",
        plugins: [{ id: "magic-link" }],
      }),
    );
    expect(magicLinkClient).toHaveBeenCalledOnce();
  });

  it("exchanges the callback verifier through get-session and removes it after success", async () => {
    const replaceState = vi.fn();
    vi.stubGlobal("window", {
      location: {
        href: "https://app.example.test/login?neon_auth_session_verifier=verified-token",
        origin: "https://app.example.test",
        search: "?neon_auth_session_verifier=verified-token",
      },
    });
    vi.stubGlobal("history", { replaceState, state: { preserved: true } });

    createNeonAuthClient("https://auth.example.test/", "https://app.example.test/");

    const config = createAuthClient.mock.calls[0][0];
    const request = { url: new URL("https://app.example.test/api/auth/get-session") };
    const updatedRequest = (await config.fetchOptions.onRequest(request)) ?? request;

    expect(updatedRequest.url.searchParams.get("neon_auth_session_verifier")).toBe(
      "verified-token",
    );

    await config.fetchOptions.onSuccess({ request: updatedRequest });
    expect(replaceState).toHaveBeenCalledWith(
      { preserved: true },
      "",
      "https://app.example.test/login",
    );
  });
});
