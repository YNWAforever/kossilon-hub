import type { NormalizedRequestAccess } from "./types";

export type RequestAccessRepository = {
  /** Whether migration 0083 has been applied on this database. */
  tableExists: () => Promise<boolean>;
  create: (input: NormalizedRequestAccess) => Promise<{ id: string | null; duplicate: boolean }>;
  close: () => Promise<void>;
};

type SqlClientLike = {
  <T = unknown>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
  end?: (options?: { timeout?: number }) => Promise<void>;
};

/**
 * The public request-access queue.
 *
 * Kept separate from the firm repositories because it is actor-free: a visitor
 * is not signed in and there is no firm runtime env. It deliberately reads only
 * its own table and exposes no list method to the public server function.
 */
export function createRequestAccessRepository(options: {
  sql: SqlClientLike;
  ownsClient?: boolean;
}): RequestAccessRepository {
  const { sql } = options;

  return {
    async tableExists() {
      const rows = await sql<{ present: boolean }[]>`
        select to_regclass('public.request_access_requests') is not null as present
      `;
      return rows[0]?.present === true;
    },

    async create(input) {
      try {
        const rows = await sql<{ id: string }[]>`
          insert into request_access_requests (name, email, firm, team, message)
          values (${input.name}, ${input.email}, ${input.firm}, ${input.team}, ${input.message})
          returning id
        `;
        return { id: rows[0]?.id ?? null, duplicate: false };
      } catch (error) {
        // request_access_pending_email_uidx: one pending request per address.
        if ((error as { code?: string }).code === "23505") return { id: null, duplicate: true };
        throw error;
      }
    },

    async close() {
      if (options.ownsClient && sql.end) await sql.end({ timeout: 5 });
    },
  };
}
