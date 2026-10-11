import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSqlClient } from "@/server/db/client";
import { createCorporateChangeRequestRepository } from "./repository";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("R14 corporate change reads on real PostgreSQL", () => {
  it("rejects_other_team_and_missing_team for list, count and guessed detail ID", async () => {
    const sql = createSqlClient(url!);
    try {
      await expect(
        sql.begin(async (tx) => {
          const repository = createCorporateChangeRequestRepository(undefined, { sql: tx });
          const [owner] = await tx`select id from users where active limit 1`;
          const teamA = randomUUID(),
            teamB = randomUUID();
          await tx`insert into teams(id,name) values (${teamA},'R14 isolated A'),(${teamB},'R14 isolated B')`;
          const create = async (team: string) => {
            const id = randomUUID();
            await tx`insert into companies(id,company_name,cr_number,br_number,incorporation_date,annual_return_basis_date,registered_office,company_secretary,status,assigned_owner_id,assigned_team_id)
            values (${id},'R14 private company',${id},${id},'2020-01-01','2026-01-01','Isolated test','Isolated test','active',${owner.id},${team})`;
            return repository.createRequest({
              changeType: "address_change",
              companyId: id,
              quotedFee: 2800,
              newRegisteredOffice: "Isolated test",
              actorId: owner.id,
            });
          };
          const a = await create(teamA),
            b = await create(teamB);
          const scope = { kind: "team" as const, teamId: teamA };
          expect((await repository.listRequests({}, scope)).map((row) => row.id)).toEqual([a.id]);
          expect(await repository.getRequest(a.id, scope)).toMatchObject({ id: a.id });
          await expect(repository.getRequest(b.id, scope)).rejects.toThrow(
            "Corporate change request not found.",
          );
          expect(await repository.countRequests({}, scope)).toBe(1);
          expect(await repository.getRequest(b.id, { kind: "all" })).toMatchObject({ id: b.id });
          await expect(repository.listRequests({}, undefined as never)).rejects.toThrow(
            /Forbidden/,
          );
          await expect(repository.getRequest(a.id, { kind: "team", teamId: "" })).rejects.toThrow(
            /Forbidden/,
          );
          throw new Error("rollback R14 isolated corporate change fixture");
        }),
      ).rejects.toThrow("rollback R14 isolated corporate change fixture");
    } finally {
      await sql.end();
    }
  });
});
