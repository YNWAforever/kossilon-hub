import { createServerFn } from "@tanstack/react-start";

import { createMemoryRateLimiter } from "@/features/auth/rate-limit";

import {
  normalizeRequestAccess,
  requestAccessSubmissionSchema,
  type RequestAccessResult,
} from "./types";

// Per-instance speed bump keyed by the submitted address. Serverless instances
// do not share memory; the unique pending index and manual review are the real
// guards. Five submissions per address per hour is far above human use.
const submissionLimiter = createMemoryRateLimiter({ limit: 5, windowMs: 60 * 60_000 });

async function requestAccessRepository() {
  // Dynamic, and from a `.server.ts` module: the client graph must never see the
  // database client just because a route imports the server functions.
  const { createRequestAccessRepositoryForRequest } = await import("./repository.server");
  return createRequestAccessRepositoryForRequest();
}

type RequestAccessRepositoryInstance = Awaited<ReturnType<typeof requestAccessRepository>>;

/**
 * Whether the request-access form can persist. Public and read-only.
 *
 * The production database does not have migration 0083 until it is applied, so
 * this returns false and the page keeps its honest mailto fallback. It never
 * reports a reason that contains connection details.
 */
export const getRequestAccessAvailability = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ available: boolean; reason?: "database-unavailable" }> => {
    let instance: RequestAccessRepositoryInstance | null = null;
    try {
      instance = await requestAccessRepository();
      return { available: await instance.tableExists() };
    } catch {
      return { available: false, reason: "database-unavailable" };
    } finally {
      await instance?.close().catch(() => undefined);
    }
  },
);

export const submitRequestAccessRequest = createServerFn({ method: "POST" })
  .validator(requestAccessSubmissionSchema)
  .handler(async ({ data }): Promise<RequestAccessResult> => {
    const normalized = normalizeRequestAccess(data);
    // Silently accept honeypot hits: a bot learns nothing from a generic success.
    if (normalized.honeypot) return { ok: true, duplicate: false };

    const decision = submissionLimiter.consume(normalized.email);
    if (!decision.allowed) return { ok: false, code: "rate-limited" };

    let instance: RequestAccessRepositoryInstance | null = null;
    try {
      instance = await requestAccessRepository();
      if (!(await instance.tableExists())) return { ok: false, code: "unavailable" };
      const created = await instance.create(normalized);
      return { ok: true, duplicate: created.duplicate };
    } catch {
      return { ok: false, code: "error" };
    } finally {
      await instance?.close().catch(() => undefined);
    }
  });
