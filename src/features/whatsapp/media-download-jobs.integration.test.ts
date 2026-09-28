import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createSqlClient } from "@/server/db/client";
import { createMediaDownloadJobRepository } from "./media-download-jobs";

const databaseUrl = process.env.TEST_DATABASE_URL;
const sql = databaseUrl ? createSqlClient(databaseUrl, { max: 2 }) : null;
afterAll(async () => {
  await sql?.end();
});

describe.skipIf(!databaseUrl)("T19 durable inbound media jobs", () => {
  it("t19_scenario_1 fences download retries and never claims a quarantined duplicate", async () => {
    if (!sql) throw new Error("TEST_DATABASE_URL is required.");
    const messageId = randomUUID(),
      providerMessageId = randomUUID();
    const mediaId = randomUUID(),
      now = new Date();
    try {
      await sql`
        insert into whatsapp_messages (
          id, provider_message_id, direction, status, body, received_at
        ) values (
          ${messageId}, ${providerMessageId}, 'inbound', 'received',
          '[document]', ${now.toISOString()}
        )
      `;
      await sql`
        insert into whatsapp_message_media (id, message_id, provider_media_id, media_type, position)
        values (${mediaId}, ${messageId}, 'file-1', 'DOCUMENT', 0)
      `;
      const jobs = createMediaDownloadJobRepository(sql);
      const claimAt = new Date(Date.now() + 1000).toISOString();
      const [first] = await jobs.claimDue(claimAt, 1);
      expect(first).toMatchObject({
        id: mediaId,
        messageId,
        providerMediaId: "file-1",
        attemptCount: 1,
      });
      expect(first.objectKey).toMatch(/^whatsapp-media\//);
      expect(await jobs.claimDue(claimAt, 1)).toEqual([]);
      expect(
        await jobs.markError(first, {
          code: "media_download_failed",
          terminal: false,
          manualReupload: false,
          now: claimAt,
        }),
      ).toBe("retried");
      const later = new Date(Date.parse(claimAt) + 3 * 60_000).toISOString();
      const [second] = await jobs.claimDue(later, 1);
      expect(second).toMatchObject({ id: mediaId, attemptCount: 2 });
      expect(second.objectKey).not.toBe(first.objectKey);
      expect(second.leaseToken).not.toBe(first.leaseToken);
      const media = {
        objectKey: second.objectKey,
        checksum: "a".repeat(64),
        contentType: "application/pdf",
        sizeBytes: 24,
        fileName: "received.pdf",
      };
      expect(
        await jobs.markQuarantined(first, { ...media, objectKey: first.objectKey }, later),
      ).toBe(false);
      expect(await jobs.markQuarantined(second, media, later)).toBe(true);
      expect(await jobs.claimDue(later, 1)).toEqual([]);
      const duplicate = await sql<{ id: string }[]>`
        insert into whatsapp_message_media (message_id, provider_media_id, media_type, position)
        values (${messageId}, 'file-1', 'DOCUMENT', 0)
        on conflict do nothing returning id
      `;
      expect(duplicate).toEqual([]);
      const conflictingPosition = await sql<{ id: string }[]>`
        insert into whatsapp_message_media (message_id, provider_media_id, media_type, position)
        values (${messageId}, 'different-file', 'DOCUMENT', 0)
        on conflict do nothing returning id
      `;
      expect(conflictingPosition).toEqual([]);
      const [row] = await sql<
        { download_status: string; document_id: string | null; download_revision: number }[]
      >`
        select download_status, document_id, download_revision
        from whatsapp_message_media where id = ${mediaId}
      `;
      expect(row).toMatchObject({
        download_status: "quarantined",
        document_id: null,
        download_revision: 4,
      });
    } finally {
      await sql`delete from whatsapp_message_media where message_id = ${messageId}`;
      await sql`delete from whatsapp_messages where id = ${messageId}`;
    }
  });
});
