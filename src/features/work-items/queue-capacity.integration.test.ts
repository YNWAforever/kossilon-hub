import "dotenv/config";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { createSqlClient } from "@/server/db/client";
import { createWorkItemRepository } from "./repository";

describe.skipIf(!process.env.TEST_DATABASE_URL)("R16 disposable SQL capacity", () => {
  it("10k/50k: 200 warm reads, 20 fresh connections and 25 concurrent scoped bounded reads", async () => {
    const url = process.env.TEST_DATABASE_URL!,
      sql = createSqlClient(url),
      team = randomUUID(),
      company = randomUUID(),
      caseId = randomUUID(),
      tag = randomUUID();
    if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname))
      throw Error("Capacity fixture requires an owned localhost disposable database.");
    const receipts: unknown[] = [];
    try {
      await sql.begin(async (tx) => {
        const [owner] = await tx`select id from users where active limit 1`;
        await tx`insert into teams(id,name) values (${team},'Owned R16 capacity')`;
        await tx`insert into companies(id,company_name,cr_number,br_number,incorporation_date,annual_return_basis_date,registered_office,company_secretary,assigned_owner_id,assigned_team_id,data_origin) values (${company},'Owned capacity company',${tag},${tag},'2020-01-01','2026-01-01','Test','Test',${owner.id},${team},'client')`;
        await tx`insert into annual_return_cases(id,company_id,return_year,made_up_date,filing_due_date,current_status,owner_id) values (${caseId},${company},2026,'2026-01-01','2026-02-12','Upcoming',${owner.id})`;
      });
      let previous = 0;
      for (const size of [10000, 50000]) {
        await sql`insert into work_items(company_id,case_type,annual_return_case_id,source_event_key,source_event_type,work_type,title,owner_id,team_id,sla_policy_version_id,sla_started_at,sla_warning_at,sla_due_at)
     select ${company},'annual_return',${caseId},${tag}||':'||n,'capacity_fixture','annual_return_case','Owned capacity '||n,a.owner_id,${team},p.id,'2026-10-01T00:00Z','2026-10-01T01:00Z','2026-10-01T02:00Z' from generate_series(${previous + 1}::int,${size}::int) n cross join annual_return_cases a cross join lateral(select id from sla_policies where active limit 1)p where a.id=${caseId}`;
        previous = size;
        await sql`analyze work_items`;
        const clients = Array.from({ length: 25 }, () => createSqlClient(url, { max: 1 }));
        try {
          const pids = await Promise.all(
            clients.map(async (c) => (await c`select pg_backend_pid() pid`)[0].pid),
          );
          expect(new Set(pids).size).toBe(25);
          const repositories = clients.map((c) => createWorkItemRepository({ sql: c })),
            warm: number[] = [],
            cold: number[] = [],
            bytes: number[] = [];
          async function measure(
            repo: ReturnType<typeof createWorkItemRepository>,
            bucket: number[],
          ) {
            const start = performance.now(),
              page = await repo.listQueuePage({ teamId: team, limit: 50 });
            bucket.push(performance.now() - start);
            expect(page.total).toBe(size);
            expect(page.items).toHaveLength(50);
            expect(page.items.every((r) => r.companyId === company)).toBe(true);
            bytes.push(Buffer.byteLength(JSON.stringify(page)));
          }
          for (let wave = 0; wave < 8; wave++)
            await Promise.all(repositories.map((r) => measure(r, warm)));
          for (let run = 0; run < 20; run++) {
            const fresh = createSqlClient(url, { max: 1 });
            try {
              await measure(createWorkItemRepository({ sql: fresh }), cold);
            } finally {
              await fresh.end();
            }
          }
          const captured: { query: string; parameters: unknown[] }[] = [];
          const observed = postgres(url, {
            ssl: false,
            max: 1,
            debug: (_id, query, parameters) => {
              if (query.includes("from work_items") || query.includes("with scoped"))
                captured.push({ query, parameters });
            },
          });
          const plans: unknown[] = [];
          try {
            await createWorkItemRepository({ sql: observed }).listQueuePage({
              teamId: team,
              limit: 50,
            });
            for (const trace of captured.slice(0, 2)) {
              const plan = await sql.unsafe(
                "explain (analyze,buffers,format json) " + trace.query,
                trace.parameters as never[],
              );
              plans.push(plan[0]["QUERY PLAN"]);
            }
          } finally {
            await observed.end();
          }
          const stats = (values: number[]) => {
            const sorted = [...values].sort((a, b) => a - b);
            return {
              samples: sorted.length,
              p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
              p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
            };
          };
          receipts.push({
            size,
            concurrency: 25,
            distinctBackends: 25,
            errors: 0,
            pageRows: 50,
            maxResponseBytes: Math.max(...bytes),
            warm: stats(warm),
            freshConnection: stats(cold),
            plans,
          });
        } finally {
          await Promise.all(clients.map((c) => c.end()));
        }
      }
      console.info("R16_SQL_CAPACITY", JSON.stringify(receipts));
      if (process.env.AUDIT_CAPACITY_OUTPUT)
        writeFileSync(
          process.env.AUDIT_CAPACITY_OUTPUT,
          JSON.stringify(
            {
              environment:
                "owned synthetic local Postgres; repository reads, not HTTP/Auth or app cold start",
              receipts,
            },
            null,
            2,
          ),
        );
      expect(
        (await sql`select count(*)::int n from notification_outbox where company_id=${company}`)[0]
          .n,
      ).toBe(0);
    } finally {
      await sql.begin(async (tx) => {
        await tx`delete from work_items where company_id=${company}`;
        await tx`delete from annual_return_cases where id=${caseId} and company_id=${company}`;
        await tx`delete from companies where id=${company}`;
        await tx`delete from teams where id=${team}`;
      });
      await sql.end();
    }
  }, 180000);
});
