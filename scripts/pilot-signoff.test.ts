import { describe, expect, it } from "vitest";

import { collectPilotFacts } from "./pilot-signoff";

const production = (path: string) => `https://kossilon-hub.vercel.app${path}`;
const demo = (path: string) => `https://kossilon-hub-demo.vercel.app${path}`;

function healthyFetcher() {
  return (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {
      "x-content-type-options": "nosniff",
      "content-security-policy-report-only": "default-src 'self'",
    };
    if (url === production("/api/version"))
      return new Response(
        JSON.stringify({ sha: "a".repeat(40), environment: "production", dataMode: "production" }),
        { status: 200 },
      );
    if (url === production("/api/health"))
      return new Response(
        JSON.stringify({
          ok: true,
          scheduler: { running: true, evidence: "platform-verified" },
          maintenance: { state: "healthy" },
        }),
        { status: 200 },
      );
    if (url === production("/login"))
      return new Response("<html></html>", { status: 200, headers });
    if (url === production("/request-access"))
      return new Response('<a href="mailto:admin">email</a>', { status: 200 });
    if (url === production("/api/capabilities"))
      return new Response(
        JSON.stringify({
          capabilities: [
            { id: "firm" },
            { id: "database" },
            { id: "auth" },
            { id: "documents" },
            { id: "scheduler" },
          ],
        }),
        { status: 200 },
      );
    if (url === demo("/api/version"))
      return new Response(JSON.stringify({ sha: "b".repeat(40), dataMode: "demo" }), {
        status: 200,
      });
    return new Response("missing", { status: 404 });
  }) as typeof fetch;
}

describe("pilot sign-off facts", () => {
  it("passes on a healthy runtime with the honest request-access fallback", async () => {
    const facts = await collectPilotFacts(healthyFetcher());

    expect(facts.every((fact) => fact.ok)).toBe(true);
    expect(facts.map((fact) => fact.name)).toEqual([
      "production-identity",
      "scheduler-and-maintenance",
      "login-security-headers",
      "request-access-honest-state",
      "capabilities-readable",
      "demo-fixture-identity",
    ]);
  });

  it("fails when the cron is not platform-verified or maintenance is not healthy", async () => {
    const fetcher = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === production("/api/health"))
        return new Response(
          JSON.stringify({
            ok: false,
            scheduler: { running: false, evidence: "http-candidate" },
            maintenance: { state: "stale" },
          }),
          { status: 503 },
        );
      return healthyFetcher()(input as never);
    }) as unknown as typeof fetch;

    const facts = await collectPilotFacts(fetcher);
    expect(facts.find((fact) => fact.name === "scheduler-and-maintenance")?.ok).toBe(false);
  });

  it("fails when request-access is neither fallback nor persisted form", async () => {
    const fetcher = (async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url === production("/request-access"))
        return new Response("<html>unavailable</html>", { status: 200 });
      return healthyFetcher()(input as never);
    }) as unknown as typeof fetch;

    const facts = await collectPilotFacts(fetcher);
    expect(facts.find((fact) => fact.name === "request-access-honest-state")?.ok).toBe(false);
  });
});
