import type postgres from "postgres";
import type { AuthenticatedActor } from "@/features/auth/types";
import { assertAnnualReturnActionAllowed } from "@/features/annual-return/permissions";
import { hongKongBusinessDate } from "@/features/annual-return/workflow";
import {
  assertPreviewStillCurrent,
  prepareMessageForActor,
  queueApprovedMessageForActor,
  type MessagePreview,
} from "@/features/whatsapp/message-preview";
import { createMessagePreviewRepository } from "@/features/whatsapp/message-preview-repository";
import { findApprovedTemplate } from "@/features/whatsapp/approved-templates";
import { getSqlClient, type SqlClient } from "@/server/db/client";

type QueryClient = SqlClient | postgres.TransactionSql;
function transaction<T>(
  sql: QueryClient,
  work: (tx: postgres.TransactionSql) => Promise<T>,
): Promise<T> {
  return "begin" in sql ? (sql.begin(work) as Promise<T>) : (sql.savepoint(work) as Promise<T>);
}
export type LogicalReminder = {
  caseId: string;
  companyId: string;
  contactId: string;
  recipientPhone: string;
  purpose: "reminder";
  cadenceSlot: string;
};

const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const E164 = /^\+[1-9]\d{7,14}$/;
const SLOT = /^\d{4}-\d{2}-\d{2}$/;

/** A logical send belongs to a case, contact and cadence slot, never merely a phone. */
export function logicalReminderKey(item: LogicalReminder): string {
  if (![item.caseId, item.companyId, item.contactId].every((id) => UUID.test(id)))
    throw new Error("Reminder case, company and contact IDs are required.");
  if (!E164.test(item.recipientPhone)) throw new Error("A verified E.164 recipient is required.");
  if (!SLOT.test(item.cadenceSlot) || Number.isNaN(Date.parse(item.cadenceSlot + "T00:00:00Z")))
    throw new Error("A valid cadence slot is required.");
  return [
    "bulk-reminder",
    item.caseId,
    item.companyId,
    item.purpose,
    item.cadenceSlot,
    item.contactId,
  ].join(":");
}

/** Collapse repeated selections, but refuse conflicting contents for one logical send. */
export function selectLogicalReminders(items: readonly LogicalReminder[]): LogicalReminder[] {
  if (items.length > 1000) throw new Error("Reminder selection exceeds 1000 items.");
  const selected = new Map<string, LogicalReminder>();
  for (const item of items) {
    const key = logicalReminderKey(item);
    const previous = selected.get(key);
    if (previous && previous.recipientPhone !== item.recipientPhone)
      throw new Error("Recipient changed for one logical reminder; preview again.");
    if (!previous) selected.set(key, item);
  }
  return [...selected.values()];
}

export type DeliveryObservation = {
  state: "pending" | "processing" | "sent" | "failed" | "cancelled" | "needs_reconciliation";
  messageId: string | null;
  providerReceiptId: string | null;
  delivery: "provider" | "simulated" | null;
};
export type ReminderDeliveryDisposition = {
  state: "queued" | "succeeded" | "failed" | "needs-reconciliation";
  retryable: false;
  messageId: string | null;
  providerReceiptId: string | null;
  delivery: "provider" | "simulated" | null;
};

/** A delivery that may have crossed the provider boundary needs human reconciliation. */
export function deliveryDisposition(observation: DeliveryObservation): ReminderDeliveryDisposition {
  if (
    observation.state === "needs_reconciliation" ||
    (observation.state === "sent" &&
      (observation.delivery !== "provider" || !observation.providerReceiptId))
  ) {
    return { ...observation, state: "needs-reconciliation", retryable: false };
  }
  if (observation.state === "sent") return { ...observation, state: "succeeded", retryable: false };
  if (observation.state === "failed" || observation.state === "cancelled")
    return { ...observation, state: "failed", retryable: false };
  return { ...observation, state: "queued", retryable: false };
}

type CaseRow = {
  id: string;
  companyId: string;
  companyName: string;
  companyTeamId: string;
  ownerId: string;
  reviewerId: string | null;
  status: string;
  dataOrigin: "client" | "fixture";
  revision: number;
};
type ContactRow = {
  id: string;
  name: string;
  phoneE164: string | null;
  phoneVerifiedAt: string | null;
  languageCode: string | null;
};
export type ReminderDraftDecision = {
  caseId: string;
  revision: number | null;
  state: "eligible" | "skipped" | "forbidden" | "conflict";
  reasonCode: string | null;
  preview: MessagePreview | null;
  logicalKey: string | null;
  cadenceSlot: string | null;
};
export type ReminderReviewResult = {
  state: "succeeded" | "skipped";
  reasonCode: string | null;
  revision: number;
  auditRef: string | null;
};

async function currentActor(sql: QueryClient, actor: AuthenticatedActor) {
  if (!actor.active || !actor.userId || (actor.role !== "Admin" && actor.role !== "Manager"))
    throw new Error("Forbidden: active Admin or Manager required.");
  const [row] = await sql<{ userId: string; role: string; teamId: string | null }[]>`
    select u.id "userId",u.role,u.team_id "teamId" from users u
    join staff_profiles sp on sp.user_id=u.id
    where u.id=${actor.userId} and sp.auth_user_id=${actor.authUserId}
      and u.active and sp.active and u.role=sp.role
      and u.team_id is not distinct from sp.team_id
    for share of u,sp`;
  if (!row || row.role !== actor.role || row.teamId !== actor.teamId)
    throw new Error("Forbidden: actor scope changed; preview again.");
  return row;
}
function caseInScope(actor: AuthenticatedActor, row: CaseRow): boolean {
  return actor.role === "Admin" || (Boolean(actor.teamId) && actor.teamId === row.companyTeamId);
}
async function readCase(sql: QueryClient, caseId: string, lock = false): Promise<CaseRow | null> {
  const rows = await sql<CaseRow[]>`
    select a.id,c.id "companyId",c.company_name "companyName",
      c.assigned_team_id "companyTeamId",a.owner_id "ownerId",
      a.reviewer_id "reviewerId",a.current_status status,
      c.data_origin "dataOrigin",a.assignment_revision revision
    from annual_return_cases a join companies c on c.id=a.company_id
    where a.id=${caseId}
    ${lock ? sql`for update of a,c` : sql``}`;
  return rows[0] ?? null;
}
async function primaryContact(
  sql: QueryClient,
  companyId: string,
): Promise<{ contact: ContactRow | null; reasonCode: string | null }> {
  const contacts = await sql<ContactRow[]>`
    select id,name,phone_e164 "phoneE164",
      phone_verified_at::text "phoneVerifiedAt",preferred_language "languageCode"
    from company_contacts
    where company_id=${companyId} and is_primary
    order by id limit 2`;
  if (contacts.length === 0) return { contact: null, reasonCode: "PRIMARY_CONTACT_MISSING" };
  if (contacts.length > 1) return { contact: null, reasonCode: "PRIMARY_CONTACT_AMBIGUOUS" };
  const contact = contacts[0];
  if (!contact.phoneE164 || !contact.phoneVerifiedAt)
    return { contact: null, reasonCode: "VERIFIED_PHONE_MISSING" };
  if (!contact.languageCode) return { contact: null, reasonCode: "CONTACT_LANGUAGE_MISSING" };
  return { contact, reasonCode: null };
}
async function inCooldown(sql: QueryClient, caseId: string, now: Date): Promise<boolean> {
  const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60_000).toISOString();
  const rows = await sql<{ recent: boolean }[]>`
    select exists(
      select 1 from reminder_logs where case_id=${caseId}
        and recorded_sent_at >= ${cutoff}::timestamptz
      union all
      select 1 from bulk_reminder_reviews where case_id=${caseId}
        and created_at >= ${cutoff}::timestamptz
          and state in ('draft','queued','needs-reconciliation')
    ) recent`;
  return rows[0]?.recent === true;
}

/** T23 dry run: creates short-lived T18 previews but never queues a message. */
export async function previewReminderDraftsForActor(
  actor: AuthenticatedActor,
  caseIds: string[],
  dependencies: { sql?: QueryClient; now?: Date } = {},
): Promise<ReminderDraftDecision[]> {
  if (caseIds.length < 1 || caseIds.length > 1000 || new Set(caseIds).size !== caseIds.length)
    throw new Error("Select 1 to 1000 distinct annual-return cases.");
  const sql = dependencies.sql ?? getSqlClient();
  await currentActor(sql, actor);
  const now = dependencies.now ?? new Date();
  const slot = hongKongBusinessDate(now);
  const repository = createMessagePreviewRepository(sql);
  const decisions: ReminderDraftDecision[] = [];
  for (const caseId of caseIds) {
    const row = await readCase(sql, caseId);
    if (!row || !caseInScope(actor, row)) {
      decisions.push({
        caseId,
        revision: null,
        state: "forbidden",
        reasonCode: "CASE_OUT_OF_SCOPE",
        preview: null,
        logicalKey: null,
        cadenceSlot: null,
      });
      continue;
    }
    const base = {
      caseId,
      revision: row.revision,
      preview: null,
      logicalKey: null,
      cadenceSlot: null,
    };
    if (row.dataOrigin !== "client") {
      decisions.push({ ...base, state: "skipped", reasonCode: "FIXTURE_CASE" });
      continue;
    }
    if (row.status === "Filed" || row.status === "Completed") {
      decisions.push({ ...base, state: "skipped", reasonCode: "CASE_CLOSED" });
      continue;
    }
    if (await inCooldown(sql, caseId, now)) {
      decisions.push({ ...base, state: "skipped", reasonCode: "REMINDER_COOLDOWN" });
      continue;
    }
    const primary = await primaryContact(sql, row.companyId);
    if (!primary.contact) {
      decisions.push({ ...base, state: "skipped", reasonCode: primary.reasonCode });
      continue;
    }
    const context = await repository.getContext({
      caseId,
      contactId: primary.contact.id,
      templateName: "annual_return_manual_reminder",
    });
    const approved = context.template && findApprovedTemplate(context.template.name);
    if (
      !context.template?.active ||
      !context.template.providerApprovalVerified ||
      approved?.languageCode !== context.template.languageCode
    ) {
      decisions.push({ ...base, state: "skipped", reasonCode: "APPROVED_TEMPLATE_MISSING" });
      continue;
    }
    try {
      const preview = await prepareMessageForActor(
        actor,
        {
          caseId,
          contactId: primary.contact.id,
          purpose: "reminder",
          draft: context.template.body,
        },
        { now: () => now, repository },
      );
      decisions.push({
        caseId,
        revision: row.revision,
        state: "eligible",
        reasonCode: null,
        preview,
        logicalKey: logicalReminderKey({
          caseId,
          companyId: row.companyId,
          contactId: primary.contact.id,
          recipientPhone: preview.recipientE164,
          purpose: "reminder",
          cadenceSlot: slot,
        }),
        cadenceSlot: slot,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      decisions.push({
        ...base,
        state: /forbidden|permission|access/i.test(message) ? "forbidden" : "conflict",
        reasonCode: "PREVIEW_UNAVAILABLE",
      });
    }
  }
  return decisions;
}

/** One versioned and reauthorized draft write; the T09 runner calls it per item. */
export async function applyOneReminderReviewForActor(
  actor: AuthenticatedActor,
  input: {
    operationItemId: string;
    caseId: string;
    contactId: string;
    previewId: string;
    previewHash: string;
    logicalKey: string;
    cadenceSlot: string;
    expectedRevision: number;
  },
  dependencies: { sql?: QueryClient; now?: Date } = {},
): Promise<ReminderReviewResult> {
  const sql = dependencies.sql ?? getSqlClient();
  const now = dependencies.now ?? new Date();
  return transaction(sql, async (tx) => {
    const current = await currentActor(tx, actor);
    const row = await readCase(tx, input.caseId, true);
    if (!row || !caseInScope(actor, row)) throw new Error("Forbidden: case outside actor scope.");
    if (row.revision !== input.expectedRevision)
      throw new Error("Case assignment revision changed; preview again.");
    if (row.dataOrigin !== "client" || row.status === "Filed" || row.status === "Completed")
      throw new Error("Case is no longer eligible for reminders.");
    assertAnnualReturnActionAllowed(
      {
        id: current.userId,
        role: actor.role as "Admin" | "Manager",
        teamId: current.teamId,
        active: true,
      },
      {
        id: row.id,
        companyName: row.companyName,
        companyTeamId: row.companyTeamId,
        ownerId: row.ownerId,
        reviewerId: row.reviewerId,
      },
      "record_reminder",
    );
    const [stored] = await tx<{ payload: MessagePreview; preview_hash: string }[]>`
      select payload,preview_hash from whatsapp_message_previews
      where id=${input.previewId} and case_id=${input.caseId}
        and contact_id=${input.contactId} for update`;
    if (
      !stored ||
      stored.preview_hash !== input.previewHash ||
      stored.payload.previewHash !== input.previewHash ||
      stored.payload.createdBy !== actor.userId
    )
      throw new Error("Message preview changed; review again.");
    const preview = stored.payload;
    const expectedKey = logicalReminderKey({
      caseId: preview.caseId,
      companyId: preview.companyId,
      contactId: preview.contactId,
      recipientPhone: preview.recipientE164,
      purpose: "reminder",
      cadenceSlot: input.cadenceSlot,
    });
    if (
      expectedKey !== input.logicalKey ||
      preview.purpose !== "reminder" ||
      hongKongBusinessDate(new Date(preview.createdAt)) !== input.cadenceSlot
    )
      throw new Error("Logical reminder identity changed.");
    const repository = createMessagePreviewRepository(tx);
    const context = await repository.getContext({
      caseId: preview.caseId,
      contactId: preview.contactId,
      conversationId: preview.conversationId,
      templateName: preview.templateName,
    });
    assertPreviewStillCurrent(preview, context, now);
    const [existing] = await tx<{ id: string }[]>`
      select id from bulk_reminder_reviews where logical_key=${input.logicalKey}
        and state <> 'cancelled'`;
    if (existing)
      return {
        state: "skipped",
        reasonCode: "ALREADY_DRAFTED",
        revision: row.revision,
        auditRef: null,
      };
    if (await inCooldown(tx, input.caseId, now))
      return {
        state: "skipped",
        reasonCode: "REMINDER_COOLDOWN",
        revision: row.revision,
        auditRef: null,
      };
    const [saved] = await tx<{ id: string }[]>`
      insert into bulk_reminder_reviews(
        operation_item_id,logical_key,case_id,company_id,contact_id,cadence_slot,
        preview_id,preview_hash,created_by_id)
      values (${input.operationItemId},${input.logicalKey},${input.caseId},
        ${row.companyId},${input.contactId},${input.cadenceSlot},
        ${input.previewId},${input.previewHash},${actor.userId})
      on conflict do nothing returning id`;
    return saved
      ? { state: "succeeded", reasonCode: null, revision: row.revision, auditRef: saved.id }
      : { state: "skipped", reasonCode: "ALREADY_DRAFTED", revision: row.revision, auditRef: null };
  });
}

/** Human-approved substep only: T18 service enqueues one frozen preview atomically. */
export async function approveOneReminderReviewForActor(
  actor: AuthenticatedActor,
  input: { reviewId: string; previewHash: string },
  dependencies: { sql?: QueryClient; now?: Date } = {},
): Promise<{ state: "queued"; messageId: string; replayed: boolean }> {
  const sql = dependencies.sql ?? getSqlClient();
  return transaction(sql, async (tx) => {
    await currentActor(tx, actor);
    const [review] = await tx<
      {
        state: string;
        created_by_id: string;
        preview_id: string;
        preview_hash: string;
        logical_key: string;
        message_id: string | null;
        case_id: string;
        revision_before: number;
      }[]
    >`select r.*,i.revision_before from bulk_reminder_reviews r
      join bulk_operation_items i on i.id=r.operation_item_id
      where r.id=${input.reviewId} for update of r`;
    if (!review || review.created_by_id !== actor.userId)
      throw new Error("Forbidden: reminder review belongs to another actor.");
    if (review.preview_hash !== input.previewHash)
      throw new Error("Reminder preview changed; review again.");
    if (review.state === "queued" && review.message_id) {
      const row = await readCase(tx, review.case_id);
      if (!row || !caseInScope(actor, row)) throw new Error("Forbidden: case outside actor scope.");
      return { state: "queued", messageId: review.message_id, replayed: true };
    }
    if (review.state !== "draft")
      throw new Error("Reminder needs reconciliation; do not retry automatically.");
    // Match T18's preview -> case lock order before its queueIfCurrent substep.
    await tx`select id from whatsapp_message_previews
      where id=${review.preview_id} for update`;
    const row = await readCase(tx, review.case_id, true);
    if (!row || !caseInScope(actor, row)) throw new Error("Forbidden: case outside actor scope.");
    if (row.revision !== review.revision_before)
      throw new Error("Case assignment revision changed; preview again.");
    const repository = createMessagePreviewRepository(tx);
    const delivery = await queueApprovedMessageForActor(
      actor,
      {
        previewId: review.preview_id,
        previewHash: review.preview_hash,
        idempotencyKey: review.logical_key,
      },
      { now: () => dependencies.now ?? new Date(), repository },
    );
    await tx`update bulk_reminder_reviews set state='queued',
      message_id=${delivery.messageId},updated_at=now()
      where id=${input.reviewId} and state='draft'`;
    return { state: "queued", messageId: delivery.messageId, replayed: delivery.replayed };
  });
}

/** Read the frozen review and durable provider outcome without scheduling a retry. */
export async function getReminderReviewForActor(
  actor: AuthenticatedActor,
  reviewId: string,
  dependencies: { sql?: QueryClient } = {},
) {
  const sql = dependencies.sql ?? getSqlClient();
  return transaction(sql, async (tx) => {
    await currentActor(tx, actor);
    const [review] = await tx<
      {
        id: string;
        case_id: string;
        created_by_id: string;
        state: string;
        preview_hash: string;
        message_id: string | null;
        payload: MessagePreview;
      }[]
    >`select r.id,r.case_id,r.created_by_id,r.state,r.preview_hash,
        r.message_id,p.payload from bulk_reminder_reviews r
        join whatsapp_message_previews p on p.id=r.preview_id
        where r.id=${reviewId}`;
    if (!review || review.created_by_id !== actor.userId)
      throw new Error("Forbidden: reminder review belongs to another actor.");
    const row = await readCase(tx, review.case_id);
    if (!row || !caseInScope(actor, row)) throw new Error("Forbidden: case outside actor scope.");
    const [outbox] = review.message_id
      ? await tx<
          {
            status: DeliveryObservation["state"];
            provider_message_id: string | null;
            delivery: DeliveryObservation["delivery"];
          }[]
        >`select o.status,o.provider_message_id,o.delivery from notification_outbox o
        join whatsapp_messages m on m.id=${review.message_id}
          and m.case_id=${review.case_id} and m.company_id=${row.companyId}
        where o.idempotency_key=${"message-preview:" + review.payload.previewId}
          and o.company_id=${row.companyId}`
      : [];
    const delivery = review.message_id
      ? outbox
        ? deliveryDisposition({
            state: outbox.status,
            messageId: review.message_id,
            providerReceiptId: outbox.provider_message_id,
            delivery: outbox.delivery,
          })
        : {
            state: "needs-reconciliation" as const,
            retryable: false as const,
            messageId: review.message_id,
            providerReceiptId: null,
          }
      : null;
    return {
      reviewId: review.id,
      caseId: review.case_id,
      companyName: row.companyName,
      reviewState: review.state,
      previewHash: review.preview_hash,
      recipientName: review.payload.recipientName,
      recipientE164: review.payload.recipientE164,
      renderedText: review.payload.renderedText,
      sendMode: review.payload.sendMode,
      languageCode: review.payload.languageCode,
      expiresAt: review.payload.expiresAt,
      delivery,
    };
  });
}

/** Cancel an unsent draft so a changed or expired message can be previewed anew. */
export async function cancelReminderReviewForActor(
  actor: AuthenticatedActor,
  reviewId: string,
  dependencies: { sql?: QueryClient } = {},
): Promise<void> {
  const sql = dependencies.sql ?? getSqlClient();
  await transaction(sql, async (tx) => {
    await currentActor(tx, actor);
    const [review] = await tx<
      {
        case_id: string;
        created_by_id: string;
        state: string;
        message_id: string | null;
      }[]
    >`select case_id,created_by_id,state,message_id
      from bulk_reminder_reviews where id=${reviewId} for update`;
    if (!review || review.created_by_id !== actor.userId)
      throw new Error("Forbidden: reminder review belongs to another actor.");
    const row = await readCase(tx, review.case_id);
    if (!row || !caseInScope(actor, row)) throw new Error("Forbidden: case outside actor scope.");
    if (review.state === "cancelled") return;
    if (review.state !== "draft" || review.message_id)
      throw new Error("Only an unsent reminder draft can be cancelled.");
    await tx`update bulk_reminder_reviews set state='cancelled',updated_at=now()
      where id=${reviewId} and state='draft'`;
  });
}
