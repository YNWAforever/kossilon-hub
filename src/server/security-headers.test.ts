import { describe, expect, it } from "vitest";

import {
  CONTENT_SECURITY_POLICY,
  applySecurityHeaders,
  resolveSecurityHeaderMode,
  securityHeaders,
} from "./security-headers";

describe("security headers", () => {
  it("defaults to report-only and only enforces when asked", () => {
    expect(resolveSecurityHeaderMode(undefined)).toBe("report-only");
    expect(resolveSecurityHeaderMode("report-only")).toBe("report-only");
    expect(resolveSecurityHeaderMode("enforce")).toBe("enforce");
    expect(resolveSecurityHeaderMode("off")).toBe("off");
    expect(resolveSecurityHeaderMode("yes-please")).toBe("report-only");
  });

  it("sets the baseline browser hardening headers", () => {
    const headers = securityHeaders({ mode: "report-only", isProduction: true });

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["permissions-policy"]).toContain("camera=()");
    expect(headers["strict-transport-security"]).toContain("max-age=31536000");
    expect(headers["content-security-policy-report-only"]).toBe(
      `${CONTENT_SECURITY_POLICY}; report-uri /api/csp-report`,
    );
    expect(headers["content-security-policy"]).toBeUndefined();
  });

  it("does not ask dev/local pages to report CSP, where eval is expected", () => {
    const headers = securityHeaders({ mode: "report-only", isProduction: false });

    expect(headers["content-security-policy-report-only"]).toBe(CONTENT_SECURITY_POLICY);
    expect(headers["content-security-policy-report-only"]).not.toContain("report-uri");
  });

  it("enforces the same policy when the mode says so", () => {
    const headers = securityHeaders({ mode: "enforce", isProduction: false });

    expect(headers["content-security-policy"]).toBe(CONTENT_SECURITY_POLICY);
    expect(headers["content-security-policy-report-only"]).toBeUndefined();
    expect(headers["strict-transport-security"]).toBeUndefined();
    expect(CONTENT_SECURITY_POLICY).toContain("frame-ancestors 'none'");
    expect(CONTENT_SECURITY_POLICY).toContain("object-src 'none'");
  });
  it("emits no CSP when disabled but keeps the cheap headers", () => {
    const headers = securityHeaders({ mode: "off", isProduction: true });

    expect(headers["content-security-policy"]).toBeUndefined();
    expect(headers["content-security-policy-report-only"]).toBeUndefined();
    expect(headers["x-content-type-options"]).toBe("nosniff");
  });

  it("does not clobber route headers and keeps the body/status", async () => {
    const response = new Response("hello", {
      status: 201,
      headers: { "content-type": "text/plain", "x-frame-options": "SAMEORIGIN" },
    });

    const secured = applySecurityHeaders(response, { mode: "report-only", isProduction: false });

    expect(secured.status).toBe(201);
    expect(await secured.text()).toBe("hello");
    expect(secured.headers.get("content-type")).toBe("text/plain");
    // A route-level decision wins over the default.
    expect(secured.headers.get("x-frame-options")).toBe("SAMEORIGIN");
    expect(secured.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
