import type postgres from "postgres";
import {
  createSqlClient,
  getSqlClient,
  type CreateSqlClientOptions,
  type SqlClient,
} from "@/server/db/client";
import { oneYearLater } from "@/lib/date-math";
import { rethrowServiceSubscriptionWriteError } from "./errors";
import type {
  AddSubscriptionInput,
  CancelSubscriptionInput,
  RenewSubscriptionInput,
  ServiceSubscription,
  ServiceType,
} from "./types";

type QueryClient = SqlClient | postgres.TransactionSql;
type TransactionSqlClient = postgres.TransactionSql;

export type CreateServiceSubscriptionRepositoryOptions = CreateSqlClientOptions & {
  sql?: QueryClient;
};

export type ServiceSubscriptionRepository = {
  listSubscriptions(companyId: string): Promise<ServiceSubscription[]>;
  getCompanyTeamId(companyId: string): Promise<string | null>;
  addSubscription(input: AddSubscriptionInput): Promise<ServiceSubscription>;
  renewSubscription(input: RenewSubscriptionInput): Promise<ServiceSubscription>;
  cancelSubscription(input: CancelSubscriptionInput): Promise<ServiceSubscription>;
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

  async function hydrateById(
    client: QueryClient,
    subscriptionId: string,
  ): Promise<ServiceSubscription> {
    const rows = await client<SubscriptionRow[]>`
      select id, company_id, service_type, fee, status, renewal_date, cancelled_at
      from service_subscriptions
      where id = ${subscriptionId}
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
        `;

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
      await tx`select id from service_subscriptions where id = ${input.subscriptionId} for update`;

      const current = await hydrateById(tx, input.subscriptionId);
      if (current.status !== "Active") {
        throw new Error("Cannot renew a subscription that is not Active.");
      }

      const nextRenewalDate = oneYearLater(current.renewalDate);

      await tx`
        update service_subscriptions
        set renewal_date = ${nextRenewalDate}, updated_at = now()
        where id = ${input.subscriptionId}
      `;

      return hydrateById(tx, input.subscriptionId);
    });
  }

  async function cancelSubscription(input: CancelSubscriptionInput): Promise<ServiceSubscription> {
    return withTransaction(sql, async (tx) => {
      await assertActor(tx, input.actorId);

      // Same lock-before-read rationale as renewSubscription above.
      await tx`select id from service_subscriptions where id = ${input.subscriptionId} for update`;

      const current = await hydrateById(tx, input.subscriptionId);
      if (current.status !== "Active") {
        throw new Error("Cannot cancel a subscription that is not Active.");
      }

      await tx`
        update service_subscriptions
        set status = 'Cancelled', cancelled_at = now(), updated_at = now()
        where id = ${input.subscriptionId}
      `;

      return hydrateById(tx, input.subscriptionId);
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
    close,
  };
}
