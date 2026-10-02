import type postgres from "postgres";
import { createSqlClient, getSqlClient, type SqlClient } from "@/server/db/client";
import type { MaintenanceJobStore, PersistedJobState } from "@/server/maintenance-trigger";

type QueryClient = SqlClient | postgres.TransactionSql;

/** Postgres is the owner of scheduled-slot identity, not a process-local lock. */
export function createMaintenanceJobRepository(
  options: {
    sql?: QueryClient;
    databaseUrl?: string;
  } = {},
): MaintenanceJobStore {
  const sql =
    options.sql ?? (options.databaseUrl ? createSqlClient(options.databaseUrl) : getSqlClient());
  const ownsClient = Boolean(options.databaseUrl) && !options.sql;
  return {
    async claim(input) {
      const rows = await sql<{ lease_token: string }[]>`
        insert into maintenance_job_runs (
          scheduled_for, job_kind, trigger_source, run_id, state,
          claimed_at, lease_expires_at
        ) values (
          ${input.scheduledAt}, ${input.job}, ${input.trigger}, ${input.runId},
          'claimed', ${input.now}, ${input.leaseExpiresAt}
        )
        on conflict (scheduled_for, job_kind) where trigger_source = 'scheduled'
        do update set
          run_id = excluded.run_id,
          lease_token = gen_random_uuid(),
          claimed_at = excluded.claimed_at,
          lease_expires_at = excluded.lease_expires_at
        where maintenance_job_runs.state = 'claimed'
          and maintenance_job_runs.lease_expires_at <= excluded.claimed_at
        returning lease_token
      `;
      return rows[0] ? { token: rows[0].lease_token } : null;
    },
    async stateOf(scheduledAt, job) {
      const rows = await sql<{ state: PersistedJobState }[]>`
        select state from maintenance_job_runs
        where trigger_source = 'scheduled'
          and scheduled_for = ${scheduledAt} and job_kind = ${job}
      `;
      return rows[0]?.state ?? null;
    },
    async begin(_scheduledAt, _job, token) {
      const rows = await sql<{ id: string }[]>`
        update maintenance_job_runs
        set state = 'started', started_at = now()
        where lease_token = ${token} and state = 'claimed'
          and lease_expires_at > now()
        returning id
      `;
      return rows.length === 1;
    },
    async finish(_scheduledAt, _job, token, outcome) {
      const rows = await sql<{ id: string }[]>`
        update maintenance_job_runs
        set state = ${outcome}, finished_at = now()
        where lease_token = ${token} and state = 'started'
        returning id
      `;
      return rows.length === 1;
    },
    async close() {
      if (ownsClient && "end" in sql) await sql.end();
    },
  };
}
