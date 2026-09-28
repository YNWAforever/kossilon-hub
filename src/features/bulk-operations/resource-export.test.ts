import { describe, expect, it } from "vitest";
import { createSqlClient } from "@/server/db/client";
import type { AuthenticatedActor } from "@/features/auth/types";
import { bulkExportInputSchema } from "./types";
import { createBulkOperationRepository } from "./repository";
import { csvCell } from "./resource-export";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe("T22 authorized resource CSV export", () => {
  it("neutralizes spreadsheet formulas after leading whitespace", () => {
    expect(csvCell(" =SUM(1,2)")).toBe('"\' =SUM(1,2)"');
    expect(csvCell("+cmd")).toBe('"\'+cmd"');
    expect(csvCell('A"B')).toBe('"A""B"');
  });

  it("rejects arbitrary resource filter fields", () => {
    expect(() =>
      bulkExportInputSchema.parse({
        selection: {
          kind: "filter",
          resource: "clients",
          filters: { arbitrarySql: "select * from users" },
          excludedIds: [],
        },
      }),
    ).toThrow();
  });

  it.skipIf(!databaseUrl)(
    "exports only currently authorized client and case rows",
    async () => {
      const db = createSqlClient(databaseUrl!, { max: 2 });
      const rollback = new Error("T22 export fixture rollback");
      try {
        await expect(
          db.begin(async (tx) => {
            const teamA = crypto.randomUUID();
            const teamB = crypto.randomUUID();
            const managerId = crypto.randomUUID();
            const ownId = crypto.randomUUID();
            const foreignId = crypto.randomUUID();
            const ownCase = crypto.randomUUID();
            const foreignCase = crypto.randomUUID();
            const actor: AuthenticatedActor = {
              authUserId: `t22-export-${managerId}`,
              userId: managerId,
              role: "Manager",
              teamId: teamA,
              active: true,
            };
            await tx`insert into teams(id,name) values
          (${teamA},${`T22 Export A ${teamA}`}),(${teamB},${`T22 Export B ${teamB}`})`;
            await tx`insert into users(id,name,email,role,team_id,active)
          values (${managerId},'T22 Export Manager',${`${managerId}@example.invalid`},
            'Manager',${teamA},true)`;
            await tx`insert into staff_profiles(user_id,auth_user_id,role,team_id,active)
          values (${managerId},${actor.authUserId},'Manager',${teamA},true)`;
            for (const [id, teamId, name] of [
              [ownId, teamA, " =SUM(1,2)"],
              [foreignId, teamB, "Hidden"],
            ] as const) {
              await tx`insert into companies(id,company_name,cr_number,br_number,
            incorporation_date,annual_return_basis_date,registered_office,
            company_secretary,assigned_owner_id,assigned_team_id,data_origin)
            values (${id},${name},${`CR-${id}`},${`BR-${id}`},
              '2020-01-01','2026-01-01','Test address','Test secretary',
              ${managerId},${teamId},'client')`;
            }
            for (const [id, companyId] of [
              [ownCase, ownId],
              [foreignCase, foreignId],
            ] as const) {
              await tx`insert into annual_return_cases(id,company_id,return_year,
            made_up_date,filing_due_date,current_status,owner_id)
            values (${id},${companyId},2026,'2026-01-01','2026-02-11',
              'Upcoming',${managerId})`;
            }
            const repo = createBulkOperationRepository({ sql: tx });
            const clients = await repo.exportSelection(actor, {
              selection: { kind: "ids", resource: "clients", ids: [ownId, foreignId] },
            });
            expect(clients).toMatchObject({ selectedCount: 2, exportedCount: 1 });
            expect(clients.csv).toContain(ownId);
            expect(clients.csv).not.toContain(foreignId);
            expect(clients.csv).toContain(`"' =SUM(1,2)"`);
            const cases = await repo.exportSelection(actor, {
              selection: {
                kind: "ids",
                resource: "annual-return-cases",
                ids: [ownCase, foreignCase],
              },
            });
            expect(cases).toMatchObject({ selectedCount: 2, exportedCount: 1 });
            expect(cases.csv).toContain(ownCase);
            expect(cases.csv).not.toContain(foreignCase);
            throw rollback;
          }),
        ).rejects.toBe(rollback);
      } finally {
        await db.end();
      }
    },
    60_000,
  );
});
