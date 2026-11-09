export type SecurityHeaderMode = "off" | "report-only" | "enforce";

/**
 * Content-Security-Policy for the app shell.
 *
 * Inline scripts/styles are required by the framework's hydration payload, so
 * the policy allows them. It is therefore a real policy but not the strongest
 * possible one; the default is report-only until a deploy has been observed
 * without violations. `SECURITY_HEADERS=enforce` turns it on.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

/** Reporting is production-only: dev/Vite legitimately uses eval, and local
 * browser suites treat any extra write as a failure. */
export function cspWithReportUri(isProduction: boolean): string {
  return isProduction
    ? `${CONTENT_SECURITY_POLICY}; report-uri /api/csp-report`
    : CONTENT_SECURITY_POLICY;
}

export function resolveSecurityHeaderMode(value: string | undefined): SecurityHeaderMode {
  if (value === "off") return "off";
  if (value === "enforce") return "enforce";
  return "report-only";
}

type HeaderInput = { mode: SecurityHeaderMode; isProduction: boolean };

export function securityHeaders(input: HeaderInput): Record<string, string> {
  const headers: Record<string, string> = {
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "x-frame-options": "DENY",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  };
  if (input.isProduction) {
    headers["strict-transport-security"] = "max-age=31536000; includeSubDomains";
  }
  if (input.mode === "report-only") {
    headers["content-security-policy-report-only"] = cspWithReportUri(input.isProduction);
  } else if (input.mode === "enforce") {
    headers["content-security-policy"] = cspWithReportUri(input.isProduction);
  }
  return headers;
}

/**
 * Apply the headers without clobbering anything the route already set (status
 * text, content type, set-cookie must survive).
 */
export function applySecurityHeaders(response: Response, input: HeaderInput): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(securityHeaders(input))) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
