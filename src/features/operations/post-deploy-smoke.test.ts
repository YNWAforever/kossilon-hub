import { describe, expect, it } from "vitest";

import {
  demoChecks,
  formatSmokeResults,
  productionChecks,
  runSmokeChecks,
  type SmokeCheck,
} from "./post-deploy-smoke";

function response(body: string, status = 200): Response {
  return new Response(body, { status });
}

describe("post-deploy smoke checks", () => {
  it("covers the production entry, SEO, auth and health surfaces", () => {
    const checks = productionChecks("https://prod.test", "abc123");

    const urls = checks.map((check) => new URL(check.url).pathname);
    for (const path of [
      "/login",
      "/en/login",
      "/request-access",
      "/en/request-access",
      "/robots.txt",
      "/sitemap.xml",
      "/manifest.webmanifest",
      "/api/auth/ok",
      "/api/auth/sign-up/email",
      "/api/health",
      "/api/capabilities",
      "/api/version",
    ]) {
      expect(urls).toContain(path);
    }
    const version = checks.find((check) => check.name === "version");
    expect(version?.includes).toContain('"sha":"abc123"');
  });

  it("covers the demo fixture marker and entry redirect", () => {
    const checks = demoChecks("https://demo.test");
    expect(checks.map((check) => new URL(check.url).pathname)).toEqual([
      "/api/version",
      "/login",
      "/demo",
      "/",
      "/robots.txt",
    ]);
    expect(JSON.stringify(checks)).toContain("示範身份");
  });

  it("passes when every check matches", async () => {
    const checks: SmokeCheck[] = [
      { name: "a", url: "https://app.test/a", expectStatus: 200, includes: ["hello"] },
      { name: "b", url: "https://app.test/b", expectStatus: 200 },
    ];
    const fetcher = (async () => response("hello")) as unknown as typeof fetch;

    const result = await runSmokeChecks(fetcher, checks);
    expect(result.ok).toBe(true);
    expect(result.results.every((item) => item.ok)).toBe(true);
  });

  it("runs the signup-refusal probe as a POST and passes on 403 SIGNUP_DISABLED", async () => {
    let seen: { method?: string; body?: string } = {};
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen = { method: init?.method, body: typeof init?.body === "string" ? init.body : undefined };
      return response('{"code":"SIGNUP_DISABLED","message":"invite-only"}', 403);
    }) as unknown as typeof fetch;

    const result = await runSmokeChecks(fetcher, [
      {
        name: "auth-signup-disabled",
        url: "https://app.test/api/auth/sign-up/email",
        expectStatus: 403,
        method: "POST",
        body: JSON.stringify({ email: "probe@example.test" }),
        includes: ['"code":"SIGNUP_DISABLED"'],
      },
    ]);

    expect(result.ok).toBe(true);
    expect(seen.method).toBe("POST");
    expect(seen.body).toContain("probe@example.test");
  });

  it("fails loudly on status, missing text or unexpected text", async () => {
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/missing")) return response("nothing", 200);
      if (url.endsWith("/error")) return response("boom", 500);
      return response("secret", 200);
    }) as unknown as typeof fetch;

    const result = await runSmokeChecks(fetcher, [
      { name: "missing", url: "https://app.test/missing", expectStatus: 200, includes: ["hello"] },
      { name: "error", url: "https://app.test/error", expectStatus: 200 },
      { name: "unexpected", url: "https://app.test/ok", expectStatus: 200, excludes: ["secret"] },
    ]);

    expect(result.ok).toBe(false);
    expect(result.results[0].detail).toContain("missing");
    expect(result.results[1].detail).toContain("expected 200, got 500");
    expect(result.results[2].detail).toContain("unexpected");
  });

  it("accepts either enforced or report-only CSP", async () => {
    const fetcher = (async () =>
      new Response("ok", {
        status: 200,
        headers: {
          "x-content-type-options": "nosniff",
          "content-security-policy": "default-src 'self'",
        },
      })) as unknown as typeof fetch;

    const result = await runSmokeChecks(fetcher, [
      {
        name: "login",
        url: "https://app.test/login",
        expectStatus: 200,
        headerPresent: ["x-content-type-options"],
        headerAnyOf: [["content-security-policy", "content-security-policy-report-only"]],
      },
    ]);

    expect(result.ok).toBe(true);
  });

  it("fails when a required security header is missing", async () => {
    const fetcher = (async () =>
      new Response("ok", {
        status: 200,
        headers: { "x-content-type-options": "nosniff" },
      })) as unknown as typeof fetch;

    const result = await runSmokeChecks(fetcher, [
      {
        name: "login",
        url: "https://app.test/login",
        expectStatus: 200,
        headerPresent: ["x-content-type-options", "content-security-policy-report-only"],
      },
    ]);

    expect(result.ok).toBe(false);
    expect(result.results[0].detail).toContain(
      "missing header content-security-policy-report-only",
    );
  });

  it("turns a network failure into a failed check, not a crash", async () => {
    const fetcher = (async () => {
      throw new Error("connection reset");
    }) as unknown as typeof fetch;

    const result = await runSmokeChecks(fetcher, [
      { name: "down", url: "https://app.test/down", expectStatus: 200 },
    ]);

    expect(result.ok).toBe(false);
    expect(result.results[0].status).toBeNull();
    expect(formatSmokeResults(result.results)).toContain("FAIL down");
  });
});
