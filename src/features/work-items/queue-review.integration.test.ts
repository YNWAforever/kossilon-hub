import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSqlClient, type SqlClient } from "@/server/db/client";
import { createWorkItemRepository } from "./repository";
import { queueFiltersForActor } from "./server-fns";
import { createBulkOperationsRepository } from "@/features/bulk-operations/repository";

describe.skipIf(!process.env.TEST_DATABASE_URL)("Queue review regressions", () => {
  it("shares the effective mine owner across list, count and snapshot; scoped facets include later rows", async () => {
    const sql = createSqlClient(process.env.TEST_DATABASE_URL!);
    try {
      await expect(
        sql.begin(async (tx) => {
          const team = randomUUID(),
            foreignTeam = randomUUID(),
            a = randomUUID(),
            b = randomUUID(),
            foreign = randomUUID(),
            tag = randomUUID();
          await tx`insert into teams(id,name) values (${team},'Review scope'),(${foreignTeam},'Foreign review scope')`;
          await tx`insert into users(id,name,email,role,team_id) values (${a},'Owner A',${a + "@example.test"},'Manager',${team}),(${b},'Owner B',${b + "@example.test"},'Staff',${team}),(${foreign},'Private foreign owner',${foreign + "@example.test"},'Manager',${foreignTeam})`;
          await tx`insert into staff_profiles(user_id,auth_user_id,role,team_id) values (${a},${tag},'Manager',${team})`;
          const [f] =
            await tx`select arc.id case_id,arc.company_id,p.id policy_id from annual_return_cases arc cross join sla_policies p where p.active limit 1`;
          await tx`update companies set assigned_team_id=${team},data_origin='client' where id=${f.company_id}`;
          await tx`insert into work_items(company_id,case_type,annual_return_case_id,source_event_key,source_event_type,work_type,title,owner_id,team_id,sla_policy_version_id,sla_started_at,sla_warning_at,sla_due_at)
          select ${f.company_id},'annual_return',${f.case_id},${tag}||':'||n,'test',case when n=51 then 'later_type' when n=52 then 'foreign_type' else 'first_type' end,'Review row '||n,case when n=51 then ${b}::uuid when n=52 then ${foreign}::uuid else ${a}::uuid end,case when n=52 then ${foreignTeam}::uuid else ${team}::uuid end,${f.policy_id},'2026-10-01T00:00Z','2026-10-01T01:00Z',case when n>=51 then '2026-10-02T02:00Z'::timestamptz else '2026-10-01T02:00Z'::timestamptz end from generate_series(1,52)n`;
          const actor = {
            userId: a,
            authUserId: tag,
            role: "Manager" as const,
            teamId: team,
            active: true,
          };
          const requested = { view: "mine" as const, ownerId: b };
          const repo = createWorkItemRepository({ sql: tx });
          const page = await repo.listQueuePage(queueFiltersForActor(actor, requested));
          expect(page.total).toBe(50);
          const bulk = createBulkOperationsRepository({ sql: tx as unknown as SqlClient });
          expect(
            (
              await bulk.createSnapshot(actor, {
                resource: "work_item",
                filters: { ...requested, activeOnly: true },
              })
            ).count,
          ).toBe(page.total);
          const scope = queueFiltersForActor(actor, { view: "team" });
          const owners = await repo.listQueueFilterOptions(scope, { kind: "owner" });
          expect(owners.items.map((x) => x.id).sort()).toEqual([a, b].sort());
          expect(
            (await repo.listQueueFilterOptions(scope, { kind: "workType" })).items
              .map((x) => x.id)
              .sort(),
          ).toEqual(["first_type", "later_type"]);
          expect(
            (await repo.listQueueFilterOptions(scope, { kind: "owner", q: "Owner B" })).items.map(
              (x) => x.id,
            ),
          ).toEqual([b]);
          await expect(
            repo.listQueueFilterOptions(scope, { kind: "owner", limit: 51 }),
          ).rejects.toThrow();
          await tx`insert into work_items(company_id,case_type,annual_return_case_id,source_event_key,source_event_type,work_type,title,owner_id,team_id,sla_policy_version_id,sla_started_at,sla_warning_at,sla_due_at)
          select ${f.company_id},'annual_return',${f.case_id},${tag}||':utf8:'||n,'test','工作型'||lpad(n::text,3,'0'),'Facet Unicode',${a},${team},${f.policy_id},'2026-10-01T00:00Z','2026-10-01T01:00Z','2026-10-01T02:00Z' from generate_series(1,60)n`;
          const types = await repo.listQueueFilterOptions(scope, { kind: "workType" });
          expect(types.items).toHaveLength(50);
          const tail = await repo.listQueueFilterOptions(scope, {
            kind: "workType",
            cursor: types.nextCursor!,
          });
          expect(tail.items).toHaveLength(12);
          expect(new Set([...types.items, ...tail.items].map((x) => x.id)).size).toBe(62);
          await expect(
            repo.listQueueFilterOptions(
              { ...scope, teamId: foreignTeam },
              { kind: "workType", cursor: types.nextCursor! },
            ),
          ).rejects.toThrow(/cursor/i);
          throw Error("rollback queue review fixture");
        }),
      ).rejects.toThrow("rollback queue review fixture");
    } finally {
      await sql.end();
    }
  });
});
