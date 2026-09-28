import { getSqlClient, type SqlClient } from "@/server/db/client";
import type { QuarantinedMedia } from "./media-download";

const LEASE_MS = 2 * 60_000;

export type MediaDownloadJob = {
  id: string;
  messageId: string;
  providerMediaId: string;
  mediaType: string;
  position: number;
  objectKey: string;
  leaseToken: string;
  attemptCount: number;
  maxAttempts: number;
};
type MediaJobRow = {
  id: string;
  message_id: string;
  provider_media_id: string;
  media_type: string;
  position: number;
  download_object_key: string;
  download_lease_token: string;
  download_attempt_count: number;
  download_max_attempts: number;
};
function mapJob(row: MediaJobRow): MediaDownloadJob {
  return {
    id: row.id,
    messageId: row.message_id,
    providerMediaId: row.provider_media_id,
    mediaType: row.media_type,
    position: row.position,
    objectKey: row.download_object_key,
    leaseToken: row.download_lease_token,
    attemptCount: row.download_attempt_count,
    maxAttempts: row.download_max_attempts,
  };
}
function retryAt(now: string, attemptCount: number): string {
  const minutes = Math.min(60, 2 ** Math.min(attemptCount, 6));
  return new Date(Date.parse(now) + minutes * 60_000).toISOString();
}

export type MediaDownloadJobRepository = {
  claimDue(now: string, limit: number): Promise<MediaDownloadJob[]>;
  markQuarantined(job: MediaDownloadJob, media: QuarantinedMedia, now: string): Promise<boolean>;
  markError(
    job: MediaDownloadJob,
    input: { code: string; terminal: boolean; manualReupload: boolean; now: string },
  ): Promise<"retried" | "failed" | "manual_reupload" | "stale">;
  failStranded(now: string): Promise<number>;
  close(): Promise<void>;
};

/** Claims are fenced by a random lease token; duplicate cron ticks cannot settle each other's work. */
export function createMediaDownloadJobRepository(
  sql: SqlClient = getSqlClient(),
): MediaDownloadJobRepository {
  return {
    async claimDue(now, limit) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100)
        throw new Error("Media download claim limit must be 1 to 100.");
      const leaseExpiresAt = new Date(Date.parse(now) + LEASE_MS).toISOString();
      const rows = await sql<MediaJobRow[]>`
        with due as (
          select m.id, gen_random_uuid() as lease_token
          from whatsapp_message_media m
          join whatsapp_messages w on w.id = m.message_id
          left join companies c on c.id = w.company_id
          where w.direction = 'inbound'
            and (c.id is null or c.data_origin = 'client')
            and m.download_attempt_count < m.download_max_attempts
            and (
              (m.download_status = 'pending' and m.download_next_attempt_at <= ${now})
              or (m.download_status = 'processing'
                  and m.download_lease_expires_at <= ${now})
            )
          order by m.download_next_attempt_at, m.created_at, m.id
          for update of m skip locked
          limit ${limit}
        )
        update whatsapp_message_media m
        set download_status = 'processing',
            download_attempt_count = m.download_attempt_count + 1,
            download_lease_token = due.lease_token,
            download_object_key = 'whatsapp-media/' || m.id::text || '/' || due.lease_token::text,
            download_lease_expires_at = ${leaseExpiresAt},
            download_revision = m.download_revision + 1
        from due where m.id = due.id
        returning m.id, m.message_id, m.provider_media_id, m.media_type,
          m.position, m.download_object_key, m.download_lease_token,
          m.download_attempt_count, m.download_max_attempts
      `;
      return rows.map(mapJob);
    },
    async markQuarantined(job, media, now) {
      if (media.objectKey !== job.objectKey)
        throw new Error("Downloaded media object key changed.");
      const rows = await sql<{ id: string }[]>`
        update whatsapp_message_media
        set download_status = 'quarantined',
          download_checksum_sha256 = ${media.checksum},
          download_content_type = ${media.contentType},
          download_byte_size = ${media.sizeBytes},
          download_file_name = ${media.fileName},
          download_last_error_code = null,
          download_lease_token = null,
          download_lease_expires_at = null,
          download_revision = download_revision + 1,
          download_next_attempt_at = ${now}
        where id = ${job.id} and download_status = 'processing'
          and download_lease_token = ${job.leaseToken}
        returning id
      `;
      return rows.length === 1;
    },
    async markError(job, input) {
      const exhausted = job.attemptCount >= job.maxAttempts;
      const status = input.manualReupload
        ? "manual_reupload"
        : input.terminal || exhausted
          ? "failed"
          : "pending";
      const rows = await sql<{ id: string }[]>`
        update whatsapp_message_media
        set download_status = ${status},
          download_last_error_code = ${input.code},
          download_lease_token = null,
          download_lease_expires_at = null,
          download_next_attempt_at = ${status === "pending" ? retryAt(input.now, job.attemptCount) : input.now},
          download_revision = download_revision + 1
        where id = ${job.id} and download_status = 'processing'
          and download_lease_token = ${job.leaseToken}
        returning id
      `;
      return rows.length === 0 ? "stale" : status === "pending" ? "retried" : status;
    },
    async failStranded(now) {
      const rows = await sql<{ id: string }[]>`
        update whatsapp_message_media
        set download_status = 'failed',
          download_last_error_code = 'media_lease_exhausted',
          download_lease_token = null,
          download_lease_expires_at = null,
          download_revision = download_revision + 1
        where download_status = 'processing'
          and download_attempt_count >= download_max_attempts
          and download_lease_expires_at <= ${now}
        returning id
      `;
      return rows.length;
    },
    close: async () => undefined,
  };
}
