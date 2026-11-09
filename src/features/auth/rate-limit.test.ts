import { describe, expect, it } from "vitest";

import {
  createMemoryRateLimiter,
  isRateLimitedAuthRequest,
  rateLimitKey,
  rateLimitResponse,
} from "./rate-limit";

describe("auth rate limiting", () => {
  it("allows up to the limit inside the window and then blocks with retry-after", () => {
    let now = 1_000_000;
    const limiter = createMemoryRateLimiter({ limit: 2, windowMs: 60_000, now: () => now });

    expect(limiter.consume("ip")).toEqual({ allowed: true, remaining: 1 });
    expect(limiter.consume("ip")).toEqual({ allowed: true, remaining: 0 });
    expect(limiter.consume("ip")).toEqual({ allowed: false, retryAfterSeconds: 60 });

    now += 60_000;
    expect(limiter.consume("ip")).toEqual({ allowed: true, remaining: 1 });
  });

  it("keeps independent buckets per key", () => {
    const now = 1_000_000;
    const limiter = createMemoryRateLimiter({ limit: 1, windowMs: 60_000, now: () => now });

    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("b").allowed).toBe(true);
    expect(limiter.consume("a").allowed).toBe(false);
  });

  it("reads the client IP from proxy headers without trusting an empty value", () => {
    expect(
      rateLimitKey(
        new Request("https://app.test/api/auth/sign-in/email", {
          headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" },
        }),
      ),
    ).toBe("203.0.113.9");
    expect(
      rateLimitKey(
        new Request("https://app.test/api/auth/sign-in/email", {
          headers: { "x-real-ip": "198.51.100.4" },
        }),
      ),
    ).toBe("198.51.100.4");
    expect(rateLimitKey(new Request("https://app.test/api/auth/sign-in/email"))).toBe("unknown");
  });

  it("only throttles POSTs to sensitive auth endpoints", () => {
    const post = (path: string) =>
      isRateLimitedAuthRequest(new Request(`https://app.test${path}`, { method: "POST" }));

    expect(post("/api/auth/sign-in/email")).toBe(true);
    expect(post("/api/auth/sign-in/magic-link")).toBe(true);
    expect(post("/api/auth/sign-in/social")).toBe(true);
    expect(post("/api/auth/forget-password")).toBe(true);
    expect(post("/api/auth/get-session")).toBe(false);
    expect(post("/api/webhooks/whatsapp")).toBe(false);
    expect(
      isRateLimitedAuthRequest(
        new Request("https://app.test/api/auth/sign-in/email", { method: "GET" }),
      ),
    ).toBe(false);
  });

  it("returns a 429 with retry-after and no-store", () => {
    const response = rateLimitResponse(37);

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("37");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
