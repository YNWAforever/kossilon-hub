import type {
  NormalizedRequestAccess,
  RequestAccessDecision,
  RequestAccessQueueRow,
} from "./types";

export type RequestAccessRepository = {
  /** Whether migration 0083 has been applied on this database. */
  tableExists: () => Promise<boolean>;
  create: (input: NormalizedRequestAccess) => Promise<{ id: string | null; duplicate: boolean }>;
  /** Pending requests, oldest first. Admin-only caller (see server-fns). */
  listPending: (limit?: number) => Promise<RequestAccessQueueRow[]>;
  /**
   * Move one pending request to approved/rejected. Returns null when the row is
   * gone or already decided, so the screen can say "refresh" instead of silently
   * overwriting another reviewer's decision.
   */
  decide: (input: RequestAccessDecision & { reviewer: string }) => Promise<{ id: string } | null>;
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

    async listPending(limit = 100) {
      const rows = await sql<
        {
          id: string;
          created_at: string | Date;
          name: string;
          email: string;
          firm: string;
          team: string | null;
          message: string | null;
          status: RequestAccessQueueRow["status"];
        }[]
      >`
        select id, created_at, name, email, firm, team, message, status
        from request_access_requests
        where status = 'pending'
        order by created_at asc
        limit ${limit}
      `;
      return rows.map((row) => ({
        id: row.id,
        createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
        name: row.name,
        email: row.email,
        firm: row.firm,
        team: row.team,
        message: row.message,
        status: row.status,
      }));
    },

    async decide(input) {
      const rows = await sql<{ id: string }[]>`
        update request_access_requests
        set status = ${input.status}, reviewed_by = ${input.reviewer}, reviewed_at = now()
        where id = ${input.id} and status = 'pending'
        returning id
      `;
      return rows[0]?.id ? { id: rows[0].id } : null;
    },

    async close() {
      if (options.ownsClient && sql.end) await sql.end({ timeout: 5 });
    },
  };
}
