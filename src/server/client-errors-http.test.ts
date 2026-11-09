import { describe, expect, it } from "vitest";

import {
  createClientErrorHandler,
  sanitizeClientPath,
  type ClientErrorEvent,
} from "./client-errors-http";

const post = (body: unknown) =>
  new Request("https://app.test/api/client-errors", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" },
    body: JSON.stringify(body),
  });

describe("client error capture", () => {
  it("logs a sanitized structured event and returns 204", async () => {
    const events: ClientErrorEvent[] = [];
    const handler = createClientErrorHandler({ logger: (event) => events.push(event) });

    const response = await handler(
      post({
        message: "Cannot read properties of undefined",
        path: "/dashboard?caseId=secret#top",
        digest: "abc123",
      }),
    );

    expect(response.status).toBe(204);
    expect(events).toEqual([
      {
        event: "client-error",
        message: "Cannot read properties of undefined",
        path: "/dashboard",
        digest: "abc123",
      },
    ]);
  });

  it("rejects invalid JSON, over-long messages and non-POST", async () => {
    const handler = createClientErrorHandler({ logger: () => undefined });

    const badJson = await handler(
      new Request("https://app.test/api/client-errors", { method: "POST", body: "{" }),
    );
    expect(badJson.status).toBe(400);

    const tooLong = await handler(post({ message: "x".repeat(501) }));
    expect(tooLong.status).toBe(400);

    const get = await handler(new Request("https://app.test/api/client-errors"));
    expect(get.status).toBe(405);
    expect(get.headers.get("allow")).toBe("POST");
  });

  it("throttles with retry-after once the per-IP budget is spent", async () => {
    const handler = createClientErrorHandler({
      logger: () => undefined,
      consume: () => ({ allowed: false, retryAfterSeconds: 17 }),
    });

    const response = await handler(post({ message: "boom" }));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
  });

  it("sanitizes paths without leaking query, hash or foreign origins", () => {
    expect(sanitizeClientPath("/clients/abc?x=1#y")).toBe("/clients/abc");
    expect(sanitizeClientPath("https://evil.test/x?y=1")).toBe("unknown");
    expect(sanitizeClientPath(undefined)).toBe("unknown");
  });

  it("is wired from the worker entry", async () => {
    const { readFileSync } = await import("node:fs");
    const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
    expect(server).toContain('pathname === "/api/client-errors"');
    expect(server).toContain("createClientErrorHandler");
  });
});
