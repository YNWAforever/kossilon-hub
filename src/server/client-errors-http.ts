import { z } from "zod";

import {
  createMemoryRateLimiter,
  rateLimitKey,
  rateLimitResponse,
} from "@/features/auth/rate-limit";

const clientErrorSchema = z
  .object({
    message: z.string().trim().min(1).max(500),
    path: z.string().max(300).optional(),
    digest: z.string().max(120).optional(),
  })
  .strict();

export type ClientErrorEvent = {
  event: "client-error";
  message: string;
  path: string;
  digest: string | null;
};

/** Keep only the pathname: no query, hash, origin or cookies. */
export function sanitizeClientPath(value: string | undefined): string {
  if (!value) return "unknown";
  const withoutHash = value.split("#")[0] ?? "";
  const path = withoutHash.split("?")[0] ?? "";
  return path.startsWith("/") ? path.slice(0, 300) : "unknown";
}

const limiter = createMemoryRateLimiter({ limit: 20, windowMs: 60_000 });

/**
 * Client render errors are captured into structured runtime logs until a
 * hosted error tracker exists. No request body, user identity or query string
 * is logged; only a truncated message, the path and an optional digest.
 */
export function createClientErrorHandler(
  input: {
    logger?: (event: ClientErrorEvent) => void;
    consume?: (key: string) => { allowed: true } | { allowed: false; retryAfterSeconds: number };
  } = {},
) {
  const logger = input.logger ?? ((event: ClientErrorEvent) => console.error(event));
  const consume = input.consume ?? ((key: string) => limiter.consume(key));

  return async (request: Request): Promise<Response> => {
    if (request.method.toUpperCase() !== "POST") {
      return new Response(null, { status: 405, headers: { allow: "POST" } });
    }

    const decision = consume(rateLimitKey(request));
    if (!decision.allowed) return rateLimitResponse(decision.retryAfterSeconds);

    let parsed: unknown;
    try {
      parsed = await request.json();
    } catch {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }
    const result = clientErrorSchema.safeParse(parsed);
    if (!result.success) {
      return Response.json({ error: "invalid_report" }, { status: 400 });
    }

    logger({
      event: "client-error",
      message: result.data.message,
      path: sanitizeClientPath(result.data.path),
      digest: result.data.digest ?? null,
    });
    return new Response(null, { status: 204 });
  };
}
