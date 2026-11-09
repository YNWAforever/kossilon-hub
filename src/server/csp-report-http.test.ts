import { describe, expect, it } from "vitest";

import {
  createCspReportHandler,
  extractCspViolation,
  sanitizeBlockedUri,
  sanitizeDocumentPath,
  type CspViolation,
} from "./csp-report-http";

const legacy = {
  "csp-report": {
    "document-uri": "https://app.test/clients/abc?token=secret#x",
    "violated-directive": "script-src-elem",
    "blocked-uri": "https://cdn.example.test/lib.js?tracking=1",
  },
};

const modern = [
  {
    type: "csp-violation",
    body: {
      documentURL: "https://app.test/portal?case=1",
      effectiveDirective: "style-src",
      blockedURL: "inline",
    },
  },
];

const post = (body: unknown) =>
  new Request("https://app.test/api/csp-report", {
    method: "POST",
    headers: { "content-type": "application/csp-report", "x-forwarded-for": "203.0.113.9" },
    body: JSON.stringify(body),
  });

describe("CSP report sink", () => {
  it("extracts and sanitizes the legacy csp-report shape", () => {
    expect(extractCspViolation(legacy)).toEqual({
      documentPath: "/clients/abc",
      directive: "script-src-elem",
      blocked: "https://cdn.example.test",
    });
  });

  it("extracts the Reporting API csp-violation shape", () => {
    expect(extractCspViolation(modern)).toEqual({
      documentPath: "/portal",
      directive: "style-src",
      blocked: "inline",
    });
  });

  it("ignores malformed and unrelated reports", () => {
    expect(extractCspViolation(null)).toBeNull();
    expect(extractCspViolation({ "csp-report": null })).toBeNull();
    expect(extractCspViolation([{ type: "deprecation", body: {} }])).toBeNull();
    expect(sanitizeDocumentPath("not a url")).toBe("unknown");
    expect(sanitizeBlockedUri("data:text/html,secret")).toBe("unknown");
  });

  it("logs a sanitized violation and returns 204", async () => {
    const violations: CspViolation[] = [];
    const handler = createCspReportHandler({ logger: (violation) => violations.push(violation) });

    const response = await handler(post(legacy));

    expect(response.status).toBe(204);
    expect(violations).toEqual([
      {
        documentPath: "/clients/abc",
        directive: "script-src-elem",
        blocked: "https://cdn.example.test",
      },
    ]);
  });

  it("rejects non-POST, invalid JSON and throttled reports", async () => {
    const handler = createCspReportHandler({ logger: () => undefined });

    expect((await handler(new Request("https://app.test/api/csp-report"))).status).toBe(405);
    expect(
      (await handler(new Request("https://app.test/api/csp-report", { method: "POST", body: "{" })))
        .status,
    ).toBe(400);

    const throttled = createCspReportHandler({
      logger: () => undefined,
      consume: () => ({ allowed: false, retryAfterSeconds: 11 }),
    });
    const response = await throttled(post(legacy));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("11");
  });

  it("is wired from the worker entry and the CSP header", async () => {
    const { readFileSync } = await import("node:fs");
    const server = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
    const headers = readFileSync(new URL("./security-headers.ts", import.meta.url), "utf8");
    expect(server).toContain('pathname === "/api/csp-report"');
    expect(headers).toContain("report-uri /api/csp-report");
  });
});
