import "dotenv/config";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { createSqlClient, type SqlClient } from "@/server/db/client";
import { createNotificationOutboxRepository } from "./outbox";

const databaseUrl = process.env.TEST_DATABASE_URL;
const INTEGRATION_TEST_TIMEOUT_MS = 30_000;

const TEST_KEY_PREFIX = "outbox-integration:";

let testSql: SqlClient | undefined;

function sqlForTests(): SqlClient {
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required for outbox integration tests.");
  testSql ??= createSqlClient(databaseUrl, { max: 1 });
  return testSql;
}

async function seededCompanyId(sql: SqlClient): Promise<string> {
  const rows = await sql<
    { id: string }[]
  >`select id from companies order by created_at asc limit 1`;
  if (!rows[0]) throw new Error("Outbox integration tests need a seeded company.");
  return rows[0].id;
}

/**
 * The retention pass is the only code in this change set that rewrites rows on a
 * schedule, and every other test covering it asserts on source text — which would
 * keep passing if the SQL were wrong. This exercises it against a real database.
 *
 * It exists because an earlier draft of the pass DELETEd rows instead of redacting
 * them. Both shapes satisfy a string assertion; only one satisfies the schema's
 * redaction constraint and leaves the firm's audit trail intact.
 */
describe.skipIf(!databaseUrl)("notification outbox retention against Postgres", () => {
  afterEach(async () => {
    const sql = sqlForTests();
    await sql`delete from notification_outbox where idempotency_key like ${TEST_KEY_PREFIX + "%"}`;
  });

  afterAll(async () => {
    if (testSql) await testSql.end();
  });

  async function enqueue(
    sql: SqlClient,
    companyId: string,
    key: string,
    overrides: { status?: string; attemptCount?: number; retentionUntil?: string } = {},
  ): Promise<string> {
    const repository = createNotificationOutboxRepository({ sql });
    const record = await repository.enqueue({
      companyId,
      channel: "email",
      notificationType: "sla_warning",
      idempotencyKey: TEST_KEY_PREFIX + key,
      recipient: "staff@example.test",
      payload: { subject: "Annual return overdue" },
    });

    await sql`
      update notification_outbox
      set status = ${overrides.status ?? "sent"},
          attempt_count = ${overrides.attemptCount ?? 1},
          retention_until = ${overrides.retentionUntil ?? "2020-01-01T00:00:00.000Z"}
      where id = ${record.id}
    `;

    return record.id;
  }

  it(
    "redacts a settled row past retention without deleting it",
    async () => {
      const sql = sqlForTests();
      const companyId = await seededCompanyId(sql);
      const id = await enqueue(sql, companyId, "settled");

      const result = await createNotificationOutboxRepository({ sql }).redactExpired(
        new Date().toISOString(),
      );
      expect(result.redacted).toBe(1);

      const rows = await sql<
        {
          id: string;
          recipient: string | null;
          payload: unknown;
          provider_message_id: string | null;
          last_error_code: string | null;
          last_error_message: string | null;
          redacted_at: Date | null;
          company_id: string;
          notification_type: string;
          status: string;
        }[]
      >`select * from notification_outbox where id = ${id}`;

      // The row survives — that is the whole point.
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row.redacted_at).not.toBeNull();
      expect(row.recipient).toBeNull();
      expect(row.payload).toBeNull();
      expect(row.provider_message_id).toBeNull();
      expect(row.last_error_code).toBeNull();
      expect(row.last_error_message).toBeNull();
      // ...and the audit facts survive with it.
      expect(row.company_id).toBe(companyId);
      expect(row.notification_type).toBe("sla_warning");
      expect(row.status).toBe("sent");
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "leaves a pending notification alone however old its retention date",
    async () => {
      const sql = sqlForTests();
      const companyId = await seededCompanyId(sql);
      const id = await enqueue(sql, companyId, "pending", { status: "pending", attemptCount: 0 });

      const result = await createNotificationOutboxRepository({ sql }).redactExpired(
        new Date().toISOString(),
      );
      expect(result.redacted).toBe(0);

      const rows = await sql<
        { recipient: string | null; redacted_at: Date | null }[]
      >`select recipient, redacted_at from notification_outbox where id = ${id}`;
      expect(rows[0].recipient).toBe("staff@example.test");
      expect(rows[0].redacted_at).toBeNull();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "leaves a failed notification that still has attempts remaining",
    async () => {
      const sql = sqlForTests();
      const companyId = await seededCompanyId(sql);
      const id = await enqueue(sql, companyId, "retrying", { status: "failed", attemptCount: 1 });

      const result = await createNotificationOutboxRepository({ sql }).redactExpired(
        new Date().toISOString(),
      );
      expect(result.redacted).toBe(0);

      const rows = await sql<
        { recipient: string | null }[]
      >`select recipient from notification_outbox where id = ${id}`;
      expect(rows[0].recipient).toBe("staff@example.test");
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "redacts a failed notification that has exhausted its attempts",
    async () => {
      const sql = sqlForTests();
      const companyId = await seededCompanyId(sql);
      await enqueue(sql, companyId, "exhausted", { status: "failed", attemptCount: 5 });

      const result = await createNotificationOutboxRepository({ sql }).redactExpired(
        new Date().toISOString(),
      );
      expect(result.redacted).toBe(1);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "leaves a row whose retention date has not arrived",
    async () => {
      const sql = sqlForTests();
      const companyId = await seededCompanyId(sql);
      await enqueue(sql, companyId, "future", { retentionUntil: "2999-01-01T00:00:00.000Z" });

      const result = await createNotificationOutboxRepository({ sql }).redactExpired(
        new Date().toISOString(),
      );
      expect(result.redacted).toBe(0);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  /**
   * The hole the reclaim left behind: claimDue increments attempt_count when it
   * claims and its reclaim branch is gated on attempt_count < max_attempts, so a
   * row stranded on its FINAL attempt can never be reclaimed — and redaction
   * skips it because 'processing' is not settled. Stuck forever and invisible.
   */
  it(
    "finalises a row stranded on its last attempt so it stops being invisible",
    async () => {
      const sql = sqlForTests();
      const companyId = await seededCompanyId(sql);
      const id = await enqueue(sql, companyId, "stranded-final", {
        status: "processing",
        attemptCount: 5,
      });
      // Older than the 15-minute visibility timeout.
      await sql`update notification_outbox set updated_at = now() - interval '1 hour' where id = ${id}`;

      const repository = createNotificationOutboxRepository({ sql });

      // Neither existing pass can touch it.
      expect(await repository.claimDue(new Date().toISOString(), 10)).toHaveLength(0);
      expect((await repository.redactExpired(new Date().toISOString())).redacted).toBe(0);

      expect((await repository.failStranded(new Date().toISOString())).failed).toBe(1);

      const rows = await sql<
        { status: string; last_error_code: string | null }[]
      >`select status, last_error_code from notification_outbox where id = ${id}`;
      expect(rows[0].status).toBe("failed");
      expect(rows[0].last_error_code).toBe("dispatch_stranded");

      // Now terminal, so retention can redact it.
      expect((await repository.redactExpired(new Date().toISOString())).redacted).toBe(1);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "leaves a processing row alone while it is still within the visibility timeout",
    async () => {
      const sql = sqlForTests();
      const companyId = await seededCompanyId(sql);
      await enqueue(sql, companyId, "in-flight", { status: "processing", attemptCount: 5 });

      const repository = createNotificationOutboxRepository({ sql });
      expect((await repository.failStranded(new Date().toISOString())).failed).toBe(0);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  // A stranded row that still has attempts left belongs to claimDue, not here.
  it(
    "leaves a stranded row that still has attempts remaining to the reclaim path",
    async () => {
      const sql = sqlForTests();
      const companyId = await seededCompanyId(sql);
      const id = await enqueue(sql, companyId, "stranded-retryable", {
        status: "processing",
        attemptCount: 1,
      });
      await sql`update notification_outbox set updated_at = now() - interval '1 hour' where id = ${id}`;

      const repository = createNotificationOutboxRepository({ sql });
      expect((await repository.failStranded(new Date().toISOString())).failed).toBe(0);
      expect(await repository.claimDue(new Date().toISOString(), 10)).toHaveLength(1);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  // Without `redacted_at is null` the pass would rewrite the same rows every five
  // minutes forever, and could not use notification_outbox_retention_idx.
  it(
    "does not redact the same row twice",
    async () => {
      const sql = sqlForTests();
      const companyId = await seededCompanyId(sql);
      await enqueue(sql, companyId, "once");
      const repository = createNotificationOutboxRepository({ sql });

      expect((await repository.redactExpired(new Date().toISOString())).redacted).toBe(1);
      expect((await repository.redactExpired(new Date().toISOString())).redacted).toBe(0);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );
});
