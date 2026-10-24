// Disposable, gated real SQL; no native Auth, HTTP, RLS or platform ticks.
import assert from "node:assert/strict";
import { appendFileSync, closeSync, openSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getCurrentTest } from "@vitest/runner";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { SqlClient } from "./db/client";

const RUN = "cosec-20261024-schema-d69e7b0e";
const ROOT = "C:\\Users\\laich\\Documents\\kossilon-hub\\cosec-20261023";
const DATABASE = "cosec_schema_d69e7b0e";
type Target = {
  uri: string;
  containerId: string;
  identity: { systemId: string };
  counts: Record<string, number>;
  configuration: Record<string, string>;
};
type Gate = {
  verifyEmptyTarget(): Promise<Target>;
  verifyOwnedTarget(): Promise<Target>;
  publicTarget(target: Target): object;
};
const cases = [
  "missing",
  "unknown",
  "same-count-diverged",
  "no-ledger",
  "missing-marker",
  "missing-index",
  "recovery-replay",
] as const;
type Case = (typeof cases)[number];
const marker = "0034_notification_outbox_dispatch_marker.sql";
const unknown = "9999_uc189_unknown_d69e7b0e.sql";
const slot = "2026-10-24T07:00:00.000Z";
let cleanupFailed = false;

async function snapshot(sql: SqlClient) {
  // Full rows/xmins, not counts alone. No business fixtures are seeded here.
  const ledger =
    await sql`select id,to_jsonb(s) data,xmin::text version from schema_migrations s order by id`;
  const jobs =
    await sql`select id,to_jsonb(j) data,xmin::text version from maintenance_job_runs j order by id`;
  const runs =
    await sql`select id,to_jsonb(r) data,xmin::text version from maintenance_runs r order by id`;
  const outbox =
    await sql`select id,to_jsonb(n) data,xmin::text version from notification_outbox n order by id`;
  return { ledger: [...ledger], jobs: [...jobs], runs: [...runs], outbox: [...outbox] };
}

describe.skipIf(process.env.COSEC_UC189_RUN_ID !== RUN)("UC189 gated SQL schema refusal", () => {
  it.each(cases)(
    "%s: actual catalog, refusal/retry and independent rollback readback",
    async (name) => {
      assert(!cleanupFailed, "Earlier cleanup failed; no later writes allowed");
      assert.equal(realpathSync(process.cwd()), ROOT);
      const attempt = process.env.COSEC_UC189_ATTEMPT!;
      assert.match(attempt, /^[a-z0-9-]+$/);
      const folder = resolve(ROOT, "docs/audit-remediation", RUN, "db");
      assert.equal(process.env.COSEC_UC189_EVENTS_DIR, folder);
      const signal = getCurrentTest()?.context.signal;
      assert(signal);
      const task = scenario(name, attempt, folder, signal);
      onTestFinished(async () => {
        await task.catch(() => undefined);
      });
      await task;
    },
    60_000,
  );
});

async function scenario(name: Case, attempt: string, folder: string, signal: AbortSignal) {
  const fd = openSync(resolve(folder, `UC189-${name}-${attempt}.jsonl`), "wx");
  const record = (phase: string, details: object = {}) =>
    appendFileSync(fd, JSON.stringify({ run: RUN, name, attempt, phase, ...details }) + "\n");
  let writerRaw: SqlClient | undefined, observerRaw: SqlClient | undefined;
  let gate: Gate | undefined, target: Target | undefined;
  let before: Awaited<ReturnType<typeof snapshot>> | undefined;
  const external = vi.fn(() => {
    throw new Error("UC189 external transport forbidden");
  });
  const rollback = new Error("UC189 deliberate transaction rollback");
  const failures: unknown[] = [];
  try {
    signal.throwIfAborted();
    gate = (await import(
      /* @vite-ignore */ pathToFileURL(
        resolve(ROOT, "docs/audit-remediation", RUN, "isolated-db-runner.mjs"),
      ).href
    )) as Gate;
    target = await gate.verifyEmptyTarget();
    assert.equal(target.containerId, process.env.COSEC_UC189_TARGET_ID);
    assert.equal(target.identity.systemId, process.env.COSEC_UC189_SYSTEM_ID);
    assert.equal(process.env.TEST_DATABASE_URL, target.uri);
    record("before-application-import-or-client", gate.publicTarget(target));
    vi.stubGlobal("fetch", external);
    const [
      { createSqlClient },
      { guardSqlTestLifetime },
      { createMaintenanceRunRepository },
      { createMaintenanceJobRepository },
      { runRuntimeMaintenanceTick },
      { buildOperationsHealth },
      { EXPECTED_MIGRATIONS },
    ] = await Promise.all([
      import("./db/client"),
      import("@/test/sql-test-lifetime"),
      import("@/features/operations/repository"),
      import("@/features/operations/maintenance-job-repository"),
      import("./maintenance-trigger-runtime"),
      import("@/features/operations/server-fns"),
      import("@/features/operations/schema-health"),
    ]);
    writerRaw = createSqlClient(target.uri, { max: 1, ssl: false });
    observerRaw = createSqlClient(target.uri, { max: 1, ssl: false });
    const writer = guardSqlTestLifetime(writerRaw, () => signal),
      observer = guardSqlTestLifetime(observerRaw, () => signal);
    const identities = await Promise.all(
      [writer, observer].map(async (sql) => {
        const [row] =
          await sql`select current_database() database,current_user username,pg_backend_pid() pid,(select system_identifier::text from pg_control_system()) system_id`;
        assert.equal(row.database, DATABASE);
        assert.equal(row.username, "cosec_runner");
        assert.equal(row.system_id, target!.identity.systemId);
        return row;
      }),
    );
    assert.notEqual(identities[0].pid, identities[1].pid);
    record("independent-sessions", { identities });
    before = await snapshot(observer);
    expect(before.ledger.map((row) => row.id)).toEqual([...EXPECTED_MIGRATIONS]);
    const completed = await writer
      .begin(async (tx) => {
        // The entire fault (including DDL) is transaction-scoped and rolled back.
        if (name === "missing" || name === "same-count-diverged")
          await tx`delete from schema_migrations where id=${marker}`;
        if (name === "unknown" || name === "same-count-diverged")
          await tx`insert into schema_migrations(id) values(${unknown})`;
        if (name === "no-ledger")
          await tx`alter table schema_migrations rename to uc189_ledger_d69e7b0e`;
        if (name === "missing-marker")
          await tx`alter table notification_outbox drop column dispatch_started_attempt`;
        if (name === "missing-index") await tx`drop index notification_outbox_dispatch_marker_idx`;
        record("fault-installed-uncommitted", {
          removed_id: ["missing", "same-count-diverged"].includes(name) ? marker : null,
          inserted_id: ["unknown", "same-count-diverged"].includes(name) ? unknown : null,
        });
        const repository = createMaintenanceRunRepository(undefined, { sql: tx });
        let jobFactories = 0,
          effects = 0;
        const dependencies = {
          createRunRepository: () => repository,
          createJobRepository: () => {
            jobFactories++;
            return createMaintenanceJobRepository({ sql: tx });
          },
          runJob: async () => {
            effects++;
            return { stalled: 0 };
          },
        };
        const input = (id: string) => ({
          trigger: "scheduled" as const,
          triggerEvidence: "manual" as const,
          scheduledAt: slot,
          runId: RUN + "-" + id,
          allowedJobs: ["escalateStalledQuarantine" as const],
        });
        if (name !== "recovery-replay") {
          const catalog = await repository.schemaCatalog();
          const view = await buildOperationsHealth(
            { now: slot },
            { repository, diagnostics: true },
          );
          if (name === "missing") expect(view.schema.missing).toEqual([marker]);
          if (name === "unknown") expect(view.schema.ahead).toEqual([unknown]);
          if (name === "same-count-diverged") {
            expect(view.schema.state).toBe("diverged");
            expect(view.schema.appliedCount).toBe(EXPECTED_MIGRATIONS.length);
            expect(view.schema.missing).toEqual([marker]);
            expect(view.schema.ahead).toEqual([unknown]);
          }
          if (name === "no-ledger") expect(view.schema.appliedCount).toBeNull();
          const countsBefore =
            await tx`select (select count(*)::int from maintenance_job_runs) jobs,(select count(*)::int from maintenance_runs) runs,(select count(*)::int from notification_outbox) outbox`;
          for (const id of ["first", "retry"])
            await expect(runRuntimeMaintenanceTick(input(id), dependencies)).rejects.toThrow(
              /schema/i,
            );
          expect(await repository.schemaCatalog()).toEqual(catalog);
          const countsAfter =
            await tx`select (select count(*)::int from maintenance_job_runs) jobs,(select count(*)::int from maintenance_runs) runs,(select count(*)::int from notification_outbox) outbox`;
          expect([...countsAfter]).toEqual([...countsBefore]);
          expect(jobFactories).toBe(0);
          expect(effects).toBe(0);
          record("refusal-retry-readback", {
            schema: view.schema,
            catalog,
            counts: [...countsAfter],
            jobFactories,
            effects,
          });
        } else {
          await tx`delete from schema_migrations where id=${marker}`;
          await expect(
            runRuntimeMaintenanceTick(input("before-repair"), dependencies),
          ).rejects.toThrow(/schema/i);
          // Restore only the exact synthetic fault inside the same transaction.
          await tx`insert into schema_migrations(id,applied_at) values(${marker},${before!.ledger.find((row) => row.id === marker)!.data.applied_at})`;
          const first = await runRuntimeMaintenanceTick(input("recovered"), dependencies);
          const replay = await runRuntimeMaintenanceTick(input("replay"), dependencies);
          expect(first.counts.completed).toBe(1);
          expect(replay.outcome).toBe("skipped");
          expect(effects).toBe(1);
          const jobs = await tx`select id,state,run_id from maintenance_job_runs order by id`;
          const runs = await tx`select id,outcome,passes from maintenance_runs order by id`;
          expect(jobs).toHaveLength(1);
          expect(jobs[0].state).toBe("succeeded");
          expect(runs).toHaveLength(2);
          expect(runs.map((row) => row.outcome)).toEqual(
            expect.arrayContaining(["succeeded", "failed"]),
          );
          expect(runs.every((row) => row.passes.platformTriggerVerified === false)).toBe(true);
          record("recovery-replay-readback", {
            first,
            replay,
            jobs: [...jobs],
            runs: [...runs],
            effects,
            scope: "injected no-effect job; real durable job and heartbeat SQL; manual evidence",
          });
        }
        throw rollback;
      })
      .catch((error: unknown) => error);
    assert.equal(completed, rollback, "Unexpected SQL/test failure, not deliberate rollback");
    expect(await snapshot(observer)).toEqual(before);
    record("independent-full-row-xmin-rollback-readback", {
      unchanged: true,
      ledger_rows: before.ledger.length,
      business_rows: 0,
    });
    expect(external).not.toHaveBeenCalled();
    record("scenario-passed", {
      externalHttpCalls: external.mock.calls.length,
      nativeAuth: false,
      nativeHttp: false,
      nativeTicks: false,
    });
  } catch (error) {
    record("scenario-failed", {
      name: error instanceof Error ? error.name : "unknown",
      message: error instanceof Error ? error.message : "unknown",
    });
    failures.push(error);
  } finally {
    try {
      if (gate && target) {
        const current = await gate.verifyEmptyTarget();
        assert.equal(current.containerId, target.containerId);
        assert.equal(current.identity.systemId, target.identity.systemId);
        assert.deepEqual(current.counts, target.counts);
        assert.deepEqual(current.configuration, target.configuration);
        if (observerRaw && before) assert.deepEqual(await snapshot(observerRaw), before);
        record("all-public-counts-and-original-rows-restored", { counts: current.counts });
      }
    } catch (error) {
      cleanupFailed = true;
      record("cleanup-failed-preserved", {});
      failures.push(error);
    } finally {
      const closed = await Promise.allSettled([writerRaw?.end(), observerRaw?.end()]);
      for (const result of closed) {
        if (result.status === "rejected") failures.push(result.reason);
      }
      vi.unstubAllGlobals();
      closeSync(fd);
    }
  }
  if (failures.length)
    throw new AggregateError(failures, `UC189 ${name} failed; inspect preserved journal`);
}
