import { createServerFn } from "@tanstack/react-start";

import { createMemoryRateLimiter } from "@/features/auth/rate-limit";
import { createSqlClient, getSqlClient } from "@/server/db/client";

import { createRequestAccessRepository } from "./repository";
import {
  normalizeRequestAccess,
  requestAccessSubmissionSchema,
  type RequestAccessResult,
} from "./types";

// Per-instance speed bump keyed by the submitted address. Serverless instances
// do not share memory; the unique pending index and manual review are the real
// guards. Five submissions per address per hour is far above human use.
const submissionLimiter = createMemoryRateLimiter({ limit: 5, windowMs: 60 * 60_000 });

function repository() {
  return createRequestAccessRepository({ sql: getSqlClient() as never });
}

/**
 * Whether the request-access form can persist. Public and read-only.
 *
 * The production database does not have migration 0083 until it is applied, so
 * this returns false and the page keeps its honest mailto fallback. It never
 * reports a reason that contains connection details.
 */
export const getRequestAccessAvailability = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ available: boolean; reason?: "database-unavailable" }> => {
    let instance: ReturnType<typeof repository> | null = null;
    try {
      instance = repository();
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

    let instance: ReturnType<typeof repository> | null = null;
    try {
      instance = repository();
      if (!(await instance.tableExists())) return { ok: false, code: "unavailable" };
      const created = await instance.create(normalized);
      return { ok: true, duplicate: created.duplicate };
    } catch {
      return { ok: false, code: "error" };
    } finally {
      await instance?.close().catch(() => undefined);
    }
  });

/** Exposed for a future admin screen and tests; no public caller uses this. */
export function createRequestAccessRepositoryForDatabase(databaseUrl?: string) {
  return createRequestAccessRepository({
    sql: databaseUrl ? (createSqlClient(databaseUrl) as never) : (getSqlClient() as never),
    ownsClient: Boolean(databaseUrl),
  });
}
