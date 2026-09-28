import type postgres from "postgres";
import { createSqlClient, getSqlClient, type SqlClient } from "@/server/db/client";
import type { NarSheetReadResult } from "./mapping";

type QueryClient = SqlClient | postgres.TransactionSql;
export type NarImportStageResult = {
  batchId: string;
  reused: boolean;
  skippedRowNumbers: number[];
  sheetIssues: NarSheetReadResult["issues"];
};
export type NarImportStageJob = {
  id: string;
  sourceFileName: string;
  sourceSha256: string;
  sourceSizeBytes: number;
  objectKey: string;
  sheetName: string | null;
  returnYear: number;
  createdBy: string;
  state: "queued" | "processing" | "succeeded" | "failed";
  attempts: number;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  result: NarImportStageResult | null;
  errorCode: string | null;
  errorDetail: string | null;
  objectDeletedAt: string | null;
};
type JobRow = {
  id: string;
  source_file_name: string;
  source_sha256: string;
  source_size_bytes: number;
  object_key: string;
  sheet_name: string | null;
  return_year: number;
  created_by: string;
  state: NarImportStageJob["state"];
  attempts: number;
  lease_token: string | null;
  lease_expires_at: string | null;
  result: NarImportStageResult | null;
  error_code: string | null;
  error_detail: string | null;
  object_deleted_at: string | null;
};
function mapJob(row: JobRow): NarImportStageJob {
  return {
    id: row.id,
    sourceFileName: row.source_file_name,
    sourceSha256: row.source_sha256,
    sourceSizeBytes: row.source_size_bytes,
    objectKey: row.object_key,
    sheetName: row.sheet_name,
    returnYear: row.return_year,
    createdBy: row.created_by,
    state: row.state,
    attempts: row.attempts,
    leaseToken: row.lease_token,
    leaseExpiresAt: row.lease_expires_at,
    result: row.result,
    errorCode: row.error_code,
    errorDetail: row.error_detail,
    objectDeletedAt: row.object_deleted_at,
  };
}
export type EnqueueStageJobInput = {
  sourceFileName: string;
  sourceSha256: string;
  sourceSizeBytes: number;
  objectKey: string;
  sheetName: string | null;
  returnYear: number;
  createdBy: string;
};

export function createNarImportStageJobRepository(
  options: { sql?: QueryClient; databaseUrl?: string } = {},
) {
  const sql =
    options.sql ?? (options.databaseUrl ? createSqlClient(options.databaseUrl) : getSqlClient());
  const ownsClient = Boolean(options.databaseUrl) && !options.sql;
  return {
    async enqueue(
      input: EnqueueStageJobInput,
    ): Promise<{ job: NarImportStageJob; reused: boolean }> {
      const inserted = await sql<JobRow[]>`
        insert into nar_import_stage_jobs (
          source_file_name,source_sha256,source_size_bytes,object_key,
          sheet_name,return_year,created_by
        ) values (
          ${input.sourceFileName},${input.sourceSha256},${input.sourceSizeBytes},
          ${input.objectKey},${input.sheetName},${input.returnYear},${input.createdBy}
        ) on conflict do nothing returning *`;
      if (inserted[0]) return { job: mapJob(inserted[0]), reused: false };
      const existing = await sql<JobRow[]>`
        select * from nar_import_stage_jobs
        where source_sha256=${input.sourceSha256}
          and coalesce(sheet_name,'')=coalesce(${input.sheetName}::text,'')
          and return_year=${input.returnYear} and created_by=${input.createdBy}
          and state <> 'failed'
        limit 1`;
      if (!existing[0]) throw new Error("Unable to resolve concurrent import staging job.");
      return { job: mapJob(existing[0]), reused: true };
    },
    async getForActor(id: string, actorId: string): Promise<NarImportStageJob | null> {
      const rows = await sql<JobRow[]>`
        select * from nar_import_stage_jobs where id=${id} and created_by=${actorId} limit 1`;
      return rows[0] ? mapJob(rows[0]) : null;
    },
    async claimOne(now: string): Promise<NarImportStageJob | null> {
      const rows = await sql<JobRow[]>`
        with picked as (
          select id from nar_import_stage_jobs
          where (state='queued' and (lease_expires_at is null or lease_expires_at <= ${now}::timestamptz))
            or (state='processing' and lease_expires_at <= ${now}::timestamptz and attempts < 3)
          order by created_at,id for update skip locked limit 1
        )
        update nar_import_stage_jobs j
        set state='processing',attempts=j.attempts+1,
            lease_token=gen_random_uuid(),
            lease_expires_at=${now}::timestamptz + interval '10 minutes',
            updated_at=${now}::timestamptz
        from picked where j.id=picked.id
        returning j.*`;
      return rows[0] ? mapJob(rows[0]) : null;
    },
    async complete(id: string, leaseToken: string, result: NarImportStageResult): Promise<boolean> {
      const rows = await sql<{ id: string }[]>`
        update nar_import_stage_jobs
        set state='succeeded',result=${sql.json(result as never)},error_code=null,error_detail=null,
            lease_token=null,lease_expires_at=null,updated_at=now()
        where id=${id} and lease_token=${leaseToken} and state='processing'
        returning id`;
      return rows.length === 1;
    },
    async fail(
      id: string,
      leaseToken: string,
      code: string,
      terminal: boolean,
      detail: string | null = null,
    ): Promise<boolean> {
      const rows = await sql<{ id: string }[]>`
        update nar_import_stage_jobs
        set state=case when ${terminal} or attempts >= 3 then 'failed' else 'queued' end,
            error_code=${code},error_detail=${detail},lease_token=null,
            lease_expires_at=case when ${terminal} or attempts >= 3 then null
              else now() + interval '5 minutes' end,updated_at=now()
        where id=${id} and lease_token=${leaseToken} and state='processing'
        returning id`;
      return rows.length === 1;
    },
    async failExhausted(now: string): Promise<number> {
      const rows = await sql<{ id: string }[]>`
        update nar_import_stage_jobs
        set state='failed',error_code='lease_exhausted',
            lease_token=null,lease_expires_at=null,updated_at=${now}::timestamptz
        where state='processing' and attempts >= 3
          and lease_expires_at <= ${now}::timestamptz
        returning id`;
      return rows.length;
    },
    async listCleanupCandidates(limit: number): Promise<NarImportStageJob[]> {
      const rows = await sql<JobRow[]>`
        select * from nar_import_stage_jobs
        where state in ('succeeded','failed') and object_deleted_at is null
        order by updated_at,id limit ${limit}`;
      return rows.map(mapJob);
    },
    async markObjectDeleted(id: string): Promise<boolean> {
      const rows = await sql<{ id: string }[]>`
        update nar_import_stage_jobs set object_deleted_at=now()
        where id=${id} and state in ('succeeded','failed') and object_deleted_at is null
        returning id`;
      return rows.length === 1;
    },
    async activeAdminActor(userId: string): Promise<{
      authUserId: string;
      userId: string;
      role: "Admin";
      teamId: string | null;
      active: true;
    } | null> {
      const rows = await sql<{ auth_user_id: string; user_id: string; team_id: string | null }[]>`
        select sp.auth_user_id,sp.user_id,sp.team_id
        from staff_profiles sp join users u on u.id=sp.user_id and u.active
        where sp.user_id=${userId} and sp.role='Admin' and sp.active
        limit 1`;
      return rows[0]
        ? {
            authUserId: rows[0].auth_user_id,
            userId: rows[0].user_id,
            role: "Admin",
            teamId: rows[0].team_id,
            active: true,
          }
        : null;
    },
    async close(): Promise<void> {
      if (ownsClient && "end" in sql) await sql.end();
    },
  };
}
export type NarImportStageJobRepository = ReturnType<typeof createNarImportStageJobRepository>;
