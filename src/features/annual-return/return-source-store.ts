import type postgres from "postgres";
import { getSqlClient, type SqlClient } from "@/server/db/client";
import type { ReturnSourceStore } from "./return-source";

type Db = SqlClient | postgres.TransactionSql;

/** Durable claim, per-object idempotency and cursor CAS for a read-only source. */
export function createReturnSourceStore(db: Db = getSqlClient()): ReturnSourceStore {
  return {
    async claim(sourceKey) {
      await db`
        insert into filing_return_source_cursors (source_key)
        values (${sourceKey}) on conflict (source_key) do nothing`;
      const [row] = await db<{ lease_token: string; cursor: string | null }[]>`
        update filing_return_source_cursors
        set lease_token = gen_random_uuid(),
            lease_until = now() + interval '5 minutes',
            updated_at = now()
        where source_key = ${sourceKey}
          and (lease_token is null or lease_until <= now())
        returning lease_token,cursor`;
      return row ? { token: row.lease_token, cursor: row.cursor } : null;
    },
    async stage(input) {
      await db`
        insert into filing_return_source_objects (
          source_key,object_id,object_version,source_sha256,file_name,
          content_type,byte_size,object_key,scan_state,provider_reference
        ) values (
          ${input.sourceKey},${input.objectId},${input.version},
          ${input.sha256},${input.fileName},${input.contentType},
          ${input.byteSize},${input.objectKey},${input.scanState},
          ${input.providerReference}
        ) on conflict (source_key,object_id,source_sha256) do nothing`;
    },
    async advance(sourceKey, token, cursor) {
      const rows = await db<{ source_key: string }[]>`
        update filing_return_source_cursors
        set cursor = ${cursor},last_success_at = now(),
            last_error_code = null,updated_at = now()
        where source_key = ${sourceKey} and lease_token = ${token}
          and lease_until > now()
        returning source_key`;
      return rows.length === 1;
    },
    async release(sourceKey, token) {
      await db`
        update filing_return_source_cursors
        set lease_token = null,lease_until = null,updated_at = now()
        where source_key = ${sourceKey} and lease_token = ${token}`;
    },
  };
}
