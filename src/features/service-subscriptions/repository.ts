import type postgres from "postgres";
import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";
import { oneYearLater } from "@/lib/date-math";
import { dueMilestone, type ReminderMilestone } from "@/lib/reminder-cadence";
import { enqueueNotification } from "@/features/notifications/outbox";
import { hongKongBusinessDate, toHongKongBusinessDate } from "@/lib/hong-kong-time";
import { ServiceSubscriptionWriteError, rethrowServiceSubscriptionWriteError } from "./errors";
import { buildServiceSubscriptionReminderDraft } from "./reminder-draft";
import type {
  AddSubscriptionInput,
  CancelSubscriptionInput,
  EvaluateRemindersResult,
  RenewSubscriptionInput,
  ServiceSubscription,
  ServiceType,
} from "./types";

type QueryClient = SqlClient | postgres.TransactionSql;
type TransactionSqlClient = postgres.TransactionSql;

export type ServiceSubscriptionReminderDraft = {
  id: string;
  subscriptionId: string;
  status: "draft";
  channel: "email" | "whatsapp";
  recipient: string;
  subject: string;
  body: string;
  renewalDate: string;
  milestone: string;
};

export type CreateServiceSubscriptionRepositoryOptions = CreateSqlClientOptions & {
  sql?: QueryClient;
};

export type ServiceSubscriptionRepository = {
  listSubscriptions(companyId: string): Promise<ServiceSubscription[]>;
  getCompanyTeamId(companyId: string): Promise<string | null>;
  addSubscription(input: AddSubscriptionInput): Promise<ServiceSubscription>;
  renewSubscription(input: RenewSubscriptionInput): Promise<ServiceSubscription>;
  cancelSubscription(input: CancelSubscriptionInput): Promise<ServiceSubscription>;
  /** A Hong Kong business date (YYYY-MM-DD); a full ISO instant is normalised to one. */
  evaluateReminders(businessDateOrInstant?: string): Promise<EvaluateRemindersResult>;
  listReminderDrafts(companyId: string): Promise<ServiceSubscriptionReminderDraft[]>;
  approveReminderDraft(input: {
    companyId: string;
    draftId: string;
    actorId: string;
  }): Promise<{ id: string; state: "approved" | "already_approved" }>;
  close(): Promise<void>;
};

type SubscriptionRow = {
  id: string;
  company_id: string;
  service_type: ServiceType;
  fee: number;
  status: "Active" | "Cancelled";
  renewal_date: string | Date;
  cancelled_at: string | Date | null;
};

function dateOnly(value: string | Date): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
}

function timestampString(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function mapSubscription(row: SubscriptionRow): ServiceSubscription {
  return {
    id: row.id,
    companyId: row.company_id,
    serviceType: row.service_type,
    fee: row.fee,
    status: row.status,
    renewalDate: dateOnly(row.renewal_date),
    cancelledAt: row.cancelled_at ? timestampString(row.cancelled_at) : null,
  };
}

function withTransaction<T>(
  client: QueryClient,
  handler: (tx: TransactionSqlClient) => Promise<T>,
): Promise<T> {
  if ("begin" in client) {
    return client.begin(handler) as Promise<T>;
  }

  return handler(client as TransactionSqlClient);
}

export function createServiceSubscriptionRepository(
  options?: CreateServiceSubscriptionRepositoryOptions,
): ServiceSubscriptionRepository;
export function createServiceSubscriptionRepository(
  databaseUrl: string | undefined,
  options?: CreateServiceSubscriptionRepositoryOptions,
): ServiceSubscriptionRepository;
export function createServiceSubscriptionRepository(
  databaseUrlOrOptions?: string | CreateServiceSubscriptionRepositoryOptions,
  maybeOptions?: CreateServiceSubscriptionRepositoryOptions,
): ServiceSubscriptionRepository {
  const hasDatabaseUrlArgument =
    typeof databaseUrlOrOptions === "string" || maybeOptions !== undefined;
  const options = hasDatabaseUrlArgument ? (maybeOptions ?? {}) : (databaseUrlOrOptions ?? {});
  const databaseUrl = typeof databaseUrlOrOptions === "string" ? databaseUrlOrOptions : undefined;
  const sql = options.sql ?? (databaseUrl ? createSqlClient(databaseUrl, options) : getSqlClient());
  const ownsClient = !options.sql && Boolean(databaseUrl);

  async function listSubscriptions(companyId: string): Promise<ServiceSubscription[]> {
    const rows = await sql<SubscriptionRow[]>`
      select id, company_id, service_type, fee, status, renewal_date, cancelled_at
      from service_subscriptions
      where company_id = ${companyId}
      order by service_type asc
    `;
    return rows.map(mapSubscription);
  }

  async function getCompanyTeamId(companyId: string): Promise<string | null> {
    const rows = await sql<{ assigned_team_id: string }[]>`
      select assigned_team_id from companies where id = ${companyId} limit 1
    `;
    return rows[0]?.assigned_team_id ?? null;
  }

  async function assertActor(tx: TransactionSqlClient, actorId: string): Promise<void> {
    const rows = await tx<{ id: string }[]>`
      select id from users where id = ${actorId} and active limit 1
    `;
    if (rows.length === 0) throw new Error("Service subscription actor not found or inactive.");
  }

  async function hydrateOne(
    client: QueryClient,
    companyId: string,
    serviceType: ServiceType,
  ): Promise<ServiceSubscription> {
    const rows = await client<SubscriptionRow[]>`
      select id, company_id, service_type, fee, status, renewal_date, cancelled_at
      from service_subscriptions
      where company_id = ${companyId} and service_type = ${serviceType}
      limit 1
    `;
    const [row] = rows;
    if (!row) throw new Error("Service subscription not found.");
    return mapSubscription(row);
  }

  // renewSubscription/cancelSubscription take both subscriptionId and
  // companyId from client-supplied server-fn input, and requireWritableCompany
  // (server-fns.ts) authorizes the actor against companyId alone. Without this
  // check, a subscriptionId belonging to a DIFFERENT company than the caller's
  // authorized companyId would still be mutated — a cross-tenant bypass, since
  // authorization and the actual mutation target would be scoped to two
  // different rows. Failing with the same "not found" message a genuinely
  // missing row gets (not a more specific "wrong company" message) avoids
  // confirming another team's subscription exists.
  async function hydrateByIdForCompany(
    client: QueryClient,
    subscriptionId: string,
    companyId: string,
  ): Promise<ServiceSubscription> {
    const rows = await client<SubscriptionRow[]>`
      select id, company_id, service_type, fee, status, renewal_date, cancelled_at
      from service_subscriptions
      where id = ${subscriptionId} and company_id = ${companyId}
      limit 1
    `;
    const [row] = rows;
    if (!row) throw new Error("Service subscription not found.");
    return mapSubscription(row);
  }

  async function addSubscription(input: AddSubscriptionInput): Promise<ServiceSubscription> {
    try {
      return await withTransaction(sql, async (tx) => {
        await assertActor(tx, input.actorId);

        const existing = await tx<{ id: string; status: "Active" | "Cancelled" }[]>`
          select id, status from service_subscriptions
          where company_id = ${input.companyId} and service_type = ${input.serviceType}
          limit 1
          for update
        `;

        if (existing[0]?.status === "Active") {
          throw new ServiceSubscriptionWriteError(
            "serviceType",
            "This company already has an active subscription for that service.",
          );
        }

        if (existing[0]) {
          // Reactivating a cancelled row for this (company, service_type) —
          // the unique constraint means there is at most one row per pair,
          // ever, so "add" on an existing cancelled row updates it in place
          // rather than trying (and failing) to insert a second one.
          await tx`
            update service_subscriptions
            set status = 'Active', fee = ${input.fee}, renewal_date = ${input.renewalDate},
                cancelled_at = null, updated_at = now()
            where id = ${existing[0].id}
          `;
        } else {
          await tx`
            insert into service_subscriptions (company_id, service_type, fee, renewal_date)
            values (${input.companyId}, ${input.serviceType}, ${input.fee}, ${input.renewalDate})
          `;
        }

        return hydrateOne(tx, input.companyId, input.serviceType);
      });
    } catch (error) {
      rethrowServiceSubscriptionWriteError(error);
    }
  }

  async function renewSubscription(input: RenewSubscriptionInput): Promise<ServiceSubscription> {
    return withTransaction(sql, async (tx) => {
      await assertActor(tx, input.actorId);

      // Locks the row before reading its status, so a concurrent cancel (or a
      // second concurrent renew) blocks here rather than racing: both would
      // otherwise read "Active" before either write lands, and the losing
      // write would apply unconditionally with no status re-check. Same
      // pattern as incorporation's completeCase and clients' appointOfficer.
      // Scoped by company_id too — see hydrateByIdForCompany's comment above.
      await tx`
        select id from service_subscriptions
        where id = ${input.subscriptionId} and company_id = ${input.companyId}
        for update
      `;

      const current = await hydrateByIdForCompany(tx, input.subscriptionId, input.companyId);
      if (current.status !== "Active") {
        throw new Error("Cannot renew a subscription that is not Active.");
      }

      const nextRenewalDate = oneYearLater(current.renewalDate);

      await tx`
        update service_subscriptions
        set renewal_date = ${nextRenewalDate}, updated_at = now()
        where id = ${input.subscriptionId} and company_id = ${input.companyId}
      `;
      await tx`
        update notification_outbox set status='cancelled',updated_at=now()
        where company_id=${input.companyId}
          and notification_type like 'service_subscription_reminder_%'
          and payload->>'subscriptionId'=${input.subscriptionId}
          and status in ('draft','pending') and redacted_at is null
      `;

      return hydrateByIdForCompany(tx, input.subscriptionId, input.companyId);
    });
  }

  async function cancelSubscription(input: CancelSubscriptionInput): Promise<ServiceSubscription> {
    return withTransaction(sql, async (tx) => {
      await assertActor(tx, input.actorId);

      // Same lock-before-read rationale as renewSubscription above, scoped by
      // company_id too — see hydrateByIdForCompany's comment above.
      await tx`
        select id from service_subscriptions
        where id = ${input.subscriptionId} and company_id = ${input.companyId}
        for update
      `;

      const current = await hydrateByIdForCompany(tx, input.subscriptionId, input.companyId);
      if (current.status !== "Active") {
        throw new Error("Cannot cancel a subscription that is not Active.");
      }

      await tx`
        update service_subscriptions
        set status = 'Cancelled', cancelled_at = now(), updated_at = now()
        where id = ${input.subscriptionId} and company_id = ${input.companyId}
      `;
      await tx`
        update notification_outbox set status='cancelled',updated_at=now()
        where company_id=${input.companyId}
          and notification_type like 'service_subscription_reminder_%'
          and payload->>'subscriptionId'=${input.subscriptionId}
          and status in ('draft','pending') and redacted_at is null
      `;

      return hydrateByIdForCompany(tx, input.subscriptionId, input.companyId);
    });
  }

  async function evaluateReminders(
    businessDateOrInstant: string = hongKongBusinessDate(),
  ): Promise<EvaluateRemindersResult> {
    // See annual-return's evaluateReminders: the parameter is a Hong Kong
    // business date, and normalising here rather than trusting the caller is
    // what stops a raw cron instant sweeping the wrong day's renewals.
    const now = toHongKongBusinessDate(businessDateOrInstant);
    const candidates = await sql<
      { id: string; company_id: string; company_name: string; renewal_date: string }[]
    >`
      select ss.id, ss.company_id, c.company_name, ss.renewal_date::text
      from service_subscriptions ss
      join companies c on c.id = ss.company_id
      where ss.status = 'Active'
        and ss.renewal_date <= (${now}::date + interval '30 days')
    `;

    let drafted = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      const outcome = await withTransaction(sql, async (tx) => {
        const lockedRows = await tx<
          {
            id: string;
            status: "Active" | "Cancelled";
            renewal_date: string;
          }[]
        >`
          select id, status, renewal_date::text from service_subscriptions
          where id = ${candidate.id} for update
        `;
        const locked = lockedRows[0];
        // Re-check under lock: a subscription cancelled by staff while this
        // sweep was still processing an earlier row must not receive a
        // reminder for a service that's no longer active — the same race
        // annual-return's evaluateReminders guards against for a case
        // marked Filed mid-sweep.
        if (!locked || locked.status !== "Active" || locked.renewal_date !== candidate.renewal_date)
          return null;

        const firedRows = await tx<{ milestone: ReminderMilestone }[]>`
          select milestone from service_subscription_reminder_events
          where subscription_id = ${candidate.id}
            and (
              renewal_date = ${candidate.renewal_date}::date
              or (renewal_date is null and occurred_at::date between
                  ${candidate.renewal_date}::date - interval '31 days'
                  and ${candidate.renewal_date}::date)
            )
        `;
        const milestone = dueMilestone(
          candidate.renewal_date,
          now,
          firedRows.map((row) => row.milestone),
        );
        if (!milestone) return null;

        const contactRows = await tx<
          { name: string; email: string | null; phone: string | null }[]
        >`
          select name, email, phone from company_contacts
          where company_id = ${candidate.company_id} and is_primary = true
          limit 1
        `;
        const contact = contactRows[0];

        if (!contact) {
          await tx`
            insert into timeline_events (
              company_id, event_type, actor_type, actor_id, description, metadata
            ) values (
              ${candidate.company_id}, 'service_subscription_reminder_skipped',
              'system', null, 'Automated reminder skipped: no primary contact on file.',
              ${tx.json({ subscriptionId: candidate.id, milestone, reason: "no_primary_contact" })}
            )
          `;
          return "skipped" as const;
        }

        const channel: "whatsapp" | "email" = contact.phone ? "whatsapp" : "email";
        const recipient = contact.phone ?? contact.email;

        if (!recipient) {
          await tx`
            insert into timeline_events (
              company_id, event_type, actor_type, actor_id, description, metadata
            ) values (
              ${candidate.company_id}, 'service_subscription_reminder_skipped',
              'system', null, 'Automated reminder skipped: primary contact has neither phone nor email.',
              ${tx.json({ subscriptionId: candidate.id, milestone, reason: "unreachable_primary_contact" })}
            )
          `;
          return "skipped" as const;
        }

        // A missing or unreachable contact must not consume this renewal milestone.
        const insertedEvent = await tx<{ id: string }[]>`
          insert into service_subscription_reminder_events
            (subscription_id, renewal_date, milestone, occurred_at)
          values (${candidate.id}, ${candidate.renewal_date}, ${milestone}, ${now})
          on conflict do nothing
          returning id
        `;
        if (!insertedEvent[0]) return null;

        const fullRows = await tx<SubscriptionRow[]>`
          select id, company_id, service_type, fee, status, renewal_date, cancelled_at
          from service_subscriptions where id = ${candidate.id}
        `;
        const subscription = mapSubscription(fullRows[0]);

        const queued = await enqueueNotification(tx, {
          companyId: candidate.company_id,
          initialStatus: "draft",
          channel,
          notificationType: `service_subscription_reminder_${milestone}`,
          recipient,
          // Scoped to the subscription AND its renewal date. The subscription id
          // alone is not enough: a subscription renews annually under the same
          // id, so without the date next year's reminder would collapse onto
          // this year's spent row and never be queued.
          idempotencyKey: `service-subscription-reminder:${candidate.id}:${subscription.renewalDate}:${milestone}:${channel}:${recipient}`,
          payload: {
            subscriptionId: candidate.id,
            renewalDate: subscription.renewalDate,
            milestone,
            subject: `「${candidate.company_name}」服務續期提醒`,
            body: buildServiceSubscriptionReminderDraft(
              subscription,
              candidate.company_name,
              contact.name,
              now,
            ),
          },
        });

        if (queued.idempotentReplay) return "skipped" as const;
        await tx`
          insert into timeline_events (
            company_id, event_type, actor_type, actor_id, description, metadata
          ) values (
            ${candidate.company_id}, 'service_subscription_reminder_drafted',
            'system', null, 'Reminder draft awaiting staff approval.',
            ${tx.json({
              subscriptionId: candidate.id,
              renewalDate: subscription.renewalDate,
              milestone,
              channel,
              outboxId: queued.id,
            })}
          )
        `;

        return "drafted" as const;
      });

      if (outcome === "drafted") drafted += 1;
      else if (outcome === "skipped") skipped += 1;
    }

    return { drafted, skipped };
  }

  async function listReminderDrafts(
    companyId: string,
  ): Promise<ServiceSubscriptionReminderDraft[]> {
    const rows = await sql<
      {
        id: string;
        subscription_id: string | null;
        channel: "email" | "whatsapp";
        recipient: string;
        subject: string | null;
        body: string | null;
        renewal_date: string | null;
        milestone: string | null;
      }[]
    >`
      select id,payload->>'subscriptionId' as subscription_id,channel,recipient,
             payload->>'subject' as subject,payload->>'body' as body,
             payload->>'renewalDate' as renewal_date,payload->>'milestone' as milestone
      from notification_outbox
      where company_id=${companyId} and status='draft'
        and notification_type like 'service_subscription_reminder_%'
        and redacted_at is null
      order by created_at,id
      limit 100
    `;
    return rows.flatMap((row) =>
      row.subscription_id &&
      row.recipient &&
      row.subject &&
      row.body &&
      row.renewal_date &&
      row.milestone
        ? [
            {
              id: row.id,
              subscriptionId: row.subscription_id,
              status: "draft" as const,
              channel: row.channel,
              recipient: row.recipient,
              subject: row.subject,
              body: row.body,
              renewalDate: row.renewal_date,
              milestone: row.milestone,
            },
          ]
        : [],
    );
  }

  async function approveReminderDraft(input: {
    companyId: string;
    draftId: string;
    actorId: string;
  }): Promise<{ id: string; state: "approved" | "already_approved" }> {
    return withTransaction(sql, async (tx) => {
      const [actor] = await tx<
        {
          role: string;
          team_id: string | null;
        }[]
      >`
        select role,team_id from users where id=${input.actorId} and active limit 1
      `;
      if (!actor || (actor.role !== "Admin" && actor.role !== "Manager")) {
        throw new Error("Forbidden: Manager or Admin approval required.");
      }
      const [company] = await tx<{ assigned_team_id: string }[]>`
        select assigned_team_id from companies where id=${input.companyId} limit 1
      `;
      if (!company || (actor.role === "Manager" && actor.team_id !== company.assigned_team_id)) {
        throw new Error("Forbidden: company is outside the approver's team.");
      }
      const [reference] = await tx<{ subscription_id: string | null }[]>`
        select payload->>'subscriptionId' as subscription_id
        from notification_outbox
        where id=${input.draftId} and company_id=${input.companyId}
          and notification_type like 'service_subscription_reminder_%'
          and redacted_at is null
        limit 1
      `;
      if (!reference?.subscription_id || !/^[0-9a-f-]{36}$/i.test(reference.subscription_id)) {
        throw new Error("Subscription reminder draft not found.");
      }
      // Match the sweep's lock order: subscription first, outbox second.
      const [subscription] = await tx<{ status: string; renewal_date: string }[]>`
        select status,renewal_date::text from service_subscriptions
        where id=${reference.subscription_id} and company_id=${input.companyId}
        for update
      `;
      const [draft] = await tx<
        {
          id: string;
          status: string;
          approved_by: string | null;
          channel: string;
          recipient: string | null;
          notification_type: string;
          payload: unknown;
          retention_until: string | Date;
        }[]
      >`
        select id,status,approved_by,channel,recipient,notification_type,
               payload,retention_until
        from notification_outbox
        where id=${input.draftId} and company_id=${input.companyId}
          and redacted_at is null
        for update
      `;
      if (!draft) throw new Error("Subscription reminder draft not found.");
      if (
        draft.approved_by &&
        ["pending", "processing", "sent", "failed", "needs_reconciliation"].includes(draft.status)
      ) {
        return { id: draft.id, state: "already_approved" };
      }
      if (draft.status !== "draft") throw new Error("Reminder draft is no longer approvable.");
      const payload =
        draft.payload && typeof draft.payload === "object" && !Array.isArray(draft.payload)
          ? (draft.payload as Record<string, unknown>)
          : null;
      if (
        !subscription ||
        subscription.status !== "Active" ||
        !payload ||
        payload.subscriptionId !== reference.subscription_id ||
        payload.renewalDate !== subscription.renewal_date ||
        typeof payload.milestone !== "string" ||
        draft.notification_type !== "service_subscription_reminder_" + payload.milestone ||
        typeof payload.subject !== "string" ||
        typeof payload.body !== "string" ||
        new Date(draft.retention_until).getTime() <= Date.now()
      ) {
        throw new Error(
          "Reminder draft is stale; review the current subscription before approval.",
        );
      }
      const [contact] = await tx<{ email: string | null; phone: string | null }[]>`
        select email,phone from company_contacts
        where company_id=${input.companyId} and is_primary=true limit 1
      `;
      const currentChannel = contact?.phone ? "whatsapp" : "email";
      const currentRecipient = contact?.phone ?? contact?.email ?? null;
      if (
        !currentRecipient ||
        draft.channel !== currentChannel ||
        draft.recipient !== currentRecipient
      ) {
        throw new Error("Reminder draft recipient changed; review a refreshed draft.");
      }
      await tx`
        update notification_outbox
        set status='pending',approved_by=${input.actorId},approved_at=now(),
            next_attempt_at=now(),updated_at=now()
        where id=${draft.id} and status='draft'
      `;
      await tx`
        insert into timeline_events (
          company_id,event_type,actor_type,actor_id,description,metadata
        ) values (
          ${input.companyId},'service_subscription_reminder_approved',
          'user',${input.actorId},'Reminder draft approved for outbox delivery.',
          ${tx.json({
            subscriptionId: reference.subscription_id,
            outboxId: draft.id,
            renewalDate: subscription.renewal_date,
            milestone: payload.milestone,
          })}
        )
      `;
      return { id: draft.id, state: "approved" };
    });
  }

  async function close(): Promise<void> {
    if (ownsClient && "end" in sql) await sql.end();
  }

  return {
    listSubscriptions,
    getCompanyTeamId,
    addSubscription,
    renewSubscription,
    cancelSubscription,
    evaluateReminders,
    listReminderDrafts,
    approveReminderDraft,
    close,
  };
}
