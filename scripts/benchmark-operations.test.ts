import postgres from "postgres";
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SqlClient } from "@/server/db/client";
import {
  createAnnualReturnRepository,
  encodeCaseCursor,
} from "@/features/annual-return/repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
const enabled = process.env.RUN_T27_BENCHMARK === "1";
const date = "2026-08-01";
class BenchmarkRollback extends Error {}
function percentile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)].toFixed(1));
}

describe.skipIf(!enabled)("T27 disposable DB scale benchmark", () => {
  it("t27_scenario_1_and_3 measures 1k, 10k and 20k+ scoped reads, EXPLAIN, payload and memory", async () => {
    if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required.");
    const target = new URL(databaseUrl);
    if (!["127.0.0.1", "localhost"].includes(target.hostname) || target.port !== "55439") {
      throw new Error("Benchmark requires the local disposable PostgreSQL port 55439.");
    }
    let queryCount = 0;
    let lastWorkSql = "";
    let captureWork = false;
    let lastWorkParams: unknown[] = [];
    const sql = postgres(databaseUrl, {
      ssl: false,
      max: 1,
      debug: (_connection, query, parameters) => {
        queryCount += 1;
        if (captureWork) {
          lastWorkSql = query;
          lastWorkParams = parameters;
        }
      },
    });
    const nonce = crypto.randomUUID().replaceAll("-", "");
    const teamId = crypto.randomUUID();
    const ownerId = crypto.randomUUID();
    const report: unknown[] = [];
    try {
      await sql.begin(async (tx) => {
        await tx`insert into teams (id,name) values (${teamId},${`T27 Bench ${nonce}`})`;
        await tx`insert into users (id,name,email,role,team_id)
          values (${ownerId},'T27 Bench Owner',${`t27-${nonce}@example.invalid`},'Staff',${teamId})`;
        let seeded = 0;
        const repository = createAnnualReturnRepository({
          sql: tx as unknown as SqlClient,
          today: date,
        });
        for (const size of [1_000, 10_000, 20_001]) {
          await tx`
            insert into companies (
              company_name,cr_number,br_number,incorporation_date,annual_return_basis_date,
              registered_office,company_secretary,assigned_owner_id,assigned_team_id,data_origin
            )
            select 'T27 Bench ' || i::text, ${`T27CR-${nonce}-`} || i::text,
              ${`T27BR-${nonce}-`} || i::text,'2020-01-01','2026-07-01',
              'Disposable benchmark','Disposable benchmark',${ownerId},${teamId},'fixture'
            from generate_series(${seeded + 1}::integer,${size}::integer) i
          `;
          await tx`
            insert into annual_return_cases (
              company_id,return_year,made_up_date,filing_due_date,current_status,owner_id
            )
            select c.id,2026,'2026-07-01','2026-08-12','Upcoming',${ownerId}
            from companies c where c.assigned_team_id = ${teamId}
              and not exists (select 1 from annual_return_cases arc where arc.company_id = c.id)
          `;
          await tx`
            insert into annual_return_checklist_items (case_id,item_label,required,status,due_date)
            select arc.id,'Signed NAR1 form',true,'Missing','2026-08-05'
            from annual_return_cases arc join companies c on c.id = arc.company_id
            where c.assigned_team_id = ${teamId}
              and not exists (select 1 from annual_return_checklist_items i where i.case_id = arc.id)
          `;
          seeded = size;
          await tx`set local statement_timeout = '10s'`;
          const input = {
            scope: { teamId },
            viewerId: ownerId,
            view: "chaseToday" as const,
            limit: 50,
            asOf: date,
          };
          const beforeHeap = process.memoryUsage().heapUsed;
          queryCount = 0;
          const coldStarted = performance.now();
          captureWork = true;
          const first = await repository.listWorkViewPage(input);
          captureWork = false;
          const coldMs = performance.now() - coldStarted;
          const coldQueries = queryCount;
          expect(first.total).toBe(size);
          expect(first.rows).toHaveLength(50);
          const listMs: number[] = [];
          queryCount = 0;
          for (let n = 0; n < 7; n += 1) {
            const started = performance.now();
            const page = await repository.listWorkViewPage(input);
            expect(page.total).toBe(size);
            listMs.push(performance.now() - started);
          }
          const listQueries = queryCount;
          const metricsMs: number[] = [];
          queryCount = 0;
          for (let n = 0; n < 7; n += 1) {
            const started = performance.now();
            const metrics = await repository.operationalMetrics({ teamId }, date, ownerId);
            expect(metrics.activeCases).toBe(size);
            metricsMs.push(performance.now() - started);
          }
          const summaryQueries = queryCount;
          const [deep] = await tx<{ filing_due_date: string; company_name: string; id: string }[]>`
            select arc.filing_due_date::text filing_due_date,c.company_name,arc.id
            from annual_return_cases arc join companies c on c.id = arc.company_id
            where c.assigned_team_id = ${teamId}
            order by arc.filing_due_date,c.company_name,arc.id
            offset ${size - 11} limit 1
          `;
          const deepPage = await repository.listWorkViewPage({
            ...input,
            cursor: encodeCaseCursor(deep),
          });
          expect(deepPage.total).toBe(size);
          expect(deepPage.rows).toHaveLength(10);
          const payloadBytes = Buffer.byteLength(JSON.stringify(first));
          expect(payloadBytes).toBeLessThanOrEqual(300_000);
          const entry: Record<string, unknown> = {
            cases: size,
            coldMs: Number(coldMs.toFixed(1)),
            coldQueries,
            warmListP50Ms: percentile(listMs, 0.5),
            warmListP95Ms: percentile(listMs, 0.95),
            warmListQueries: listQueries / 7,
            summaryP50Ms: percentile(metricsMs, 0.5),
            summaryP95Ms: percentile(metricsMs, 0.95),
            summaryQueries: summaryQueries / 7,
            payloadBytes,
            pageRows: first.rows.length,
            deepRows: deepPage.rows.length,
            heapDeltaBytes: process.memoryUsage().heapUsed - beforeHeap,
          };
          if (size === 20_001 && lastWorkSql) {
            await tx`set local statement_timeout = '5s'`;
            const explain = await tx.unsafe<
              { "QUERY PLAN": { Plan: { "Node Type": string } }[] }[]
            >(`explain (format json) ${lastWorkSql}`, lastWorkParams);
            const plan = explain[0]?.["QUERY PLAN"]?.[0];
            entry.explainRootNode = plan?.Plan?.["Node Type"];
          }
          report.push(entry);
          await tx`set local statement_timeout = 0`;
        }
        throw new BenchmarkRollback();
      });
    } catch (error) {
      if (!(error instanceof BenchmarkRollback)) throw error;
    } finally {
      await sql.end();
    }
    // Synthetic fixture measurements only; never present as deployed API timing.
    if (process.env.T27_BENCHMARK_OUTPUT) {
      writeFileSync(process.env.T27_BENCHMARK_OUTPUT, JSON.stringify(report, null, 2) + "\n");
    }
    console.log(`T27_DISPOSABLE_BENCHMARK=${JSON.stringify(report)}`);
  }, 180_000);
});
