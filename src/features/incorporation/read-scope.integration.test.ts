import "dotenv/config";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSqlClient } from "@/server/db/client";
import { createIncorporationRepository } from "./repository";

const url = process.env.TEST_DATABASE_URL;
describe.skipIf(!url)("R14 incorporation reads on real PostgreSQL", () => {
  it("rejects_other_team_and_missing_team without exposing checklist or count", async () => {
    const sql = createSqlClient(url!);
    try {
      await expect(
        sql.begin(async (tx) => {
          const repository = createIncorporationRepository({ sql: tx });
          const [owner] = await tx`select id from users where active limit 1`;
          const teamA = randomUUID(),
            teamB = randomUUID();
          await tx`insert into teams(id,name) values (${teamA},'R14 isolated A'),(${teamB},'R14 isolated B')`;
          const create = (teamId: string, name: string) =>
            repository.createCase({
              proposedCompanyNameEn: name,
              proposedCompanyNameZh: null,
              proposedRegisteredOffice: "Isolated test",
              proposedCompanySecretary: "Isolated test",
              registeredCapital: 10000,
              businessNature: "Test",
              ownerId: owner.id,
              teamId,
              targetCompletionDate: "2026-10-12",
              actorId: owner.id,
            });
          const a = await create(teamA, "R14 A"),
            b = await create(teamB, "R14 private B");
          const scope = { kind: "team" as const, teamId: teamA };
          expect((await repository.listCases(scope)).map((row) => row.id)).toEqual([a.id]);
          expect(await repository.getCase(a.id, scope)).toMatchObject({ id: a.id });
          expect(await repository.getCase(b.id, scope)).toBeNull();
          expect(await repository.countCases(scope)).toBe(1);
          expect(await repository.getCase(b.id, { kind: "all" })).toMatchObject({ id: b.id });
          await expect(repository.listCases(undefined as never)).rejects.toThrow(/Forbidden/);
          await expect(repository.getCase(a.id, { kind: "team", teamId: "" })).rejects.toThrow(
            /Forbidden/,
          );
          throw new Error("rollback R14 isolated incorporation fixture");
        }),
      ).rejects.toThrow("rollback R14 isolated incorporation fixture");
    } finally {
      await sql.end();
    }
  });
});
