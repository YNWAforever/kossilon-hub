import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import { createSqlClient } from "@/server/db/client";
import { createBulkOperationRepository } from "./repository";
import {
  approveOneReminderReviewForActor,
  cancelReminderReviewForActor,
  getReminderReviewForActor,
} from "./reminder-handler";

const databaseUrl = process.env.TEST_DATABASE_URL;
const sql = databaseUrl ? createSqlClient(databaseUrl, { max: 2 }) : null;
afterAll(async () => {
  await sql?.end();
});

async function withFixture(
  work: (input: {
    tx: NonNullable<typeof sql>;
    actor: AuthenticatedActor;
    caseIds: [string, string];
    contactIds: [string, string];
  }) => Promise<void>,
) {
  if (!sql) throw new Error("TEST_DATABASE_URL is required");
  const rollback = new Error("T23 fixture rollback");
  await expect(
    sql.begin(async (tx) => {
      const teamId = randomUUID(),
        userId = randomUUID();
      const caseIds: [string, string] = [randomUUID(), randomUUID()];
      const companyIds = [randomUUID(), randomUUID()];
      const contactIds: [string, string] = [randomUUID(), randomUUID()];
      const actor: AuthenticatedActor = {
        authUserId: randomUUID(),
        userId,
        role: "Manager",
        teamId,
        active: true,
      };
      await tx`insert into teams(id,name) values (${teamId},${"t23-" + teamId})`;
      await tx`insert into users(id,name,email,role,team_id)
      values (${userId},'T23 Manager',${teamId + "@example.invalid"},'Manager',${teamId})`;
      await tx`insert into staff_profiles(user_id,auth_user_id,role,team_id)
      values (${userId},${actor.authUserId},'Manager',${teamId})`;
      await tx`insert into whatsapp_templates(template_name,language_code,category,status,body,
      provider_approval_verified_at,provider_approval_evidence,created_by)
      values ('annual_return_manual_reminder','en','annual_return','active',
        'Please review your annual return documents.',now(),'T23 disposable provider evidence',${userId})
      on conflict (provider,template_name,language_code) do update set
        status='active',body=excluded.body,
        provider_approval_verified_at=excluded.provider_approval_verified_at,
        provider_approval_evidence=excluded.provider_approval_evidence`;
      for (let i = 0; i < 2; i += 1) {
        await tx`insert into companies(id,company_name,cr_number,br_number,
        incorporation_date,annual_return_basis_date,registered_office,company_secretary,
        assigned_owner_id,assigned_team_id,data_origin)
        values (${companyIds[i]},${"T23 client " + i},${companyIds[i]},${companyIds[i]},
          '2020-01-01','2020-01-01','Test office','Test secretary',${userId},${teamId},'client')`;
        await tx`insert into annual_return_cases(id,company_id,return_year,made_up_date,
        filing_due_date,current_status,owner_id)
        values (${caseIds[i]},${companyIds[i]},2026,'2026-01-01','2026-02-01',
          'Documents pending',${userId})`;
        await tx`insert into company_contacts(id,company_id,name,role,phone,phone_e164,
        phone_verified_at,phone_verified_by,phone_verification_evidence,
        preferred_language,is_primary)
        values (${contactIds[i]},${companyIds[i]},${"T23 contact " + i},'Director',
          '+85261234567','+85261234567',now(),${userId},
          'T23 disposable verified contact','en',true)`;
      }
      await work({ tx: tx as unknown as NonNullable<typeof sql>, actor, caseIds, contactIds });
      throw rollback;
    }),
  ).rejects.toBe(rollback);
}

describe.skipIf(!databaseUrl)("T23 durable reminder drafts", () => {
  it("t23_scenario_1 keeps same-phone companies distinct and replay creates no duplicate draft or send", async () => {
    await withFixture(async ({ tx, actor, caseIds }) => {
      const repo = createBulkOperationRepository({ sql: tx });
      const preview = await repo.preview(actor, {
        action: "reminderDrafts",
        selection: { kind: "ids", ids: caseIds },
        parameters: {},
      });
      expect(preview.itemsPreview.map((item) => item.state)).toEqual(["eligible", "eligible"]);
      const operation = await repo.commit(actor, {
        previewId: preview.id,
        previewHash: preview.previewHash,
        idempotencyKey: randomUUID(),
      });
      let interrupted = false;
      await repo.runBatch(operation.id, {
        limit: 2,
        afterDomainWrite: () => {
          if (!interrupted) {
            interrupted = true;
            throw new Error("T23 simulated crash after draft write");
          }
        },
      });
      expect((await repo.get(actor, operation.id)).items.map((item) => item.state).sort()).toEqual([
        "failed",
        "succeeded",
      ]);
      await repo.runBatch(operation.id, { limit: 2 });
      const view = await repo.get(actor, operation.id);
      expect(view.items.map((item) => item.state)).toEqual(["succeeded", "succeeded"]);
      expect(new Set(view.items.map((item) => item.auditRef)).size).toBe(2);
      const [drafts] = await tx<{ count: number; keys: number }[]>`
        select count(*)::int count,count(distinct logical_key)::int keys
        from bulk_reminder_reviews where case_id=any(${caseIds}::uuid[])`;
      expect(drafts).toEqual({ count: 2, keys: 2 });
      const replay = await repo.commit(actor, {
        previewId: preview.id,
        previewHash: preview.previewHash,
        idempotencyKey: randomUUID(),
      });
      expect(replay.id).toBe(operation.id);
      await repo.runBatch(operation.id, { limit: 2 });
      const cooldown = await repo.preview(actor, {
        action: "reminderDrafts",
        selection: { kind: "ids", ids: caseIds },
        parameters: {},
      });
      expect(cooldown.itemsPreview.map((item) => item.reasonCode)).toEqual([
        "REMINDER_COOLDOWN",
        "REMINDER_COOLDOWN",
      ]);
      const [outbox] = await tx<{ count: number }[]>`
        select count(*)::int count from notification_outbox
        where company_id in (select company_id from annual_return_cases
          where id=any(${caseIds}::uuid[]))`;
      expect(outbox.count).toBe(0);
      const [messages] = await tx<{ count: number }[]>`
        select count(*)::int count from whatsapp_messages
        where direction='outbound' and case_id=any(${caseIds}::uuid[])`;
      expect(messages.count).toBe(0);
      await repo.close();
    });
  });
  it("marks a post-preview assignment revision change as a per-item conflict without creating a draft", async () => {
    await withFixture(async ({ tx, actor, caseIds }) => {
      const repo = createBulkOperationRepository({ sql: tx });
      const preview = await repo.preview(actor, {
        action: "reminderDrafts",
        selection: { kind: "ids", ids: [caseIds[0]] },
        parameters: {},
      });
      await tx`update annual_return_cases
        set assignment_revision=assignment_revision+1 where id=${caseIds[0]}`;
      const operation = await repo.commit(actor, {
        previewId: preview.id,
        previewHash: preview.previewHash,
        idempotencyKey: randomUUID(),
      });
      await repo.runBatch(operation.id, { limit: 1 });
      const view = await repo.get(actor, operation.id);
      expect(view.items[0].state).toBe("conflict");
      const [drafts] = await tx<{ count: number }[]>`
        select count(*)::int count from bulk_reminder_reviews where case_id=${caseIds[0]}`;
      expect(drafts.count).toBe(0);
      await repo.close();
    });
  });

  it("skips fixture, closed, unverified-phone and unavailable-template items with distinct reasons", async () => {
    await withFixture(async ({ tx, actor, caseIds, contactIds }) => {
      const repo = createBulkOperationRepository({ sql: tx });
      await tx`update companies set data_origin='fixture'
        where id=(select company_id from annual_return_cases where id=${caseIds[0]})`;
      await tx`update annual_return_cases set current_status='Completed' where id=${caseIds[1]}`;
      const first = await repo.preview(actor, {
        action: "reminderDrafts",
        selection: { kind: "ids", ids: caseIds },
        parameters: {},
      });
      expect(
        Object.fromEntries(first.itemsPreview.map((item) => [item.resourceId, item.reasonCode])),
      ).toEqual({
        [caseIds[0]]: "FIXTURE_CASE",
        [caseIds[1]]: "CASE_CLOSED",
      });
      await tx`update companies set data_origin='client'
        where id=(select company_id from annual_return_cases where id=${caseIds[0]})`;
      await tx`update annual_return_cases set current_status='Documents pending'
        where id=${caseIds[1]}`;
      await tx`update company_contacts set phone_e164=null,phone_verified_at=null,
        phone_verified_by=null,phone_verification_evidence=null where id=${contactIds[0]}`;
      await tx`update whatsapp_templates set status='paused'
        where template_name='annual_return_manual_reminder' and language_code='en'`;
      const second = await repo.preview(actor, {
        action: "reminderDrafts",
        selection: { kind: "ids", ids: caseIds },
        parameters: {},
      });
      expect(
        Object.fromEntries(second.itemsPreview.map((item) => [item.resourceId, item.reasonCode])),
      ).toEqual({
        [caseIds[0]]: "VERIFIED_PHONE_MISSING",
        [caseIds[1]]: "APPROVED_TEMPLATE_MISSING",
      });
      await repo.close();
    });
  });

  it("t23_scenario_2 queues only on explicit item approval; replay and stale contact cannot resend", async () => {
    await withFixture(async ({ tx, actor, caseIds, contactIds }) => {
      const repo = createBulkOperationRepository({ sql: tx });
      const preview = await repo.preview(actor, {
        action: "reminderDrafts",
        selection: { kind: "ids", ids: caseIds },
        parameters: {},
      });
      const operation = await repo.commit(actor, {
        previewId: preview.id,
        previewHash: preview.previewHash,
        idempotencyKey: randomUUID(),
      });
      await repo.runBatch(operation.id, { limit: 2 });
      const reviews = await tx<{ id: string; case_id: string; preview_hash: string }[]>`
        select id,case_id,preview_hash from bulk_reminder_reviews
        where case_id=any(${caseIds}::uuid[]) order by case_id`;
      const first = reviews.find((row) => row.case_id === caseIds[0])!;
      const second = reviews.find((row) => row.case_id === caseIds[1])!;
      const queued = await approveOneReminderReviewForActor(
        actor,
        {
          reviewId: first.id,
          previewHash: first.preview_hash,
        },
        { sql: tx },
      );
      expect(queued.state).toBe("queued");
      expect(
        (
          await approveOneReminderReviewForActor(
            actor,
            {
              reviewId: first.id,
              previewHash: first.preview_hash,
            },
            { sql: tx },
          )
        ).messageId,
      ).toBe(queued.messageId);
      expect((await getReminderReviewForActor(actor, first.id, { sql: tx })).delivery?.state).toBe(
        "queued",
      );
      await tx`update notification_outbox set status='needs_reconciliation'
        where idempotency_key=(select 'message-preview:'||preview_id
          from bulk_reminder_reviews where id=${first.id})`;
      const unknown = await getReminderReviewForActor(actor, first.id, { sql: tx });
      expect(unknown.delivery?.state).toBe("needs-reconciliation");
      expect(unknown.delivery?.retryable).toBe(false);
      await tx`update notification_outbox set status='sent',delivery='provider',
        provider_message_id='t23-disposable-receipt'
        where idempotency_key=(select 'message-preview:'||preview_id
          from bulk_reminder_reviews where id=${first.id})`;
      const sent = await getReminderReviewForActor(actor, first.id, { sql: tx });
      expect(sent.delivery?.state).toBe("succeeded");
      expect(sent.delivery?.providerReceiptId).toBe("t23-disposable-receipt");
      await tx`update whatsapp_templates set body='Changed after preview'
        where template_name='annual_return_manual_reminder' and language_code='en'`;
      await expect(
        approveOneReminderReviewForActor(
          actor,
          {
            reviewId: second.id,
            previewHash: second.preview_hash,
          },
          { sql: tx },
        ),
      ).rejects.toThrow(/template changed/i);
      await tx`update whatsapp_templates set body='Please review your annual return documents.'
        where template_name='annual_return_manual_reminder' and language_code='en'`;
      await tx`update company_contacts set phone_e164='+85262345678'
        where id=${contactIds[1]}`;
      await expect(
        approveOneReminderReviewForActor(
          actor,
          {
            reviewId: second.id,
            previewHash: second.preview_hash,
          },
          { sql: tx },
        ),
      ).rejects.toThrow(/contact changed/i);
      await cancelReminderReviewForActor(actor, second.id, { sql: tx });
      await tx`update company_contacts set phone_e164=null,phone_verified_at=null,
        phone_verified_by=null,phone_verification_evidence=null
        where id=${contactIds[1]}`;
      const unverified = await repo.preview(actor, {
        action: "reminderDrafts",
        selection: { kind: "ids", ids: [caseIds[1]] },
        parameters: {},
      });
      expect(unverified.itemsPreview[0].reasonCode).toBe("VERIFIED_PHONE_MISSING");
      await tx`update company_contacts set phone_e164='+85262345678',phone_verified_at=now(),
        phone_verified_by=${actor.userId},
        phone_verification_evidence='New T23 disposable verification'
        where id=${contactIds[1]}`;
      const fresh = await repo.preview(actor, {
        action: "reminderDrafts",
        selection: { kind: "ids", ids: [caseIds[1]] },
        parameters: {},
      });
      expect(fresh.itemsPreview[0].state).toBe("eligible");
      const freshOperation = await repo.commit(actor, {
        previewId: fresh.id,
        previewHash: fresh.previewHash,
        idempotencyKey: randomUUID(),
      });
      await repo.runBatch(freshOperation.id, { limit: 1 });
      const active = await tx<{ state: string }[]>`
        select state from bulk_reminder_reviews where case_id=${caseIds[1]}
        order by created_at,id`;
      expect(active.map((row) => row.state).sort()).toEqual(["cancelled", "draft"]);
      const [outbox] = await tx<{ count: number }[]>`
        select count(*)::int count from notification_outbox
        where company_id in (select company_id from annual_return_cases
          where id=any(${caseIds}::uuid[]))`;
      expect(outbox.count).toBe(1);
      await repo.close();
    });
  });
});
