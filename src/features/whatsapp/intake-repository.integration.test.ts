import "dotenv/config";
import { afterAll, describe, expect, it, vi } from "vitest";
import { createSqlClient, type SqlClient } from "@/server/db/client";
import { createWhatsAppRepository } from "./repository";
import { normalizeWoztellInboundMessage } from "./woztell";
import { createWhatsAppIntakeRepository } from "./intake-repository";
import { createWhatsAppMediaIntakeService } from "./media-intake";
import { createDocumentStorage } from "@/features/documents/storage";
import { createMemoryR2Bucket } from "@/features/documents/local-r2";
import { englishPdf } from "@/test/synthetic-pdf";
import { createHash } from "node:crypto";
import type { AuthenticatedActor } from "@/features/auth/types";
import type postgres from "postgres";

const url = process.env.TEST_DATABASE_URL;
let sql: SqlClient | undefined;
function client() {
  return (sql ??= createSqlClient(url!, { max: 1 }));
}
afterAll(async () => {
  if (sql) await sql.end();
});
async function fixture(tx: postgres.TransactionSql) {
  const [staff] = await tx<
    { id: string; role: "Admin"; team_id: string | null; auth_user_id: string }[]
  >`select u.id,u.role,u.team_id,sp.auth_user_id from users u join staff_profiles sp on sp.user_id=u.id where u.active and sp.active and u.role='Admin' and sp.role=u.role and sp.team_id is not distinct from u.team_id limit 1`;
  const actor: AuthenticatedActor = {
    userId: staff.id,
    authUserId: staff.auth_user_id,
    role: staff.role,
    teamId: staff.team_id,
    active: true,
  };
  const [case_] = await tx<
    { id: string; company_id: string }[]
  >`select id,company_id from annual_return_cases where current_status not in ('Filed','Completed') and locked_at is null limit 1`;
  await tx`update companies set data_origin='client' where id=${case_.company_id}`;
  const message = await createWhatsAppRepository({ sql: tx }).recordInboundMessage(
    normalizeWoztellInboundMessage({
      from: `owned-t17-${crypto.randomUUID()}`,
      timestamp: "1790850000",
      messageId: `owned-t17-${crypto.randomUUID()}`,
      type: "IMAGE",
      data: { fileId: "owned-universal-file" },
    }),
  );
  return { actor, caseId: case_.id, message };
}

describe.skipIf(!url)("owned WhatsApp manual mapping and quarantined intake", () => {
  it("refuses a newly closed case before provider download", async () => {
    const rollback = new Error("owned closed case rollback");
    await expect(
      client().begin(async (tx) => {
        const { actor, caseId, message } = await fixture(tx);
        const repository = createWhatsAppIntakeRepository({ sql: tx });
        await repository.mapMessage(actor, {
          messageId: message.id,
          caseId,
          expectedVersion: 0,
          reason: "Owned case selection",
        });
        const preview = await repository.getMessagePreview(actor, message.id);
        await tx`update annual_return_cases set locked_at=now() where id=${caseId}`;
        const download = vi.fn(async () => ({
          status: "blocked" as const,
          errorCode: "owned-provider-block",
          retryable: false,
        }));
        await expect(
          createWhatsAppMediaIntakeService({ repository, download }).ingest(actor, {
            mediaId: preview.media[0].id,
            expectedMappingVersion: 1,
            category: "other",
          }),
        ).rejects.toThrow(/locked|closed/);
        expect(download).not.toHaveBeenCalled();
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
  it("rechecks staff revocation after download before creating an intake intent", async () => {
    const rollback = new Error("owned revoked intake rollback");
    await expect(
      client().begin(async (tx) => {
        const { actor, caseId, message } = await fixture(tx);
        const repository = createWhatsAppIntakeRepository({
          sql: tx,
          storage: createDocumentStorage(createMemoryR2Bucket()),
        });
        await repository.mapMessage(actor, {
          messageId: message.id,
          caseId,
          expectedVersion: 0,
          reason: "Owned case selection",
        });
        const preview = await repository.getMessagePreview(actor, message.id);
        const body = new Uint8Array(englishPdf());
        const service = createWhatsAppMediaIntakeService({
          repository,
          download: async () => {
            await tx`update staff_profiles set active=false where user_id=${actor.userId!}`;
            return {
              status: "downloaded",
              fileId: "owned-universal-file",
              body,
              checksum: createHash("sha256").update(body).digest("hex"),
              contentType: "application/pdf",
              sizeBytes: body.byteLength,
            };
          },
        });
        await expect(
          service.ingest(actor, {
            mediaId: preview.media[0].id,
            expectedMappingVersion: 1,
            category: "other",
          }),
        ).rejects.toThrow(/verified staff/);
        const [media] = await tx<
          { intake_intent_id: string | null }[]
        >`select intake_intent_id from whatsapp_message_media where id=${preview.media[0].id}`;
        expect(media.intake_intent_id).toBeNull();
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
  it("maps one inbound message with observed revision, attributes audit and replays once", async () => {
    const rollback = new Error("owned T17 mapping rollback");
    await expect(
      client().begin(async (tx) => {
        const { actor, caseId, message } = await fixture(tx);
        const repository = createWhatsAppIntakeRepository({
          sql: tx,
          storage: createDocumentStorage(createMemoryR2Bucket()),
        });
        const preview = await repository.getMessagePreview(actor, message.id);
        expect(preview).toMatchObject({ caseId: null, version: 0 });
        const input = {
          messageId: message.id,
          caseId,
          expectedVersion: 0,
          reason: "Owned local confirmed case selection",
        };
        expect(await repository.mapMessage(actor, input)).toMatchObject({
          applied: true,
          version: 1,
          idempotentReplay: false,
        });
        expect(await repository.mapMessage(actor, input)).toMatchObject({
          applied: true,
          version: 1,
          idempotentReplay: true,
        });
        await expect(
          repository.mapMessage(actor, { ...input, reason: "Different old decision" }),
        ).rejects.toMatchObject({ statusCode: 409 });
        const [audit] = await tx<
          { count: number }[]
        >`select count(*)::int count from timeline_events where event_type='whatsapp_message_mapped' and metadata->>'messageId'=${message.id} and actor_id=${actor.userId!}`;
        expect(audit.count).toBe(1);
        await tx`update staff_profiles set active=false where user_id=${actor.userId!}`;
        await expect(
          repository.mapMessage(actor, { ...input, expectedVersion: 1 }),
        ).rejects.toThrow(/verified staff/);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  it("uses the existing intent/version/scan job lifecycle once and blocks remapping received media", async () => {
    const rollback = new Error("owned T17 intake rollback");
    await expect(
      client().begin(async (tx) => {
        const { actor, caseId, message } = await fixture(tx);
        const repository = createWhatsAppIntakeRepository({
          sql: tx,
          storage: createDocumentStorage(createMemoryR2Bucket()),
        });
        await repository.mapMessage(actor, {
          messageId: message.id,
          caseId,
          expectedVersion: 0,
          reason: "Owned case selection",
        });
        const preview = await repository.getMessagePreview(actor, message.id);
        expect(preview.media).toHaveLength(1);
        const body = new Uint8Array(englishPdf());
        const download = vi.fn(async () => ({
          status: "downloaded" as const,
          fileId: "owned-universal-file",
          body,
          checksum: createHash("sha256").update(body).digest("hex"),
          contentType: "application/pdf" as const,
          sizeBytes: body.byteLength,
        }));
        const service = createWhatsAppMediaIntakeService({ repository, download });
        const input = {
          mediaId: preview.media[0].id,
          expectedMappingVersion: 1,
          category: "other" as const,
        };
        const received = await service.ingest(actor, input);
        expect(received).toMatchObject({
          status: "received",
          uploadStatus: "quarantined",
          idempotentReplay: false,
        });
        if (received.status !== "received") throw new Error("Owned intake did not receive bytes.");
        expect(await service.ingest(actor, input)).toMatchObject({
          documentId: received.documentId,
          documentVersionId: received.documentVersionId,
          idempotentReplay: true,
        });
        expect(download).toHaveBeenCalledTimes(1);
        const [source] = await tx<
          { jobs: number; verified_checksum_sha256: string | null; verification_status: string }[]
        >`select d.verification_status,v.verified_checksum_sha256,(select count(*)::int from document_scan_jobs where document_version_id=v.id) jobs from documents d join document_versions v on v.document_id=d.id where d.id=${received.documentId!}`;
        expect(source).toMatchObject({
          verification_status: "pending",
          verified_checksum_sha256: null,
          jobs: 1,
        });
        await expect(
          repository.mapMessage(actor, {
            messageId: message.id,
            caseId,
            expectedVersion: 1,
            reason: "Move received evidence",
          }),
        ).rejects.toThrow(/intake|received/);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});
