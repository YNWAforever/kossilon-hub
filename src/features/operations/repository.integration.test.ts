import "dotenv/config";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { createSqlClient, type SqlClient } from "@/server/db/client";
import { createMaintenanceRunRepository } from "./repository";
import { createMaintenanceJobRepository } from "./maintenance-job-repository";
import { createMaintenanceTrigger } from "@/server/maintenance-trigger";
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

describe.skipIf(!databaseUrl)("populated maintenance registry repair", () => {
  const migration = readFileSync(
    new URL("../../../db/migrations/0069_restore_maintenance_job_contract.sql", import.meta.url),
    "utf8",
  );
  it("preserves existing leases and rows across two applications", async () => {
    const rolledBack = new Error("isolated rehearsal rollback");
    await expect(
      sqlForTests().begin(async (tx) => {
        const schema = `maintenance_rehearsal_${crypto.randomUUID().replaceAll("-", "")}`;
        await tx.unsafe(`create schema ${schema}; set local search_path to ${schema},public`);
        // Create this schema's table, rather than resolving the public table.
        await tx.unsafe(
          "create table maintenance_job_runs (like public.maintenance_job_runs including all)",
        );
        await tx`insert into maintenance_job_runs(scheduled_for,job_kind,trigger_source,run_id,state,claimed_at,lease_expires_at)
        values(now(),'evaluateEscalations','scheduled','preserved','claimed',now(),now()+interval '15 minutes')`;
        const before = await tx`select * from maintenance_job_runs`;
        await tx.unsafe(migration);
        await tx.unsafe(migration);
        expect(await tx`select * from maintenance_job_runs`).toEqual(before);
        throw rolledBack;
      }),
    ).rejects.toBe(rolledBack);
  });
  it("refuses an existing table without the lease token default instead of failing later at claim", async () => {
    await expect(
      sqlForTests().begin(async (tx) => {
        const schema = `maintenance_rehearsal_${crypto.randomUUID().replaceAll("-", "")}`;
        await tx.unsafe(`create schema ${schema}; set local search_path to ${schema},public`);
        await tx.unsafe(
          "create table maintenance_job_runs (like public.maintenance_job_runs including all)",
        );
        await tx.unsafe("alter table maintenance_job_runs alter column lease_token drop default");
        await tx.unsafe(migration);
        throw new Error("Missing guard: rollback isolated rehearsal");
      }),
    ).rejects.toThrow(/Missing maintenance job identity default/);
  });
  it("refuses a same-named index with the wrong slot key", async () => {
    await expect(
      sqlForTests().begin(async (tx) => {
        const schema = `maintenance_rehearsal_${crypto.randomUUID().replaceAll("-", "")}`;
        await tx.unsafe(`create schema ${schema}; set local search_path to ${schema},public`);
        await tx.unsafe(
          "create table maintenance_job_runs (like public.maintenance_job_runs including all)",
        );
        await tx.unsafe(
          "drop index maintenance_job_scheduled_once_idx; create unique index maintenance_job_scheduled_once_idx on maintenance_job_runs(scheduled_for) where trigger_source='scheduled'",
        );
        await tx.unsafe(migration);
        throw new Error("Missing guard: rollback isolated rehearsal");
      }),
    ).rejects.toThrow(/Incompatible scheduled slot uniqueness/);
  });
});

describe.skipIf(!databaseUrl)("maintenance created_at compatibility", () => {
  const migration = readFileSync(
    new URL("../../../db/migrations/0069_restore_maintenance_job_contract.sql", import.meta.url),
    "utf8",
  );
  it("refuses an existing table without the required created_at default", async () => {
    await expect(
      sqlForTests().begin(async (tx) => {
        const schema = `maintenance_rehearsal_${crypto.randomUUID().replaceAll("-", "")}`;
        await tx.unsafe(`create schema ${schema}; set local search_path to ${schema},public`);
        await tx.unsafe(
          "create table maintenance_job_runs (like public.maintenance_job_runs including all)",
        );
        await tx.unsafe("alter table maintenance_job_runs alter column created_at drop default");
        await tx.unsafe(migration);
        throw new Error("Missing guard: rollback isolated rehearsal");
      }),
    ).rejects.toThrow(/Missing maintenance job created_at default/);
  });
});

describe.skipIf(!databaseUrl)("durable scheduled leases against Postgres", () => {
  afterEach(async () => {
    const sql = sqlForTests();
    const [table] = await sql`select to_regclass('maintenance_job_runs') is not null present`;
    if (table.present)
      await sql`delete from maintenance_job_runs where run_id like ${`${TEST_MARKER}%`}`;
  });
  it("runs a concurrent scheduled slot only once", async () => {
    let ran = 0;
    // Two independent connections exercise Postgres conflict arbitration.
    const stores = [
      createMaintenanceJobRepository({ databaseUrl }),
      createMaintenanceJobRepository({ databaseUrl }),
    ];
    const triggers = stores.map((store) =>
      createMaintenanceTrigger({
        store,
        runJob: async () => {
          ran++;
        },
      }),
    );
    const input = {
      trigger: "scheduled" as const,
      scheduledAt: new Date().toISOString(),
      runId: `${TEST_MARKER}concurrent`,
      allowedJobs: ["evaluateEscalations" as const],
    };
    try {
      await Promise.all([
        triggers[0].runMaintenanceTick(input),
        triggers[1].runMaintenanceTick({ ...input, runId: `${TEST_MARKER}second` }),
      ]);
      expect(ran).toBe(1);
    } finally {
      await Promise.all(stores.map((store) => store.close()));
    }
  });
  it("counts explicit unknown immediately and expired started leases without treating active leases as unknown", async () => {
    const sql = sqlForTests();
    const repository = createMaintenanceRunRepository(databaseUrl);
    try {
      const before = await repository.maintenanceLeaseHealth();
      await sql`insert into maintenance_job_runs(scheduled_for,job_kind,trigger_source,run_id,state,claimed_at,lease_expires_at,started_at)
        values(now(),'evaluateEscalations','manual',${`${TEST_MARKER}known-unknown`},'unknown',now(),now()+interval '15 minutes',now()),
        (now(),'evaluateEscalations','manual',${`${TEST_MARKER}active`},'started',now(),now()+interval '15 minutes',now()),
        (now(),'evaluateEscalations','manual',${`${TEST_MARKER}lost`},'started',now()-interval '20 minutes',now()-interval '5 minutes',now()-interval '20 minutes')`;
      const after = await repository.maintenanceLeaseHealth();
      expect(after.startedUnknown).toBe(before.startedUnknown + 2);
      expect(after.lastStartedAt).not.toBeNull();
    } finally {
      await repository.close();
    }
  });
  it("recovers only an unstarted expired lease and retains a started unknown outcome", async () => {
    const sql = sqlForTests();
    const store = createMaintenanceJobRepository({ sql });
    const now = new Date(),
      scheduledAt = now.toISOString(),
      next = new Date(now.getTime() + 60_000).toISOString();
    const claim = await store.claim({
      trigger: "scheduled",
      scheduledAt,
      job: "evaluateEscalations",
      runId: `${TEST_MARKER}expired`,
      now: new Date(now.getTime() - 120_000).toISOString(),
      leaseExpiresAt: new Date(now.getTime() - 60_000).toISOString(),
    });
    expect(claim).not.toBeNull();
    const renewed = await store.claim({
      trigger: "scheduled",
      scheduledAt,
      job: "evaluateEscalations",
      runId: `${TEST_MARKER}renewed`,
      now: scheduledAt,
      leaseExpiresAt: next,
    });
    expect(renewed?.token).not.toBe(claim?.token);
    expect(await store.begin(scheduledAt, "evaluateEscalations", renewed!.token)).toBe(true);
    await sql`update maintenance_job_runs set lease_expires_at=now()-interval '1 minute' where lease_token=${renewed!.token}`;
    const again = await store.claim({
      trigger: "scheduled",
      scheduledAt,
      job: "evaluateEscalations",
      runId: `${TEST_MARKER}forbidden-retry`,
      now: next,
      leaseExpiresAt: next,
    });
    expect(again).toBeNull();
    expect(await store.stateOf(scheduledAt, "evaluateEscalations")).toBe("started");
  });
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
  it("does not let an HTTP schedule candidate refresh verified scheduled health", async () => {
    const repository = createMaintenanceRunRepository(databaseUrl);
    try {
      const before = await repository.lastScheduledSuccessAt();
      const { id } = await repository.recordRun(
        draft({
          scheduledFor: "2099-01-01T00:00:00Z",
          finishedAt: "2099-01-01T00:00:01Z",
          passes: {
            executionScope: "safe-maintenance-only",
            platformTriggerVerified: false,
            triggerEvidence: "http-candidate",
          },
        }),
      );
      expect((await repository.listRecentRuns(50)).some((run) => run.id === id)).toBe(true);
      expect((await repository.listRecentScheduledRuns(50)).some((run) => run.id === id)).toBe(
        false,
      );
      expect(await repository.lastScheduledSuccessAt()).toBe(before);
    } finally {
      await repository.close();
    }
  });
  it("reads scope and correlation but rejects incomplete or invalid count evidence", async () => {
    const repository = createMaintenanceRunRepository(databaseUrl);
    try {
      const valid = { claimed: 4, completed: 3, failed: 1, unknown: 0, skipped: 0 };
      const ids: string[] = [];
      for (const counts of [valid, { claimed: 4 }, { ...valid, unknown: -1 }]) {
        const row = await repository.recordRun(
          draft({
            passes: { executionScope: "safe-maintenance-only", runId: "correlation-test", counts },
          }),
        );
        ids.push(row.id);
      }
      const runs = await repository.listRecentRuns(50);
      expect(runs.find((r) => r.id === ids[0])).toMatchObject({
        executionScope: "safe-maintenance-only",
        correlationId: "correlation-test",
        jobCounts: valid,
      });
      expect(runs.find((r) => r.id === ids[1])?.jobCounts).toBeNull();
      expect(runs.find((r) => r.id === ids[2])?.jobCounts).toBeNull();
      const catalog = await repository.schemaCatalog();
      expect(catalog.ledger.present).toBe(true);
    } finally {
      await repository.close();
    }
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

  // Asserts that the query runs against the real schema, not its value: another
  // suite may have written a text row. Do not insert rows from this file.
  it(
    "answers whether a text-layer extraction exists",
    async () => {
      const repository = createMaintenanceRunRepository(databaseUrl);
      try {
        await expect(repository.textLayerObserved()).resolves.toEqual(expect.any(Boolean));
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
