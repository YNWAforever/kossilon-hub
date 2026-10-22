import { afterAll, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSqlClient, type SqlClient } from "@/server/db/client";
import { createWorkItemRepository } from "./repository";
import { queueFiltersForActor } from "./server-fns";
import { createBulkOperationsRepository } from "@/features/bulk-operations/repository";
import type { AuthenticatedActor } from "@/features/auth/types";

// The db project is run only after the caller's resource identity gate.
const url = process.env.TEST_DATABASE_URL;
const sql = url ? createSqlClient(url, { max: 1 }) : null;
afterAll(async () => {
  await sql?.end();
});

describe.skipIf(!url)("R16 / R28 actual SQL page and snapshot agreement", () => {
  it("UC127/132/133 bounds 10000 work items, keeps exact cursor order, and matches authorized snapshot IDs", async () => {
    const fixtureRunId = crypto.randomUUID();
    const companyId = crypto.randomUUID(),
      caseId = crypto.randomUUID(),
      actorId = crypto.randomUUID();
    const teamId = "10000000-0000-0000-0000-000000000001";
    const actor: AuthenticatedActor = {
      authUserId: `synthetic-${fixtureRunId}`,
      userId: actorId,
      role: "Manager",
      teamId,
      active: true,
    };
    const rollback = new Error(`rollback owned queue fixture ${fixtureRunId}`);
    const ids: string[] = [],
      snapshotIds: string[] = [];
    const measurements: {
      query: string;
      visible: number;
      snapshot: number;
      maxPageSize: number;
      firstResponseBytes: number;
    }[] = [];
    const queryEvidence: {
      query: string;
      strings: string[];
      parameters: unknown[];
      explain: unknown;
    }[] = [];
    try {
      await expect(
        sql!.begin(async (tx) => {
          await tx`insert into users(id,name,email,role,team_id) values(${actorId},'Synthetic queue Manager',${fixtureRunId + "@example.test"},'Manager',${teamId})`;
          await tx`insert into staff_profiles(user_id,auth_user_id,role,team_id,active) values(${actorId},${actor.authUserId},'Manager',${teamId},true)`;
          await tx`insert into companies(id,company_name,cr_number,br_number,incorporation_date,annual_return_basis_date,registered_office,company_secretary,status,assigned_owner_id,assigned_team_id,data_origin)
          values(${companyId},${fixtureRunId + " 香港測試公司"},${companyId},${companyId},'2020-01-01','2026-01-01','Synthetic','Synthetic','active',${actorId},${teamId},'client')`;
          await tx`insert into annual_return_cases(id,company_id,return_year,made_up_date,filing_due_date,current_status,risk_level,owner_id) values(${caseId},${companyId},2026,'2026-01-01','2026-02-12','Upcoming','green',${actorId})`;
          const rows = await tx<
            { id: string }[]
          >`insert into work_items(company_id,case_type,annual_return_case_id,source_event_key,source_event_type,work_type,title,priority,owner_id,team_id,sla_policy_version_id,sla_started_at,sla_warning_at,sla_due_at)
          select ${companyId},'annual_return',${caseId},${fixtureRunId}||':'||n,'synthetic_queue','annual_return_case','Review document: NAR1',n%101,${actorId},${teamId},(select id from sla_policies order by id limit 1),'2026-10-01'::timestamptz,'2026-10-02'::timestamptz,'2026-10-03'::timestamptz+((n%3)::text||' microseconds')::interval from generate_series(1,10000)n returning id`;
          ids.push(...rows.map((r) => r.id));
          let firstQuery: { strings: string[]; parameters: unknown[] } | undefined;
          const reader = new Proxy(tx, {
            apply(target, thisArg, args) {
              const [strings, ...parameters] = args as [TemplateStringsArray, ...unknown[]];
              if (!firstQuery && strings[0]?.includes("cursor_due_at"))
                firstQuery = { strings: [...strings], parameters };
              return Reflect.apply(target, thisArg, args);
            },
          });
          const repo = createWorkItemRepository({ sql: reader });
          const bulk = createBulkOperationsRepository({ sql: tx as unknown as SqlClient });
          for (const q of ["覆核文件", "Review document", "香港測試公司"]) {
            firstQuery = undefined;
            const seen = new Set<string>();
            let cursor: string | undefined;
            let firstBytes = 0;
            do {
              const filters = queueFiltersForActor(actor, {
                view: "team",
                q,
                limit: 50,
                cursor,
                caseIds: [caseId],
              });
              const page = await repo.listQueuePage(filters, {
                caseIds: [caseId],
                includeFixtures: false,
              });
              expect(page.items.length).toBeLessThanOrEqual(50);
              if (!cursor) {
                firstBytes = new TextEncoder().encode(JSON.stringify(page)).byteLength;
                expect(firstQuery).toBeDefined();
                const captured = firstQuery!;
                const parts = [...captured.strings];
                parts[0] = "explain (analyze,buffers,format json) " + parts[0];
                const template = Object.assign(parts, { raw: [...parts] });
                const explain = await Reflect.apply(tx, undefined, [
                  template,
                  ...captured.parameters,
                ]);
                queryEvidence.push({ query: q, ...captured, explain });
              }
              for (const item of page.items) {
                expect(seen.has(item.id)).toBe(false);
                seen.add(item.id);
              }
              cursor = page.nextCursor ?? undefined;
            } while (cursor);
            expect([...seen].sort()).toEqual([...ids].sort());
            const snapshot = await bulk.createSnapshot(actor, {
              resource: "work_item",
              filters: { q, activeOnly: true, view: "team" },
            });
            snapshotIds.push(snapshot.snapshotId);
            expect(snapshot.count).toBe(10000);
            const [stored] = await tx<
              { items: { id: string }[] }[]
            >`select items from bulk_selection_snapshots where id=${snapshot.snapshotId}`;
            expect(stored.items.map((i) => i.id).sort()).toEqual([...seen].sort());
            measurements.push({
              query: q,
              visible: seen.size,
              snapshot: snapshot.count,
              maxPageSize: 50,
              firstResponseBytes: firstBytes,
            });
          }
          const first = await repo.listQueuePage({ teamId, caseIds: [caseId], limit: 50 });
          expect(first.nextCursor).toBeTruthy();
          await expect(
            repo.listQueuePage({
              teamId,
              caseIds: [caseId],
              q: "changed",
              cursor: first.nextCursor!,
              limit: 50,
            }),
          ).rejects.toThrow(/cursor/i);
          const anchor = JSON.parse(first.nextCursor!);
          await tx`update work_items set priority=(priority+1)%101,version=version+1 where id=${anchor.id}`;
          await expect(
            repo.listQueuePage({ teamId, caseIds: [caseId], cursor: first.nextCursor!, limit: 50 }),
          ).rejects.toThrow(/changed/i);
          expect(
            (
              await repo.listQueuePage({
                teamId: "10000000-0000-0000-0000-000000000002",
                caseIds: [caseId],
              })
            ).items,
          ).toEqual([]);
          expect((await repo.listQueuePage({ teamId, caseIds: [caseId], q: "%" })).items).toEqual(
            [],
          );
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    } finally {
      const [remaining] = await sql!<
        { count: string }[]
      >`select count(*) count from work_items where id=any(${ids}::uuid[])`;
      expect(Number(remaining.count)).toBe(0);
      const [companyRemaining] = await sql!<
        { count: string }[]
      >`select count(*) count from companies where id=${companyId}`;
      expect(Number(companyRemaining.count)).toBe(0);
      if (process.env.COSEC_EVIDENCE_DIR)
        writeFileSync(
          join(process.env.COSEC_EVIDENCE_DIR, `R16-owned-fixture-${fixtureRunId}.json`),
          JSON.stringify(
            {
              fixtureRunId,
              companyId,
              caseId,
              actorId,
              workItemIds: ids,
              snapshotIds,
              measurements,
              queryEvidence,
              transactionRolledBack: true,
              workItemsRemaining: Number(remaining.count),
              companiesRemaining: Number(companyRemaining.count),
            },
            null,
            2,
          ),
        );
    }
  }, 120000);
});
