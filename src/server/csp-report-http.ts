import {
  createMemoryRateLimiter,
  rateLimitKey,
  rateLimitResponse,
} from "@/features/auth/rate-limit";

export type CspViolation = {
  documentPath: string;
  directive: string;
  blocked: string;
};

/** Only the pathname is kept: report URLs can carry case/document ids. */
export function sanitizeDocumentPath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "unknown";
  try {
    return new URL(value).pathname.slice(0, 200) || "unknown";
  } catch {
    return "unknown";
  }
}

/** Keep a blocked URI as an origin (or `inline`/`eval`), never a full URL with query. */
export function sanitizeBlockedUri(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) return "unknown";
  if (value === "inline" || value === "eval") return value;
  try {
    const url = new URL(value);
    // Never log opaque/data/blob schemes; only web origins are useful triage.
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : "unknown";
  } catch {
    const path = value.split("?")[0] ?? "";
    return path.startsWith("/") ? path.slice(0, 200) : "unknown";
  }
}

function directive(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value.slice(0, 120) : "unknown";
}

/**
 * Accepts both the legacy `csp-report` shape and the Reporting API
 * `application/reports+json` array. Unknown shapes are ignored (null).
 */
export function extractCspViolation(payload: unknown): CspViolation | null {
  if (typeof payload !== "object" || payload === null) return null;

  const legacy = (payload as { "csp-report"?: Record<string, unknown> })["csp-report"];
  if (legacy && typeof legacy === "object") {
    return {
      documentPath: sanitizeDocumentPath(legacy["document-uri"]),
      directive: directive(legacy["violated-directive"] ?? legacy["effective-directive"]),
      blocked: sanitizeBlockedUri(legacy["blocked-uri"]),
    };
  }

  if (Array.isArray(payload)) {
    for (const entry of payload.slice(0, 5)) {
      if (typeof entry !== "object" || entry === null) continue;
      const report = entry as { type?: unknown; body?: Record<string, unknown> };
      if (report.type !== "csp-violation" || !report.body) continue;
      return {
        documentPath: sanitizeDocumentPath(report.body.documentURL),
        directive: directive(report.body.effectiveDirective ?? report.body.violatedDirective),
        blocked: sanitizeBlockedUri(report.body.blockedURL),
      };
    }
  }

  return null;
}

const limiter = createMemoryRateLimiter({ limit: 30, windowMs: 60_000 });

/**
 * CSP violation sink for the report-only policy.
 *
 * Logs one structured line per report (path + directive + origin only) so a
 * future enforced CSP can be decided from observed violations. Never logs the
 * raw report, query strings, cookies or user identity.
 */
export function createCspReportHandler(
  input: {
    logger?: (violation: CspViolation) => void;
    consume?: (key: string) => { allowed: true } | { allowed: false; retryAfterSeconds: number };
  } = {},
) {
  const logger =
    input.logger ??
    ((violation: CspViolation) => console.warn({ event: "csp-violation", ...violation }));
  const consume = input.consume ?? ((key: string) => limiter.consume(key));

  return async (request: Request): Promise<Response> => {
    if (request.method.toUpperCase() !== "POST") {
      return new Response(null, { status: 405, headers: { allow: "POST" } });
    }
    const decision = consume(rateLimitKey(request));
    if (!decision.allowed) return rateLimitResponse(decision.retryAfterSeconds);

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return new Response(null, { status: 400 });
    }
    const violation = extractCspViolation(payload);
    if (!violation) return new Response(null, { status: 400 });

    logger(violation);
    return new Response(null, { status: 204 });
  };
}
