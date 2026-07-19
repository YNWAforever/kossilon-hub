import { describe, expect, it, vi } from "vitest";

import { createNeonAuthProxy } from "./neon-auth-proxy";

describe("Neon Auth same-origin proxy", () => {
  it("forwards auth requests with only Neon cookies and rewrites the session cookie first-party", async () => {
    const fetcher = vi.fn(async () => {
      return new Response('{"ok":true}', {
        status: 200,
        headers: {
          "content-type": "application/json",
          "set-cookie":
            "__Secure-neon-auth.session_token=signed; Domain=auth.example.test; Path=/; SameSite=Lax; Secure; HttpOnly",
        },
      });
    });
    const proxy = createNeonAuthProxy({
      baseUrl: "https://auth.example.test/tenant/auth/",
      fetcher,
    });
    const request = new Request("https://app.example.test/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: {
        cookie: "theme=dark; __Secure-neon-auth.session_token=old",
        origin: "https://app.example.test",
        "content-type": "application/json",
      },
      body: '{"email":"admin@example.test"}',
    });

    const response = await proxy(request);

    expect(fetcher).toHaveBeenCalledOnce();
    const [[upstreamUrl, init]] = fetcher.mock.calls as unknown as [[URL, RequestInit]];
    expect(upstreamUrl.toString()).toBe("https://auth.example.test/tenant/auth/sign-in/magic-link");
    expect(init).toMatchObject({ method: "POST", body: '{"email":"admin@example.test"}' });
    const headers = init?.headers as Headers;
    expect(headers.get("cookie")).toBe("__Secure-neon-auth.session_token=old");
    expect(headers.get("origin")).toBe("https://app.example.test");
    expect(headers.get("x-neon-auth-middleware")).toBe("true");

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("__Secure-neon-auth.session_token=signed");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Strict");
    expect(response.headers.get("set-cookie")).not.toContain("Domain=");
  });

  it("rejects requests outside the auth proxy path", async () => {
    const proxy = createNeonAuthProxy({
      baseUrl: "https://auth.example.test/tenant/auth",
      fetcher: vi.fn(),
    });

    await expect(proxy(new Request("https://app.example.test/login"))).rejects.toThrow(
      /auth proxy path/i,
    );
  });
});
