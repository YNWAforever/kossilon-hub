import "dotenv/config";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { createSqlClient, type SqlClient } from "@/server/db/client";
import { createMaintenanceRunRepository } from "./repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
const INTEGRATION_TEST_TIMEOUT_MS = 30_000;

/**
 * Every other test of this table asserts on source text or on a stub, and all of
 * them would keep passing if the SQL were wrong -- the jsonb column, the text[]
 * column and the outcome CHECK are exactly the three things a string assertion
 * cannot see. This exercises them against a real database.
 *
 * Skipped without TEST_DATABASE_URL, which is the permanent local state under
 * BLOCKED_INTEGRATION: local-postgres. It runs in CI.
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

describe.skipIf(!databaseUrl)("maintenance run repository", () => {
  afterEach(async () => {
    // Only rows this suite created. maintenance_runs is a durable operational
    // record; a blanket delete would destroy evidence another run wrote.
    await sqlForTests()`
      delete from maintenance_runs where failure_summary like ${`${TEST_MARKER}%`}
    `;
  });

  afterAll(async () => {
    await testSql?.end();
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
          expect(queue.dueNow).toBeLessThanOrEqual(queue.pending);
        }
        expect(Number.isInteger(depths.handoffsAwaitingTransmission)).toBe(true);
      } finally {
        await repository.close();
      }
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );
});
