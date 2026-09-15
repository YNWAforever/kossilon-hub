import "dotenv/config";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { createSqlClient, type SqlClient } from "@/server/db/client";
import { createMaintenanceRunRepository } from "./repository";
import { EXPECTED_MIGRATIONS } from "./schema-health";

const databaseUrl = process.env.TEST_DATABASE_URL;
const INTEGRATION_TEST_TIMEOUT_MS = 30_000;

/**
 * Every other test of this table asserts on source text or on a stub, and all of
 * them would keep passing if the SQL were wrong -- the jsonb column, the text[]
 * column and the outcome CHECK are exactly the three things a string assertion
 * cannot see. This exercises them against a real database.
 *
 * Skipped without TEST_DATABASE_URL, which is the common local state; it runs
 * in CI, and locally too against a container when that variable is set.
 */

const TEST_MARKER = "operations-integration:";

let testSql: SqlClient | undefined;

function sqlForTests(): SqlClient {
  if (!databaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for operations integration tests.");
  }
  testSql ??= createSqlClient(databaseUrl, { max: 1 });
  return testSql;
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    scheduledFor: "2026-09-11T10:00:00.000Z",
    startedAt: "2026-09-11T10:00:00.100Z",
    finishedAt: "2026-09-11T10:00:04.100Z",
    durationMs: 4000,
    outcome: "succeeded" as const,
    passes: { now: "2026-09-11T10:00:00.000Z", failures: [] },
    failedPasses: [] as string[],
    failureSummary: `${TEST_MARKER}clean`,
    triggerSource: "scheduled" as const,
    ...overrides,
  };
}

/**
 * Module level, not inside the first describe.
 *
 * Inside it, the shared client was ended the moment that block finished, so any
 * describe added after it got `write CONNECTION_ENDED` on its first query --
 * a failure that points at the database rather than at the teardown that caused
 * it.
 */
afterAll(async () => {
  await testSql?.end();
});

describe.skipIf(!databaseUrl)("maintenance run repository", () => {
  afterEach(async () => {
    // Only rows this suite created. maintenance_runs is a durable operational
    // record; a blanket delete would destroy evidence another run wrote.
    await sqlForTests()`
      delete from maintenance_runs where failure_summary like ${`${TEST_MARKER}%`}
    `;
    await sqlForTests()`
      delete from notification_outbox where idempotency_key like ${`${TEST_MARKER}%`}
    `;
  });

  it(
    "round-trips a recorded run",
    async () => {
      const repository = createMaintenanceRunRepository(databaseUrl);
      try {
        const { id } = await repository.recordRun(draft());
        expect(id).toMatch(/^[0-9a-f-]{36}$/);

        const runs = await repository.listRecentRuns(50);
        const recorded = runs.find((run) => run.id === id);

        expect(recorded).toMatchObject({
          outcome: "succeeded",
          failedPasses: [],
          triggerSource: "scheduled",
          durationMs: 4000,
        });
        expect(recorded?.scheduledFor).toBe("2026-09-11T10:00:00.000Z");
      } finally {
        await repository.close();
      }
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "stores the failed pass names as an array, not a string",
    async () => {
      const repository = createMaintenanceRunRepository(databaseUrl);
      try {
        const { id } = await repository.recordRun(
          draft({
            outcome: "partial",
            failedPasses: ["dispatchDue", "redactNotifications"],
            failureSummary: `${TEST_MARKER}partial`,
          }),
        );

        const runs = await repository.listRecentRuns(50);
        expect(runs.find((run) => run.id === id)?.failedPasses).toEqual([
          "dispatchDue",
          "redactNotifications",
        ]);
      } finally {
        await repository.close();
      }
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  /**
   * The constraint exists so "which passes failed" cannot have two answers that
   * disagree. A row claiming success while naming a failed pass is the shape
   * that would let a broken tick read as a clean one.
   */
  it(
    "refuses a run that claims success while naming a failed pass",
    async () => {
      const repository = createMaintenanceRunRepository(databaseUrl);
      try {
        await expect(
          repository.recordRun(draft({ outcome: "succeeded", failedPasses: ["dispatchDue"] })),
        ).rejects.toThrow(/maintenance_runs_outcome_agrees/);
      } finally {
        await repository.close();
      }
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "refuses a partial run that names no failed pass",
    async () => {
      const repository = createMaintenanceRunRepository(databaseUrl);
      try {
        await expect(
          repository.recordRun(draft({ outcome: "partial", failedPasses: [] })),
        ).rejects.toThrow(/maintenance_runs_outcome_agrees/);
      } finally {
        await repository.close();
      }
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  /**
   * The column was `not null` at first, which made the row below impossible to
   * insert -- so the one run this table was reordered to capture was the one it
   * could not record. It is nullable now, and this constraint keeps the
   * guarantee where it still means something: a run that reached its passes has
   * to have recorded them.
   */
  it(
    "refuses a completed run that recorded no passes",
    async () => {
      const repository = createMaintenanceRunRepository(databaseUrl);
      try {
        await expect(
          repository.recordRun(draft({ outcome: "succeeded", passes: null })),
        ).rejects.toThrow(/maintenance_runs_passes_present/);
      } finally {
        await repository.close();
      }
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  /**
   * A run that died before assembling its passes has none to name, so `failed`
   * is deliberately the one outcome the constraint leaves alone.
   */
  it(
    "accepts a failed run with no passes to name",
    async () => {
      const repository = createMaintenanceRunRepository(databaseUrl);
      try {
        const { id } = await repository.recordRun(
          draft({
            outcome: "failed",
            failedPasses: [],
            passes: null,
            failureSummary: `${TEST_MARKER}run did not complete: TypeError`,
          }),
        );
        expect(id).toBeTruthy();
      } finally {
        await repository.close();
      }
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  /**
   * A job that failed an attempt is still live work: claimDue matches
   * `status in ('pending','failed')` while attempts remain. Counting it as
   * `failed` and excluding it from pending/due/oldest made a queue that was
   * entirely mid-retry render as idle with some dead rows -- on the one screen
   * built to show whether work is moving.
   */
  it(
    "counts a backing-off job as retrying, not as failed",
    async () => {
      const sql = sqlForTests();
      const repository = createMaintenanceRunRepository(databaseUrl);
      try {
        const before = await repository.queueDepths(new Date().toISOString());

        await sql`
          insert into notification_outbox (
            company_id, channel, notification_type, idempotency_key,
            recipient, payload, status, attempt_count, max_attempts,
            next_attempt_at, retention_until
          )
          select id, 'email', 'probe', ${`${TEST_MARKER}retrying`},
                 'probe@example.test', '{}'::jsonb, 'failed', 1, 5,
                 now() - interval '1 minute', now() + interval '90 days'
          from companies order by created_at asc limit 1
        `;

        const after = await repository.queueDepths(new Date().toISOString());

        expect(after.notifications.retrying).toBe(before.notifications.retrying + 1);
        // Not terminal, so not in the count that asks for a person.
        expect(after.notifications.failed).toBe(before.notifications.failed);
        // Due, because the next tick will claim it.
        expect(after.notifications.dueNow).toBe(before.notifications.dueNow + 1);
        // And visible as a backlog rather than as nothing at all.
        expect(after.notifications.oldestPendingAt).not.toBeNull();
      } finally {
        await repository.close();
      }
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "counts a job with no attempts left as failed, not as retrying",
    async () => {
      const sql = sqlForTests();
      const repository = createMaintenanceRunRepository(databaseUrl);
      try {
        const before = await repository.queueDepths(new Date().toISOString());

        await sql`
          insert into notification_outbox (
            company_id, channel, notification_type, idempotency_key,
            recipient, payload, status, attempt_count, max_attempts,
            next_attempt_at, retention_until
          )
          select id, 'email', 'probe', ${`${TEST_MARKER}exhausted`},
                 'probe@example.test', '{}'::jsonb, 'failed', 5, 5,
                 now() - interval '1 minute', now() + interval '90 days'
          from companies order by created_at asc limit 1
        `;

        const after = await repository.queueDepths(new Date().toISOString());

        expect(after.notifications.failed).toBe(before.notifications.failed + 1);
        expect(after.notifications.retrying).toBe(before.notifications.retrying);
        expect(after.notifications.dueNow).toBe(before.notifications.dueNow);
      } finally {
        await repository.close();
      }
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "reads the dispatch outcome back out of the passes column",
    async () => {
      const repository = createMaintenanceRunRepository(databaseUrl);
      try {
        const { id } = await repository.recordRun(
          draft({
            passes: {
              now: "2026-09-12T10:00:00.000Z",
              dispatch: {
                claimed: 3,
                sent: 0,
                retried: 0,
                permanentlyFailed: 0,
                superseded: 0,
                sentButUnrecorded: 0,
                suppressedFixtureOrigin: 3,
              },
              failures: [],
            },
          }),
        );

        // Found by id, not read as `listRecentRuns(1)[0]`: that call is
        // `order by scheduled_for desc limit 1` over the WHOLE table, and
        // `draft()` hardcodes a fixed `scheduledFor`. Against a real
        // deployment a foreign row scheduled later outranks this one, and an
        // assertion against `[0]` would silently start checking someone
        // else's run instead of failing.
        const runs = await repository.listRecentRuns(50);
        const recorded = runs.find((run) => run.id === id);

        // The safety fact this whole deploy turns on: three fixture reminders
        // cancelled, none sent.
        expect(recorded?.dispatch).toEqual({ sent: 0, suppressedFixtureOrigin: 3 });
      } finally {
        await repository.close();
      }
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "reports a run with no recorded dispatch as null rather than zero",
    async () => {
      const repository = createMaintenanceRunRepository(databaseUrl);
      try {
        const { id } = await repository.recordRun(
          draft({ passes: { now: "2026-09-12T10:05:00.000Z", failures: [] } }),
        );

        // Same reason as above: a test that can pass without observing its
        // own row proves nothing about this assertion. Any foreign run that
        // simply lacks a `dispatch` key would satisfy `toBeNull()` on `[0]`
        // just as well as the row this test actually wrote.
        const runs = await repository.listRecentRuns(50);
        const recorded = runs.find((run) => run.id === id);

        expect(recorded?.dispatch).toBeNull();
      } finally {
        await repository.close();
      }
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "reports a run as null when the dispatch summary recorded only one of its two counts",
    async () => {
      const repository = createMaintenanceRunRepository(databaseUrl);
      try {
        const { id } = await repository.recordRun(
          draft({
            passes: {
              now: "2026-09-12T10:10:00.000Z",
              dispatch: { sent: 5 },
              failures: [],
            },
          }),
        );

        const runs = await repository.listRecentRuns(50);
        const recorded = runs.find((run) => run.id === id);

        // Guards the `||` in mapRun's null check specifically: changing it to
        // `&&` still passes "both null -> null" and "both present -> object"
        // above, but would report `{ sent: 5, suppressedFixtureOrigin: NaN }`
        // here instead of the missing-half case this run actually is.
        expect(recorded?.dispatch).toBeNull();
      } finally {
        await repository.close();
      }
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "reads every queue depth without writing to any of them",
    async () => {
      const repository = createMaintenanceRunRepository(databaseUrl);
      try {
        const depths = await repository.queueDepths("2026-09-11T10:00:00.000Z");

        for (const queue of [depths.documentScans, depths.documentAnalysis, depths.notifications]) {
          expect(Number.isInteger(queue.pending)).toBe(true);
          expect(Number.isInteger(queue.dueNow)).toBe(true);
          // Counted, not sampled: a queue cannot have more due than pending.
          expect(Number.isInteger(queue.retrying)).toBe(true);
          // Due is drawn from pending plus retrying, so it cannot exceed both.
          expect(queue.dueNow).toBeLessThanOrEqual(queue.pending + queue.retrying);
        }
        expect(Number.isInteger(depths.handoffsAwaitingTransmission)).toBe(true);
      } finally {
        await repository.close();
      }
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );
});

/**
 * `to_regclass` against a real server, because this is the one query in the
 * repository that has to behave correctly when the database is in the state the
 * rest of the code cannot cope with.
 *
 * A unit test with a stubbed client proves nothing here: what is being checked
 * is that Postgres answers "no such table" as a null rather than by raising, and
 * that the ledger read is skipped when it would fail.
 */
describe.skipIf(!databaseUrl)("schema ledger", () => {
  it(
    "reports the ledger this migrated database has",
    async () => {
      const repository = createMaintenanceRunRepository(databaseUrl);
      try {
        const ledger = await repository.schemaLedger();

        expect(ledger.present).toBe(true);
        expect(ledger.applied).toContain("0001_annual_return_control_center.sql");
        expect(ledger.applied).toContain("0033_maintenance_runs.sql");
      } finally {
        await repository.close();
      }
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  /**
   * Cross-checked against EXPECTED_MIGRATIONS, not against the same query run
   * twice.
   *
   * The first version of this compared `schemaLedger()` to a hand-written
   * `select id from schema_migrations` -- the byte-identical query with the
   * byte-identical row mapping. That is f(X) === f(X), true of any
   * implementation, and it would have passed just as happily if schemaLedger
   * returned the wrong column. EXPECTED_MIGRATIONS is an independent source:
   * the directory this build ships, versus what the migrator actually wrote
   * into this database.
   */
  it(
    "returns exactly the migrations this build expects",
    async () => {
      const repository = createMaintenanceRunRepository(databaseUrl);

      try {
        const ledger = await repository.schemaLedger();
        expect([...ledger.applied].sort()).toEqual([...EXPECTED_MIGRATIONS].sort());
      } finally {
        await repository.close();
      }
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  /**
   * The branch that fires exactly when everything else is broken.
   *
   * A bare database is created on the same server for it, because the branch
   * cannot be reached on the migrated one the rest of the suite needs, and a
   * stub would only prove that a stub returns what it was told to. What is
   * actually checked is that Postgres answers "no such table" by returning null
   * from `to_regclass` rather than by raising -- if it raised, the ledger read
   * would throw on precisely the databases this feature exists to report on, and
   * /operations would go down instead of explaining itself.
   */
  it(
    "reports a database with no ledger as absent, not as an empty ledger",
    async (ctx) => {
      const admin = sqlForTests();

      // Skipped visibly, never passed quietly. Managed Postgres commonly
      // withholds CREATEDB, and a test that returns early on a missing
      // privilege would report as green while having checked nothing.
      const [role] = await admin<{ rolcreatedb: boolean; rolsuper: boolean }[]>`
        select rolcreatedb, rolsuper from pg_roles where rolname = current_user
      `;
      if (!role?.rolcreatedb && !role?.rolsuper) {
        ctx.skip();
        return;
      }

      // Unique per process: the name used to be fixed, so two runs against one
      // server would drop each other's probe mid-test.
      const probe = `kossilon_schema_ledger_probe_${process.pid}`;
      const probeUrl = new URL(databaseUrl!);
      probeUrl.pathname = `/${probe}`;

      await admin.unsafe(`drop database if exists ${probe}`);
      await admin.unsafe(`create database ${probe}`);

      const repository = createMaintenanceRunRepository(probeUrl.toString());
      try {
        const ledger = await repository.schemaLedger();

        expect(ledger.present).toBe(false);
        expect(ledger.applied).toEqual([]);
      } finally {
        // Closed before the drop: Postgres refuses to drop a database that
        // still has a connection open to it.
        await repository.close();
        await admin.unsafe(`drop database if exists ${probe}`);
      }
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );
});
