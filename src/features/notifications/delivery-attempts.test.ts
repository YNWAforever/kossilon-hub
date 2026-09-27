import type postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";
import { createSqlClient } from "@/server/db/client";
import { createNotificationOutboxRepository } from "./outbox";

const databaseUrl = process.env.TEST_DATABASE_URL;
const sql = databaseUrl ? createSqlClient(databaseUrl, { max: 3 }) : null;
const now = "2099-02-01T00:00:00.000Z";
const later = "2099-02-01T00:16:00.000Z";

async function withRollback(run: (tx: postgres.TransactionSql) => Promise<void>) {
  if (!sql) throw new Error("TEST_DATABASE_URL is required");
  try {
    await sql.begin(async (tx) => {
      await run(tx);
      throw new Error("rollback t06 fixture");
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "rollback t06 fixture") throw error;
  }
}

async function company(tx: postgres.TransactionSql, origin: "client" | "fixture") {
  const token = crypto.randomUUID();
  const rows = await tx<{ id: string }[]>`
    insert into companies (
      company_name, cr_number, br_number, incorporation_date,
      annual_return_basis_date, registered_office, company_secretary,
      assigned_owner_id, assigned_team_id, data_origin
    ) select
      ${`T06 ${token}`}, ${`T06CR${token}`}, ${`T06BR${token}`}, incorporation_date,
      annual_return_basis_date, registered_office, company_secretary,
      assigned_owner_id, assigned_team_id, ${origin}
    from companies order by created_at limit 1 returning id
  `;
  expect(rows[0]).toBeDefined();
  return rows[0].id;
}

async function enqueue(tx: postgres.TransactionSql, companyId: string, suffix: string) {
  return createNotificationOutboxRepository({ sql: tx }).enqueue({
    companyId,
    channel: "email",
    notificationType: "t06_test",
    idempotencyKey: `t06:${crypto.randomUUID()}:${suffix}`,
    recipient: "test@example.invalid",
    payload: { subject: "T06 fixture", body: "Local only" },
  });
}

describe.skipIf(!databaseUrl)("T06 durable delivery attempts", () => {
  afterAll(async () => {
    await sql?.end();
  });

  it("t18 stale preview preflight cancels without an automatic retry", async () => {
    await withRollback(async (tx) => {
      const companyId = await company(tx, "client");
      const row = await enqueue(tx, companyId, "stale-preview");
      const repository = createNotificationOutboxRepository({ sql: tx });
      const claim = (await repository.claimDeliveryAttempt(now, 500)).find(
        (item) => item.id === row.id,
      )!;
      expect(claim).toBeDefined();
      expect(
        await repository.abortClaimedAttempt(
          claim.attemptId,
          claim.leaseToken,
          "whatsapp_preview_stale",
          now,
        ),
      ).toBe("recorded");
      const [state] = await tx<{ status: string; last_error_code: string }[]>`
        select status,last_error_code from notification_outbox where id = ${row.id}
      `;
      expect(state).toEqual({
        status: "cancelled",
        last_error_code: "whatsapp_preview_stale",
      });
      expect(
        (await repository.claimDeliveryAttempt(later, 500)).some((item) => item.id === row.id),
      ).toBe(false);
    });
  });

  it("t06_scenario_1 never calls transport twice after accepted send with DB outcome failure", async () => {
    await withRollback(async (tx) => {
      const companyId = await company(tx, "client");
      const row = await enqueue(tx, companyId, "accepted-db-failure");
      const repository = createNotificationOutboxRepository({ sql: tx });
      const claim = (await repository.claimDeliveryAttempt(now, 500)).find(
        (item) => item.id === row.id,
      )!;
      expect(claim).toBeDefined();
      expect(await repository.beginProviderCall(claim.attemptId, claim.leaseToken)).toBe("started");
      let providerCalls = 1; // provider accepted, but the DB outcome write did not land
      const secondTick = await repository.claimDeliveryAttempt(later, 500);
      providerCalls += secondTick.filter((item) => item.id === row.id).length;
      expect(providerCalls).toBe(1);
      await repository.failStranded(later);
      const state = await tx<
        { status: string }[]
      >`select status from notification_outbox where id = ${row.id}`;
      expect(state[0].status).toBe("needs_reconciliation");
    });
  });

  it("t06_scenario_2 reclaims before begin but preserves unknown after begin", async () => {
    await withRollback(async (tx) => {
      const companyId = await company(tx, "client");
      const row = await enqueue(tx, companyId, "crash-boundary");
      const repository = createNotificationOutboxRepository({ sql: tx });
      const first = (await repository.claimDeliveryAttempt(now, 500)).find(
        (item) => item.id === row.id,
      )!;
      const second = (await repository.claimDeliveryAttempt(later, 500)).find(
        (item) => item.id === row.id,
      )!;
      expect(second.attemptId).not.toBe(first.attemptId);
      expect(await repository.beginProviderCall(first.attemptId, first.leaseToken)).toBe("stale");
      expect(await repository.beginProviderCall(second.attemptId, second.leaseToken)).toBe(
        "started",
      );
      expect(
        (await repository.claimDeliveryAttempt("2099-02-01T00:40:00.000Z", 500)).some(
          (item) => item.id === row.id,
        ),
      ).toBe(false);
      await repository.failStranded("2099-02-01T00:40:00.000Z");
      const state = await tx<
        { status: string }[]
      >`select status from notification_outbox where id = ${row.id}`;
      expect(state[0].status).toBe("needs_reconciliation");
    });
  });

  it("t06_scenario_3 enforces origin at claim after cancel and rejects stale lease", async () => {
    await withRollback(async (tx) => {
      const fixtureId = await company(tx, "fixture");
      const repository = createNotificationOutboxRepository({ sql: tx });
      await repository.cancelFixtureOriginNotifications(now);
      const fixture = await enqueue(tx, fixtureId, "post-cancel-fixture");
      expect(
        (await repository.claimDeliveryAttempt(now, 500)).some((item) => item.id === fixture.id),
      ).toBe(false);
      const clientId = await company(tx, "client");
      const client = await enqueue(tx, clientId, "stale-token");
      const claim = (await repository.claimDeliveryAttempt(now, 500)).find(
        (item) => item.id === client.id,
      )!;
      expect(await repository.beginProviderCall(claim.attemptId, crypto.randomUUID())).toBe(
        "stale",
      );
      expect(await repository.beginProviderCall(claim.attemptId, claim.leaseToken)).toBe("started");
    });
  });

  it("t06_scenario_3 concurrent claims create only one durable attempt", async () => {
    if (!sql) throw new Error("TEST_DATABASE_URL is required");
    const fixture = await sql.begin(async (tx) => {
      const companyId = await company(tx, "client");
      const row = await enqueue(tx, companyId, "concurrent-claim");
      return { companyId, outboxId: row.id };
    });
    try {
      const left = createNotificationOutboxRepository({ sql });
      const right = createNotificationOutboxRepository({ sql });
      const [a, b] = await Promise.all([
        left.claimDeliveryAttempt(now, 1),
        right.claimDeliveryAttempt(now, 1),
      ]);
      const claims = [...a, ...b].filter((item) => item.id === fixture.outboxId);
      expect(claims).toHaveLength(1);
      const attempts = await sql<{ attempt_count: number }[]>`
        select attempt_count from notification_delivery_attempts
        where outbox_id = ${fixture.outboxId}
      `;
      expect(attempts).toEqual([{ attempt_count: 1 }]);
      const row = await sql<{ attempt_count: number; status: string }[]>`
        select attempt_count, status from notification_outbox where id = ${fixture.outboxId}
      `;
      expect(row).toMatchObject([{ attempt_count: 1, status: "processing" }]);
    } finally {
      await sql.begin(async (tx) => {
        await tx`delete from notification_delivery_attempts where outbox_id = ${fixture.outboxId}`;
        await tx`delete from notification_outbox where id = ${fixture.outboxId}`;
        await tx`delete from companies where id = ${fixture.companyId}`;
      });
    }
  });

  it("t06_scenario_4 treats timeout as unknown, replays receipt once, and keeps retry identity", async () => {
    await withRollback(async (tx) => {
      const companyId = await company(tx, "client");
      const repository = createNotificationOutboxRepository({ sql: tx });
      const accepted = await enqueue(tx, companyId, "receipt");
      const rejected = await enqueue(tx, companyId, "rejected");
      const timedOut = await enqueue(tx, companyId, "timeout");
      const claims = await repository.claimDeliveryAttempt(now, 500);
      const attemptFor = (id: string) => claims.find((item) => item.id === id)!;
      for (const item of [accepted, rejected, timedOut]) {
        const claim = attemptFor(item.id);
        expect(await repository.beginProviderCall(claim.attemptId, claim.leaseToken)).toBe(
          "started",
        );
      }
      const a = attemptFor(accepted.id);
      expect(
        await repository.recordProviderOutcome(
          a.attemptId,
          a.leaseToken,
          { kind: "accepted", providerMessageId: "provider-1" },
          now,
        ),
      ).toBe("recorded");
      expect(
        await repository.recordProviderOutcome(
          a.attemptId,
          a.leaseToken,
          { kind: "accepted", providerMessageId: "provider-1" },
          now,
        ),
      ).toBe("replayed");
      const t = attemptFor(timedOut.id);
      expect(
        await repository.recordProviderOutcome(
          t.attemptId,
          t.leaseToken,
          { kind: "unknown", errorCode: "timeout", attemptRef: t.attemptId },
          now,
        ),
      ).toBe("recorded");
      const r = attemptFor(rejected.id);
      expect(
        await repository.recordProviderOutcome(
          r.attemptId,
          r.leaseToken,
          { kind: "definitelyRejected", code: "woztell_err_100" },
          now,
        ),
      ).toBe("recorded");
      const retry = (await repository.claimDeliveryAttempt("2099-02-01T00:02:00.000Z", 500)).find(
        (item) => item.id === rejected.id,
      )!;
      expect(retry.idempotencyKey).toBe(rejected.idempotencyKey);
      expect(
        (await repository.claimDeliveryAttempt(later, 500)).some((item) => item.id === timedOut.id),
      ).toBe(false);
    });
  });
});
