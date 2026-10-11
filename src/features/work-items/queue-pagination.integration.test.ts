import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSqlClient } from "@/server/db/client";
import { createWorkItemRepository } from "./repository";

describe.skipIf(!process.env.TEST_DATABASE_URL)("R16 bounded queue on real PostgreSQL", () => {
  it("pages 50k equal-deadline items, searches beyond the first page and refuses another scope's cursor", async () => {
    const sql = createSqlClient(process.env.TEST_DATABASE_URL!);
    try {
      await expect(
        sql.begin(async (tx) => {
          const token = randomUUID(),
            team = randomUUID(),
            other = randomUUID();
          await tx`insert into teams(id,name) values (${team},'R16 owned'),(${other},'R16 foreign')`;
          const [f] =
            await tx`select a.id case_id,a.company_id,p.id policy_id,a.owner_id from annual_return_cases a cross join sla_policies p where p.active limit 1`;
          await tx`update companies set assigned_team_id=${team},data_origin='client' where id=${f.company_id}`;
          await tx`insert into work_items(company_id,case_type,annual_return_case_id,source_event_key,source_event_type,work_type,title,owner_id,team_id,sla_policy_version_id,sla_started_at,sla_warning_at,sla_due_at)
          select ${f.company_id},'annual_return',${f.case_id},${token}||':'||n,'test','annual_return_case',case when n=50000 then '尾頁中文 100%_literal' else 'R16 work '||n end,${f.owner_id},${team},${f.policy_id},'2026-10-01T00:00Z','2026-10-01T01:00Z','2026-10-01T02:00Z' from generate_series(1,50000) n`;
          await tx`insert into work_items(company_id,case_type,annual_return_case_id,source_event_key,source_event_type,work_type,title,team_id,sla_policy_version_id,sla_started_at,sla_warning_at,sla_due_at) values (${f.company_id},'annual_return',${f.case_id},${token}||':private','test','annual_return_case','PRIVATE FOREIGN',${other},${f.policy_id},'2026-10-01T00:00Z','2026-10-01T01:00Z','2026-10-01T02:00Z')`;
          const repository = createWorkItemRepository({ sql: tx });
          const first = await repository.listQueuePage({ teamId: team });
          expect(first.items).toHaveLength(50);
          expect(first.total).toBe(50000);
          expect(first.nextCursor).toBeTruthy();
          const second = await repository.listQueuePage({
            teamId: team,
            cursor: first.nextCursor!,
          });
          expect(second.items).toHaveLength(50);
          expect(new Set([...first.items, ...second.items].map((x) => x.id)).size).toBe(100);
          expect(second.total).toBe(50000);
          expect(
            (await repository.listQueuePage({ teamId: team, q: "中文 100%_" })).items.map(
              (x) => x.title,
            ),
          ).toEqual(["尾頁中文 100%_literal"]);
          expect((await repository.listQueuePage({ teamId: other })).total).toBe(0);
          await expect(
            repository.listQueuePage({ teamId: other, cursor: first.nextCursor! }),
          ).rejects.toThrow(/cursor/i);
          await expect(
            repository.listQueuePage({ teamId: team, q: "changed", cursor: first.nextCursor! }),
          ).rejects.toThrow(/cursor/i);
          await expect(
            repository.listQueuePage({ teamId: team, cursor: "malformed" }),
          ).rejects.toThrow(/cursor/i);
          await expect(repository.listQueuePage({ teamId: team, limit: 51 })).rejects.toThrow(/50/);
          await tx`alter table work_items alter column sla_due_at drop not null, alter column sla_started_at drop not null, alter column sla_warning_at drop not null`;
          await tx`insert into work_items(company_id,case_type,annual_return_case_id,source_event_key,source_event_type,work_type,title,team_id,sla_policy_version_id) values (${f.company_id},'annual_return',${f.case_id},${token}||':null-sla','test','annual_return_case','R16 NULL SLA',${team},${f.policy_id})`;
          const historical = await repository.listQueuePage({ teamId: team, q: "NULL SLA" });
          expect(historical.items[0].slaDueAt).toBeNull();
          expect(historical.items[0].slaStartedAt).toBeNull();
          expect(historical.total).toBe(1);
          throw Error("rollback R16 50k fixture");
        }),
      ).rejects.toThrow("rollback R16 50k fixture");
    } finally {
      await sql.end();
    }
  }, 60000);
});
