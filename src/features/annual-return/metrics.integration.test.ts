import { afterAll, describe, expect, it } from "vitest";
import { createSqlClient } from "@/server/db/client";
import { createAnnualReturnRepository } from "./repository";
import { riskForCase } from "./workflow";

const url = process.env.TEST_DATABASE_URL;
const sql = url ? createSqlClient(url, { max: 2 }) : null;
afterAll(async () => {
  await sql?.end();
});
const rollback = new Error("metrics fixture rollback");
const AMY = "20000000-0000-0000-0000-000000000001";
const KEN = "20000000-0000-0000-0000-000000000002";

describe.skipIf(!url)("whole authorised scope operational metrics", () => {
  it("counts cases and evidence units consistently, excludes Filed, filters origins/search and uses HK midnight", async () => {
    await expect(
      sql!.begin(async (tx) => {
        const ids: string[] = [];
        const cases: string[] = [];
        for (const [index, status, owner, origin, missing] of [
          [0, "Documents pending", AMY, "client", 2],
          [1, "Payment pending", KEN, "client", 1],
          [2, "Filed", AMY, "fixture", 3],
        ] as const) {
          const companyId = crypto.randomUUID(),
            caseId = crypto.randomUUID();
          ids.push(companyId);
          cases.push(caseId);
          await tx`insert into companies(id,company_name,cr_number,br_number,incorporation_date,annual_return_basis_date,registered_office,company_secretary,status,assigned_owner_id,assigned_team_id,data_origin)
          values(${companyId},${`Metrics fixture ${index}`},${companyId},${companyId},'2020-01-01','2026-09-01','Test','Test','active',${owner},'10000000-0000-0000-0000-000000000001',${origin})`;
          await tx`insert into annual_return_cases(id,company_id,return_year,made_up_date,filing_due_date,current_status,risk_level,owner_id)
          values(${caseId},${companyId},2026,'2026-09-01','2026-10-01',${status},'green',${owner})`;
          for (let i = 0; i < missing; i++)
            await tx`insert into annual_return_checklist_items(case_id,item_label,required,status,due_date) values(${caseId},${`Unverified ${i}`},true,'Missing','2026-10-01')`;
        }
        const repository = createAnnualReturnRepository({ sql: tx, today: "2026-10-02" });
        const scope = { companyIds: ids, includeFixtures: true };
        const board = await repository.boardTotals(scope);
        const dashboard = await repository.dashboardMetrics("2026-10-02", AMY, scope);
        const truth = {
          overdueCases: 2,
          missingDocumentCount: 3,
          casesWithMissingDocuments: 2,
          activeCases: 2,
        };
        expect(board).toMatchObject(truth);
        expect(dashboard).toMatchObject({ ...truth, assignedToMe: 1 });
        expect(await repository.boardTotals({ ...scope, includeFixtures: false })).toMatchObject({
          ...truth,
          total: 2,
        });
        expect(await repository.boardTotals({ ...scope, q: "Metrics fixture 0" })).toMatchObject({
          total: 1,
          overdueCases: 1,
          missingDocumentCount: 2,
          casesWithMissingDocuments: 1,
        });
        const before = await repository.dashboardMetrics("2026-10-01T15:59:59.999Z", AMY, scope);
        const after = await repository.dashboardMetrics("2026-10-01T16:00:00.000Z", AMY, scope);
        expect(before).toMatchObject({ businessDate: "2026-10-01", overdueCases: 0 });
        expect(after).toMatchObject({ businessDate: "2026-10-02", overdueCases: 2 });
        const first = await repository.listCasePage({ ...scope, limit: 1, overdueOnly: true });
        const second = await repository.listCasePage({
          ...scope,
          limit: 1,
          overdueOnly: true,
          cursor: first.nextCursor!,
        });
        expect([first.cases[0].id, second.cases[0].id].sort()).toEqual(cases.slice(0, 2).sort());
        expect(await repository.boardTotals({ ...scope, visibleToUserId: AMY })).toMatchObject({
          overdueCases: 1,
          missingDocumentCount: 2,
        });
        expect(
          (await repository.listCasePage({ ...scope, missingDocuments: true, limit: 1 })).cases,
        ).toHaveLength(1);
        expect(
          (await repository.listCasePage({ ...scope, missingDocuments: false, limit: 1 })).cases,
        ).toHaveLength(0);
        expect(
          (await repository.listCasePage({ ...scope, activeOnly: true, limit: 20 })).cases
            .map((c) => c.id)
            .sort(),
        ).toEqual(cases.slice(0, 2).sort());
        expect(await repository.boardTotals({ ...scope, companyIds: [] })).toMatchObject({
          total: 0,
          activeCases: 0,
          overdueCases: 0,
        });
        for (const date of ["2026-09-01", "2026-09-02", "2026-09-17", "2026-09-24", "2026-10-02"]) {
          const dated = createAnnualReturnRepository({ sql: tx, today: date });
          const all = await dated.listCases({ ...scope, limit: 20 });
          for (const risk of ["green", "yellow", "orange", "red"] as const) {
            expect(
              (await dated.listCases({ ...scope, risk, limit: 20 })).map((c) => c.id).sort(),
            ).toEqual(
              all
                .filter((c) => riskForCase(c, date) === risk)
                .map((c) => c.id)
                .sort(),
            );
          }
        }
        const [evidence] = await tx<
          { id: string }[]
        >`select id from annual_return_checklist_items where case_id=${cases[1]}`;
        const documentId = crypto.randomUUID();
        await tx`insert into documents(id,company_id,case_id,file_type,file_name,storage_url,upload_source,verification_status,uploaded_by) values(${documentId},${ids[1]},${cases[1]},'Other','Synthetic metrics only','synthetic/metrics','staff','pending',${AMY})`;
        for (const [status, received, verified, document] of [
          ["Received", true, false, false],
          ["Verified", false, true, true],
          ["Verified", true, false, true],
          ["Verified", true, true, false],
          ["Verified", true, true, true],
        ] as const) {
          await tx`update annual_return_checklist_items set status=${status},received_at=${received ? "2026-10-01T00:00:00Z" : null},verified_at=${verified ? "2026-10-01T00:00:00Z" : null},document_id=${document ? documentId : null} where id=${evidence.id}`;
          const complete = status === "Verified" && received && verified && document;
          expect(await repository.boardTotals({ companyIds: [ids[1]] })).toMatchObject({
            missingDocumentCount: complete ? 0 : 1,
            casesWithMissingDocuments: complete ? 0 : 1,
          });
          expect(
            await repository.listCases({
              companyIds: [ids[1]],
              missingDocuments: !complete,
              limit: 1,
            }),
          ).toHaveLength(1);
        }
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
  it("never derives scope totals from the first5000 hydrated cases", async () => {
    await expect(
      sql!.begin(async (tx) => {
        const scaleKey = crypto.randomUUID();
        const companies = await tx<
          { id: string }[]
        >`insert into companies(company_name,cr_number,br_number,incorporation_date,annual_return_basis_date,registered_office,company_secretary,status,assigned_owner_id,assigned_team_id)
        select 'Metrics synthetic scale '||n,${scaleKey}||n,${scaleKey}||n,'2020-01-01'::date,'2026-09-01'::date,'Test','Test','active',${AMY}::uuid,'10000000-0000-0000-0000-000000000001'::uuid from generate_series(1,5001)n returning id`;
        const companyIds = companies.map((c) => c.id);
        await tx`insert into annual_return_cases(company_id,return_year,made_up_date,filing_due_date,current_status,risk_level,owner_id)
        select id,2026,'2026-09-01'::date,'2026-10-01'::date,'Documents pending','green',${AMY}::uuid from companies where id=any(${companyIds}::uuid[])`;
        const repository = createAnnualReturnRepository({ sql: tx });
        const start = performance.now(),
          cpu = process.cpuUsage(),
          memory = process.memoryUsage();
        const metrics = await repository.dashboardMetrics("2026-10-02", AMY, { companyIds });
        console.info(
          `METRICS_SCOPE_5001 duration_ms=${(performance.now() - start).toFixed(2)} cpu_us=${JSON.stringify(process.cpuUsage(cpu))} rss_delta_bytes=${process.memoryUsage().rss - memory.rss} heap_delta_bytes=${process.memoryUsage().heapUsed - memory.heapUsed}`,
        );
        expect(metrics.overdue).toBe(5001);
        expect(metrics.assignedToMe).toBe(5001);
        await tx`update annual_return_cases set filing_due_date='2028-01-01' where company_id=${companyIds[5000]}`;
        const rare = await repository.listCasePage({ companyIds, risk: "green", limit: 1 });
        expect(rare.cases.map((c) => c.companyId)).toEqual([companyIds[5000]]);
        expect(
          (
            await repository.listCasePage({
              companyIds,
              risk: "green",
              limit: 1,
              cursor: rare.nextCursor!,
            })
          ).cases,
        ).toEqual([]);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  }, 30000);
});
