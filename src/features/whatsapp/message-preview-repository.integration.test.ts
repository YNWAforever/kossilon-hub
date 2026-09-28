import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createSqlClient } from "@/server/db/client";
import type { AuthenticatedActor } from "@/features/auth/types";
import { prepareMessageForActor, queueApprovedMessageForActor } from "./message-preview";
import { createMessagePreviewRepository } from "./message-preview-repository";
import { validateQueuedFollowUpPreview } from "@/features/annual-return/follow-up-preview-repository";
import type { NotificationOutboxRecord } from "@/features/notifications/types";

const databaseUrl = process.env.TEST_DATABASE_URL;
const sql = databaseUrl ? createSqlClient(databaseUrl, { max: 2 }) : null;

afterAll(async () => {
  await sql?.end();
});

describe.skipIf(!databaseUrl)("T18 persisted message preview", () => {
  it("rechecks verified contact in the same transaction as the reused outbox queue", async () => {
    if (!sql) throw new Error("TEST_DATABASE_URL is required.");
    const teamId = randomUUID(),
      userId = randomUUID(),
      companyId = randomUUID();
    const caseId = randomUUID(),
      contactId = randomUUID(),
      conversationId = randomUUID();
    const phone = "+8526" + String(Math.floor(Math.random() * 10000000)).padStart(7, "0");
    const now = new Date();
    const actor: AuthenticatedActor = {
      authUserId: randomUUID(),
      userId,
      role: "Staff",
      teamId,
      active: true,
    };
    try {
      await sql`insert into teams (id,name) values (${teamId},${"t18-" + teamId})`;
      await sql`
        insert into users (id,name,email,role,team_id)
        values (${userId},'T18 staff',${teamId + "@example.invalid"},'Staff',${teamId})
      `;
      await sql`
        insert into companies (
          id,company_name,cr_number,br_number,incorporation_date,
          annual_return_basis_date,registered_office,company_secretary,
          assigned_owner_id,assigned_team_id,data_origin
        ) values (
          ${companyId},'T18 fixture',${companyId},${companyId},
          '2020-01-01','2020-01-01','Test office','Test secretary',
          ${userId},${teamId},'client'
        )
      `;
      await sql`
        insert into annual_return_cases (
          id,company_id,return_year,made_up_date,filing_due_date,
          current_status,owner_id
        ) values (
          ${caseId},${companyId},2026,'2026-01-01','2026-02-01',
          'Documents pending',${userId}
        )
      `;
      await sql`
        insert into company_contacts (
          id,company_id,name,role,phone,phone_e164,
          phone_verified_at,phone_verified_by,phone_verification_evidence,
          preferred_language
        ) values (
          ${contactId},${companyId},'T18 contact','Director',${phone},${phone},
          now(),${userId},'Confirmed by client call 2026-09-27','en'
        )
      `;
      await sql`
        insert into whatsapp_contacts (id,phone_e164,company_id)
        values (${conversationId},${phone},${companyId})
      `;
      await sql`
        insert into whatsapp_messages (
          direction,status,contact_id,company_id,case_id,phone_e164,body,received_at
        ) values (
          'inbound','received',${conversationId},${companyId},${caseId},
          ${phone},'Client inbound',${new Date(now.getTime() - 3600000).toISOString()}
        )
      `;
      const repository = createMessagePreviewRepository(sql);
      const dependencies = { now: () => now, repository };
      const prepare = () =>
        prepareMessageForActor(
          actor,
          {
            caseId,
            contactId,
            conversationId,
            purpose: "reply" as const,
            draft: "Case-specific reply",
          },
          dependencies,
        );
      const first = await prepare();
      await sql`update company_contacts set phone = '+85269999999' where id = ${contactId}`;
      const [invalidated] = await sql<{ phone_e164: string | null }[]>`
        select phone_e164 from company_contacts where id = ${contactId}
      `;
      expect(invalidated.phone_e164).toBeNull();
      await expect(
        queueApprovedMessageForActor(
          actor,
          {
            previewId: first.previewId,
            previewHash: first.previewHash,
            idempotencyKey: "first",
          },
          dependencies,
        ),
      ).rejects.toThrow(/verif|contact/i);
      await sql`update company_contacts set phone = ${phone} where id = ${contactId}`;
      await sql`
        update company_contacts set phone_e164 = ${phone},
          phone_verified_at = now(), phone_verified_by = ${userId},
          phone_verification_evidence = 'Reconfirmed by client call 2026-09-27'
        where id = ${contactId}
      `;
      const second = await prepare();
      const delivery = await queueApprovedMessageForActor(
        actor,
        {
          previewId: second.previewId,
          previewHash: second.previewHash,
          idempotencyKey: "second",
        },
        dependencies,
      );
      const [outbox] = await sql<{ id: string; payload: { previewId?: string } }[]>`
        select id,payload from notification_outbox
        where idempotency_key = ${"message-preview:" + second.previewId}
      `;
      expect(outbox.payload.previewId).toBe(second.previewId);
      expect(delivery.messageId).toBeTruthy();
      const [stored] = await sql<{ queued_message_id: string | null }[]>`
        select queued_message_id from whatsapp_message_previews where id = ${second.previewId}
      `;
      expect(stored.queued_message_id).toBe(delivery.messageId);
      const [verifiedContact] = await sql<{ updated_at: string }[]>`
        select updated_at::text as updated_at from company_contacts where id = ${contactId}
      `;
      const followUpNotification = {
        companyId,
        recipient: phone,
        payload: {
          approvedPreviewKind: "follow-up",
          frozenSendMode: "text",
          caseId,
          companyId,
          contactId,
          contactVersion: verifiedContact.updated_at,
          recipientName: "T18 contact",
          recipientE164: phone,
          languageCode: "en",
          previewHash: "a".repeat(64),
          renderedText: "Case-specific follow-up",
          body: "Case-specific follow-up",
        },
      } as unknown as NotificationOutboxRecord;
      await expect(
        validateQueuedFollowUpPreview(followUpNotification, sql),
      ).resolves.toBeUndefined();
      await sql`
        update company_contacts set preferred_language = 'zh_HK', updated_at = now()
        where id = ${contactId}
      `;
      await expect(validateQueuedFollowUpPreview(followUpNotification, sql)).rejects.toMatchObject({
        code: "whatsapp_preview_stale",
      });
    } finally {
      await sql`delete from notification_outbox where company_id = ${companyId}`;
      await sql`delete from whatsapp_message_previews where company_id = ${companyId}`;
      await sql`delete from whatsapp_messages where company_id = ${companyId}`;
      await sql`delete from whatsapp_contacts where id = ${conversationId}`;
      await sql`delete from whatsapp_templates where created_by = ${userId}`;
      await sql`delete from timeline_events where company_id = ${companyId}`;
      await sql`delete from company_contacts where company_id = ${companyId}`;
      await sql`delete from annual_return_cases where company_id = ${companyId}`;
      await sql`delete from companies where id = ${companyId}`;
      await sql`delete from users where id = ${userId}`;
      await sql`delete from teams where id = ${teamId}`;
    }
  });
});
