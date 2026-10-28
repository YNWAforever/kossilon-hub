import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import { createSqlClient } from "@/server/db/client";
import { createCorporateChangeRequestRepository } from "@/features/corporate-changes/repository";
import {
  getCorporateChangeRequestForActor,
  listCorporateChangeRequestPageForActor,
} from "@/features/corporate-changes/read";
import { CORPORATE_CHANGE_STATUSES } from "@/features/corporate-changes/types";
import { createIncorporationRepository } from "./repository";
import {
  getIncorporationCaseForActor,
  listIncorporationCasePageForActor,
  listIncorporationCasesForActor,
} from "./read";
import { INCORPORATION_STATUSES } from "./types";
import type { CaseListQuery } from "./case-list-query";

// The executing runner must verify its disposable DB target externally before
// this suite. Connection/TLS settings belong to that runner, not this reusable
// regression. No client is instantiated at module import.
const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("R14/R20 real SQL role boundaries and 300-row list pages", () => {
  it("checks assumed actors, both domains, exact cursors/filters and transaction rollback", async () => {
    const sql = createSqlClient(databaseUrl!, { max: 1 });
    const runId = randomUUID();
    const prefix = `R14-R20-${runId}`;
    const teamA = randomUUID(),
      teamB = randomUUID();
    const profiles: {
      id: string;
      role: "Staff" | "Manager" | "Admin";
      teamId: string | null;
      active: boolean;
    }[] = [
      { id: randomUUID(), role: "Staff", teamId: teamA, active: true },
      { id: randomUUID(), role: "Staff", teamId: teamB, active: true },
      { id: randomUUID(), role: "Manager", teamId: teamA, active: true },
      { id: randomUUID(), role: "Manager", teamId: teamB, active: true },
      { id: randomUUID(), role: "Admin", teamId: null, active: true },
      { id: randomUUID(), role: "Staff", teamId: null, active: true },
      { id: randomUUID(), role: "Manager", teamId: null, active: true },
      { id: randomUUID(), role: "Staff", teamId: teamA, active: false },
      { id: randomUUID(), role: "Admin", teamId: null, active: false },
    ];
    const actors: AuthenticatedActor[] = profiles.map((p) => ({
      authUserId: `${prefix}-${p.id}`,
      userId: p.id,
      role: p.role,
      teamId: p.teamId,
      active: p.active,
    }));
    actors.push({
      authUserId: `${prefix}-client`,
      userId: null,
      role: "Client",
      teamId: null,
      active: true,
    });
    const rows = Array.from({ length: 300 }, (_, i) => ({
      n: i,
      inc_id: randomUUID(),
      change_id: randomUUID(),
      company_id: randomUUID(),
      work_id: randomUUID(),
      team_id: i % 3 === 0 ? teamB : teamA,
      // Ownership intentionally crosses teams: an owner filter cannot widen scope.
      owner_id: profiles[i % 2].id,
      name_en: `${prefix} Harbour Venture ${i % 7} ${"Long English Name ".repeat(5)}`,
      name_zh: `${prefix} ${i % 4 === 0 ? "香港新創" : "其他企業"} ${"長中文公司名稱".repeat(12)}`,
      company_name: `${prefix} ${i % 4 === 0 ? "香港新創" : "Harbour Venture"} ${i % 7} ${"中英文長公司名稱".repeat(8)}`,
      inc_status: INCORPORATION_STATUSES[i % INCORPORATION_STATUSES.length],
      change_status: CORPORATE_CHANGE_STATUSES[i % CORPORATE_CHANGE_STATUSES.length],
      due_date: `2026-11-${String((i % 10) + 1).padStart(2, "0")}`,
      // Distinct nonzero microseconds within the SAME millisecond, many ties.
      created_at: `2026-10-23T00:00:00.00000${(i % 3) + 1}Z`,
    }));
    const incIds = rows.map((r) => r.inc_id),
      changeIds = rows.map((r) => r.change_id),
      companyIds = rows.map((r) => r.company_id);
    const activeWork = rows.filter(
      (r) => r.n % 7 !== 0 && !["Completed", "Cancelled"].includes(r.change_status),
    );
    const workIds = activeWork.map((r) => r.work_id);
    const incChecklistIds: string[] = [],
      changeChecklistIds: string[] = [];
    const rollback = new Error(`owned R14/R20 fixture rollback ${runId}`);
    const measurements: {
      domain: string;
      role: string;
      teamId: string | null;
      sort: string;
      filters: CaseListQuery;
      count: number;
      ids: string[];
    }[] = [];
    let assertionsPassed = false;
    let identity: unknown;
    let remaining: Record<string, number> | undefined;
    try {
      try {
        await sql.begin(async (tx) => {
          [identity] =
            await tx`select current_database() database, current_user db_role, inet_server_addr()::text server_address, inet_server_port() server_port`;
          await tx`insert into teams(id,name) values(${teamA},${prefix + "-A"}),(${teamB},${prefix + "-B"})`;
          for (const p of profiles)
            await tx`insert into users(id,name,email,role,team_id,active)
            values(${p.id},${prefix + "-" + p.role},${p.id + "@example.test"},${p.role},${p.teamId},${p.active})`;
          // JSON carries raw timestamp text; SQL casts it on the server, avoiding
          // a driver timestamptz parameter serializer during fixture insertion.
          const jsonRows = tx.json(rows);
          await tx`insert into companies(id,company_name,cr_number,br_number,incorporation_date,annual_return_basis_date,registered_office,company_secretary,assigned_owner_id,assigned_team_id,data_origin)
            select f.company_id,f.company_name,f.company_id::text,f.company_id::text,'2020-01-01'::date,'2026-01-01'::date,'Synthetic office','Synthetic secretary',f.owner_id,f.team_id,'fixture'
            from jsonb_to_recordset(${jsonRows}) f(company_id uuid,company_name text,owner_id uuid,team_id uuid)`;
          await tx`insert into incorporation_cases(id,proposed_company_name_en,proposed_company_name_zh,proposed_registered_office,proposed_company_secretary,registered_capital,business_nature,status,owner_id,team_id,target_completion_date,company_id,completed_at,created_at)
            select f.inc_id,f.name_en,f.name_zh,'Synthetic office','Synthetic secretary',10000,'Synthetic',f.inc_status,f.owner_id,f.team_id,f.due_date::date,
              case when f.inc_status='Completed' then f.company_id else null end,
              case when f.inc_status='Completed' then '2026-10-22T00:00:00Z'::timestamptz else null end,f.created_at::text::timestamptz
            from jsonb_to_recordset(${jsonRows}) f(inc_id uuid,name_en text,name_zh text,inc_status text,owner_id uuid,team_id uuid,due_date text,company_id uuid,created_at text)`;
          await tx`insert into corporate_change_requests(id,company_id,change_type,status,owner_id,quoted_fee,new_registered_office,completed_at,created_at)
            select f.change_id,f.company_id,'address_change',f.change_status,f.owner_id,1000,'Synthetic new office',
              case when f.change_status='Completed' then '2026-10-22T00:00:00Z'::timestamptz else null end,f.created_at::text::timestamptz
            from jsonb_to_recordset(${jsonRows}) f(change_id uuid,company_id uuid,change_status text,owner_id uuid,created_at text)`;
          incChecklistIds.push(
            ...(
              await tx<
                { id: string }[]
              >`insert into incorporation_checklist_items(case_id,item_label,required,status)
            select f.inc_id,'Synthetic CDD',true,'Missing' from jsonb_to_recordset(${jsonRows}) f(inc_id uuid) returning id`
            ).map((r) => r.id),
          );
          changeChecklistIds.push(
            ...(
              await tx<
                { id: string }[]
              >`insert into corporate_change_checklist_items(request_id,item_label,required,status)
            select f.change_id,'Synthetic board approval',true,'Missing' from jsonb_to_recordset(${jsonRows}) f(change_id uuid) returning id`
            ).map((r) => r.id),
          );
          const [policy] = await tx<
            { id: string }[]
          >`select id from sla_policies order by id limit 1`;
          if (!policy)
            throw new Error("Parent migrated/seeded disposable baseline is missing an SLA policy.");
          await tx`insert into work_items(id,company_id,case_type,corporate_change_request_id,source_event_key,source_event_type,work_type,title,status,owner_id,team_id,sla_policy_version_id,sla_started_at,sla_warning_at,sla_due_at)
            select f.work_id,f.company_id,'corporate_change_request',f.change_id,${prefix}||':'||f.work_id::text,'synthetic_R14_R20','corporate_change_request','Synthetic change work','open',f.owner_id,f.team_id,${policy.id},'2026-10-01'::timestamptz,'2026-10-02'::timestamptz,(f.due_date||'T00:00:00Z')::text::timestamptz
            from jsonb_to_recordset(${tx.json(activeWork)}) f(work_id uuid,company_id uuid,change_id uuid,owner_id uuid,team_id uuid,due_date text)`;

          let queryCount = 0;
          const reader = new Proxy(tx, {
            apply(target, thisArg, args) {
              queryCount++;
              return Reflect.apply(target, thisArg, args);
            },
          });
          const incorporation = createIncorporationRepository({ sql: reader });
          const changes = createCorporateChangeRequestRepository(undefined, { sql: reader });
          const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
          const expected = (
            domain: "incorporation" | "changes",
            who: AuthenticatedActor,
            filter: CaseListQuery,
          ) => {
            const sort = filter.sort ?? "created";
            const due = (r: (typeof rows)[number]) =>
              domain === "incorporation"
                ? r.due_date
                : activeWork.some((w) => w.change_id === r.change_id)
                  ? r.due_date
                  : null;
            const name = (r: (typeof rows)[number]) =>
              domain === "incorporation" ? r.name_en : r.company_name;
            const id = (r: (typeof rows)[number]) =>
              domain === "incorporation" ? r.inc_id : r.change_id;
            const key = (r: (typeof rows)[number]) =>
              sort === "company"
                ? name(r).toLowerCase()
                : sort === "due"
                  ? (due(r) ?? "9999-12-31")
                  : r.created_at.slice(0, -1);
            return rows
              .filter(
                (r) =>
                  (who.role === "Admin" || r.team_id === who.teamId) &&
                  (!filter.teamId || r.team_id === filter.teamId) &&
                  (!filter.ownerId || r.owner_id === filter.ownerId) &&
                  (!filter.status ||
                    (domain === "incorporation" ? r.inc_status : r.change_status) ===
                      filter.status) &&
                  (!filter.q ||
                    (domain === "incorporation" ? r.name_en + " " + r.name_zh : r.company_name)
                      .toLowerCase()
                      .includes(filter.q.toLowerCase())) &&
                  (!filter.dueFrom || (!!due(r) && due(r)! >= filter.dueFrom)) &&
                  (!filter.dueTo || (!!due(r) && due(r)! <= filter.dueTo)),
              )
              .sort(
                (a, b) =>
                  (compare(key(a), key(b)) || compare(id(a), id(b))) *
                  (sort === "created" ? -1 : 1),
              )
              .map(id);
          };
          const collect = async (
            domain: "incorporation" | "changes",
            who: AuthenticatedActor,
            input: CaseListQuery = {},
          ) => {
            const ids: string[] = [];
            let cursor: string | undefined;
            do {
              const query = { q: prefix, ...input, limit: 25, cursor };
              const result =
                domain === "incorporation"
                  ? await listIncorporationCasePageForActor(who, query, {
                      repository: incorporation,
                    })
                  : await listCorporateChangeRequestPageForActor(who, query, {
                      repository: changes,
                    });
              expect(result.items.length).toBeLessThanOrEqual(25);
              for (const row of result.items) {
                expect(ids).not.toContain(row.id);
                ids.push(row.id);
              }
              cursor = result.nextCursor ?? undefined;
              if (cursor && (input.sort ?? "created") === "created")
                expect(JSON.parse(cursor).value).toMatch(/\.00000[123]$/);
              expect(ids.length).toBeLessThanOrEqual(300);
            } while (cursor);
            expect(ids).toEqual(expected(domain, who, { q: prefix, ...input }));
            measurements.push({
              domain,
              role: who.role,
              teamId: who.teamId,
              sort: input.sort ?? "created",
              filters: input,
              count: ids.length,
              ids,
            });
            return ids;
          };

          for (const who of actors.slice(0, 5)) {
            const own = rows.find((r) => who.role === "Admin" || r.team_id === who.teamId)!;
            const foreign = rows.find((r) => r.team_id !== who.teamId)!;
            expect((await collect("incorporation", who)).length).toBe(
              who.role === "Admin" ? 300 : who.teamId === teamA ? 200 : 100,
            );
            expect((await collect("changes", who)).length).toBe(
              who.role === "Admin" ? 300 : who.teamId === teamA ? 200 : 100,
            );
            const legacy = await listIncorporationCasesForActor(
              who,
              { q: prefix },
              { repository: incorporation },
            );
            expect(legacy.map((r) => r.id).sort()).toEqual(
              expected("incorporation", who, { q: prefix }).sort(),
            );
            expect(
              await getIncorporationCaseForActor(who, own.inc_id, { repository: incorporation }),
            ).toMatchObject({
              id: own.inc_id,
              teamId: own.team_id,
              checklist: [expect.objectContaining({ itemLabel: "Synthetic CDD" })],
            });
            expect(
              await getCorporateChangeRequestForActor(who, own.change_id, { repository: changes }),
            ).toMatchObject({
              id: own.change_id,
              checklistItems: [expect.objectContaining({ itemLabel: "Synthetic board approval" })],
            });
            if (who.role !== "Admin") {
              await expect(
                getIncorporationCaseForActor(who, foreign.inc_id, { repository: incorporation }),
              ).rejects.toThrow(/Forbidden/);
              await expect(
                getCorporateChangeRequestForActor(who, foreign.change_id, { repository: changes }),
              ).rejects.toThrow(/Forbidden/);
            }
          }
          for (const who of actors.slice(5)) {
            const before = queryCount;
            await expect(
              listIncorporationCasesForActor(who, {}, { repository: incorporation }),
            ).rejects.toThrow(/Forbidden/);
            await expect(
              listIncorporationCasePageForActor(who, { q: prefix }, { repository: incorporation }),
            ).rejects.toThrow(/Forbidden/);
            await expect(
              listCorporateChangeRequestPageForActor(who, { q: prefix }, { repository: changes }),
            ).rejects.toThrow(/Forbidden/);
            await expect(
              getIncorporationCaseForActor(who, rows[0].inc_id, { repository: incorporation }),
            ).rejects.toThrow(/Forbidden/);
            expect(queryCount).toBe(before);
            await expect(
              getCorporateChangeRequestForActor(who, rows[0].change_id, { repository: changes }),
            ).rejects.toThrow(/Forbidden/);
          }
          for (const domain of ["incorporation", "changes"] as const) {
            for (const sort of ["company", "due"] as const)
              await collect(domain, actors[0], { sort });
            expect((await collect(domain, actors[0], { ownerId: profiles[1].id })).length).toBe(
              100,
            );
            expect((await collect(domain, actors[4], { teamId: teamB })).length).toBe(100);
            expect(
              (
                await collect(domain, actors[0], {
                  q: `${prefix} 香港新創`,
                  status: domain === "incorporation" ? "Documents pending" : "Ready to file",
                  ownerId: profiles[0].id,
                  dueFrom: "2026-11-02",
                  dueTo: "2026-11-09",
                })
              ).length,
            ).toBeGreaterThan(0);
            expect(await collect(domain, actors[0], { q: prefix + "%" })).toEqual([]);
          }
          expect(
            await getIncorporationCaseForActor(actors[0], randomUUID(), {
              repository: incorporation,
            }),
          ).toBeNull();
          expect(
            await getCorporateChangeRequestForActor(actors[0], randomUUID(), {
              repository: changes,
            }),
          ).toBeNull();
          const first = await listIncorporationCasePageForActor(
            actors[0],
            { q: prefix, limit: 25 },
            { repository: incorporation },
          );
          const before = queryCount;
          await expect(
            listIncorporationCasePageForActor(
              actors[1],
              { q: prefix, limit: 25, cursor: first.nextCursor! },
              { repository: incorporation },
            ),
          ).rejects.toThrow(/cursor/);
          expect(queryCount).toBe(before);
          assertionsPassed = true;
          throw rollback;
        });
      } catch (error) {
        if (error !== rollback) throw error;
      }
    } finally {
      try {
        const [counts] = await sql<Record<string, string>[]>`select
          (select count(*) from teams where id=any(${[teamA, teamB]}::uuid[])) teams,
          (select count(*) from users where id=any(${profiles.map((p) => p.id)}::uuid[])) users,
          (select count(*) from companies where id=any(${companyIds}::uuid[])) companies,
          (select count(*) from incorporation_cases where id=any(${incIds}::uuid[])) incorporation,
          (select count(*) from corporate_change_requests where id=any(${changeIds}::uuid[])) changes,
          (select count(*) from incorporation_checklist_items where id=any(${incChecklistIds}::uuid[])) incorporation_checklist,
          (select count(*) from corporate_change_checklist_items where id=any(${changeChecklistIds}::uuid[])) changes_checklist,
          (select count(*) from work_items where id=any(${workIds}::uuid[])) work_items`;
        remaining = Object.fromEntries(
          Object.entries(counts).map(([key, value]) => [key, Number(value)]),
        );
        expect(Object.values(remaining)).toEqual(Array(8).fill(0));
      } finally {
        await sql.end();
        if (process.env.COSEC_EVIDENCE_DIR)
          writeFileSync(
            join(process.env.COSEC_EVIDENCE_DIR, `R14-R20-owned-SQL-${runId}.json`),
            JSON.stringify(
              {
                runId,
                identity,
                assertionsPassed,
                teamIds: [teamA, teamB],
                userIds: profiles.map((p) => p.id),
                incorporationIds: incIds,
                corporateChangeIds: changeIds,
                companyIds,
                workItemIds: workIds,
                incorporationChecklistIds: incChecklistIds,
                changeChecklistIds,
                measurements,
                remaining,
              },
              null,
              2,
            ),
          );
      }
    }
    expect(assertionsPassed).toBe(true);
  }, 120000);
});
