export type RateLimitDecision =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterSeconds: number };

/**
 * Best-effort per-instance rate limiting for authentication requests.
 *
 * Serverless instances do not share memory, so this is a speed bump rather than
 * a guarantee: a determined attacker spread across instances can exceed it. It
 * exists to blunt credential stuffing and magic-link spam on one warm instance;
 * the platform edge/WAF rules remain the durable layer. Nothing here is
 * persisted or logged with an email address.
 */
export function createMemoryRateLimiter(input: {
  limit: number;
  windowMs: number;
  now?: () => number;
}) {
  const hits = new Map<string, number[]>();
  const now = input.now ?? (() => Date.now());

  return {
    consume(key: string): RateLimitDecision {
      const current = now();
      const cutoff = current - input.windowMs;
      const recent = (hits.get(key) ?? []).filter((timestamp) => timestamp > cutoff);
      if (recent.length >= input.limit) {
        const retryAfterSeconds = Math.max(
          1,
          Math.ceil((recent[0] + input.windowMs - current) / 1000),
        );
        hits.set(key, recent);
        return { allowed: false, retryAfterSeconds };
      }
      recent.push(current);
      hits.set(key, recent);
      return { allowed: true, remaining: input.limit - recent.length };
    },
    reset() {
      hits.clear();
    },
  };
}

export function rateLimitKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  return forwarded || realIp || "unknown";
}

const SENSITIVE_AUTH_PATHS = [
  "/sign-in/email",
  "/sign-in/magic-link",
  "/sign-in/social",
  "/sign-up/email",
  "/forget-password",
  "/reset-password",
  "/change-password",
  "/send-verification-email",
] as const;

export function isRateLimitedAuthRequest(request: Request): boolean {
  if (request.method.toUpperCase() !== "POST") return false;
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith("/api/auth/")) return false;
  return SENSITIVE_AUTH_PATHS.some((path) => pathname.endsWith(path));
}

export function rateLimitResponse(retryAfterSeconds: number): Response {
  return new Response(JSON.stringify({ error: "too_many_requests", retryAfterSeconds }), {
    status: 429,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "retry-after": String(retryAfterSeconds),
    },
  });
}
