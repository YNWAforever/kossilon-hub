import "dotenv/config";
import { describe, expect, it } from "vitest";
import { createSqlClient, type SqlClient } from "@/server/db/client";
import { createIncorporationRepository } from "./repository";

const databaseUrl = process.env.TEST_DATABASE_URL;

function sqlForTests(): SqlClient {
  if (!databaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for incorporation integration tests.");
  }
  return createSqlClient(databaseUrl, { max: 1 });
}

describe.skipIf(!databaseUrl)("incorporation intake integration", () => {
  it("creates a case with checklist items copied from the seeded template", async () => {
    const sql = sqlForTests();

    try {
      await expect(
        sql.begin(async (tx) => {
          const repository = createIncorporationRepository({ sql: tx });

          const [owner] = await tx<{ id: string }[]>`select id from users where active limit 1`;
          const [team] = await tx<{ id: string }[]>`select id from teams where active limit 1`;

          const created = await repository.createCase({
            proposedCompanyNameEn: "New Venture Limited",
            proposedCompanyNameZh: "新創有限公司",
            proposedRegisteredOffice: "1 Test Street, Hong Kong",
            proposedCompanySecretary: "Kossilon Secretaries Ltd",
            registeredCapital: 10000,
            businessNature: "Trading",
            ownerId: owner.id,
            teamId: team.id,
            targetCompletionDate: "2026-09-01",
            actorId: owner.id,
          });

          expect(created.status).toBe("Intake");
          expect(created.checklist.length).toBeGreaterThan(0);
          expect(created.checklist.every((item) => item.status === "Missing")).toBe(true);

          throw new Error("rollback incorporation integration fixture");
        }),
      ).rejects.toThrow("rollback incorporation integration fixture");
    } finally {
      await sql.end();
    }
  });

  it("moves a checklist item through Received -> Verified with set-once timestamps", async () => {
    const sql = sqlForTests();

    try {
      await expect(
        sql.begin(async (tx) => {
          const repository = createIncorporationRepository({ sql: tx });

          const [owner] = await tx<{ id: string }[]>`select id from users where active limit 1`;
          const [team] = await tx<{ id: string }[]>`select id from teams where active limit 1`;

          const created = await repository.createCase({
            proposedCompanyNameEn: "Checklist Test Limited",
            proposedCompanyNameZh: null,
            proposedRegisteredOffice: "1 Test Street, Hong Kong",
            proposedCompanySecretary: "Kossilon Secretaries Ltd",
            registeredCapital: 10000,
            businessNature: "Trading",
            ownerId: owner.id,
            teamId: team.id,
            targetCompletionDate: "2026-09-01",
            actorId: owner.id,
          });

          const item = created.checklist[0];

          const received = await repository.updateChecklistItem({
            caseId: created.id,
            itemId: item.id,
            status: "Received",
            note: "Emailed by client",
            actorId: owner.id,
          });
          const receivedItem = received.checklist.find((candidate) => candidate.id === item.id)!;
          expect(receivedItem.receivedAt).not.toBeNull();
          expect(receivedItem.verifiedAt).toBeNull();

          const verified = await repository.updateChecklistItem({
            caseId: created.id,
            itemId: item.id,
            status: "Verified",
            note: "Confirmed original",
            actorId: owner.id,
          });
          const verifiedItem = verified.checklist.find((candidate) => candidate.id === item.id)!;
          expect(verifiedItem.receivedAt).toBe(receivedItem.receivedAt);
          expect(verifiedItem.verifiedAt).not.toBeNull();

          throw new Error("rollback incorporation integration fixture");
        }),
      ).rejects.toThrow("rollback incorporation integration fixture");
    } finally {
      await sql.end();
    }
  });

  it("rejects skipping a status, allows the linear sequence", async () => {
    const sql = sqlForTests();

    try {
      await expect(
        sql.begin(async (tx) => {
          const repository = createIncorporationRepository({ sql: tx });

          const [owner] = await tx<{ id: string }[]>`select id from users where active limit 1`;
          const [team] = await tx<{ id: string }[]>`select id from teams where active limit 1`;

          const created = await repository.createCase({
            proposedCompanyNameEn: "Status Test Limited",
            proposedCompanyNameZh: null,
            proposedRegisteredOffice: "1 Test Street, Hong Kong",
            proposedCompanySecretary: "Kossilon Secretaries Ltd",
            registeredCapital: 10000,
            businessNature: "Trading",
            ownerId: owner.id,
            teamId: team.id,
            targetCompletionDate: "2026-09-01",
            actorId: owner.id,
          });

          await expect(
            repository.updateCaseStatus({
              caseId: created.id,
              status: "Ready to file",
              actorId: owner.id,
            }),
          ).rejects.toThrow("Cannot move a case from Intake to Ready to file.");

          const advanced = await repository.updateCaseStatus({
            caseId: created.id,
            status: "Documents pending",
            actorId: owner.id,
          });
          expect(advanced.status).toBe("Documents pending");

          throw new Error("rollback incorporation integration fixture");
        }),
      ).rejects.toThrow("rollback incorporation integration fixture");
    } finally {
      await sql.end();
    }
  });

  it("completes a case by creating a real company and its secretary officer", async () => {
    const setupSql = sqlForTests();
    let caseId: string | undefined;
    let companyId: string | undefined;

    try {
      const repository = createIncorporationRepository({ sql: setupSql });
      const [owner] = await setupSql<{ id: string }[]>`select id from users where active limit 1`;
      const [team] = await setupSql<{ id: string }[]>`select id from teams where active limit 1`;

      const created = await repository.createCase({
        proposedCompanyNameEn: "Complete Test Limited",
        proposedCompanyNameZh: null,
        proposedRegisteredOffice: "1 Test Street, Hong Kong",
        proposedCompanySecretary: "Kossilon Secretaries Ltd",
        registeredCapital: 10000,
        businessNature: "Trading",
        ownerId: owner.id,
        teamId: team.id,
        targetCompletionDate: "2026-09-01",
        actorId: owner.id,
      });
      caseId = created.id;

      await repository.updateCaseStatus({
        caseId: created.id,
        status: "Documents pending",
        actorId: owner.id,
      });
      await repository.updateCaseStatus({
        caseId: created.id,
        status: "Ready to file",
        actorId: owner.id,
      });
      await repository.updateCaseStatus({
        caseId: created.id,
        status: "Filed with Registrar",
        actorId: owner.id,
      });

      const crNumber = `CR-INC-${crypto.randomUUID().slice(0, 8)}`;
      const brNumber = `BR-INC-${crypto.randomUUID().slice(0, 8)}`;

      const completed = await repository.completeCase({
        caseId: created.id,
        crNumber,
        brNumber,
        incorporationDate: "2026-08-01",
        actorId: owner.id,
      });

      expect(completed.status).toBe("Completed");
      expect(completed.companyId).not.toBeNull();
      companyId = completed.companyId!;

      const companyRows = await setupSql<{ annual_return_basis_date: string }[]>`
        select annual_return_basis_date::text from companies where id = ${companyId}
      `;
      expect(companyRows[0].annual_return_basis_date).toBe("2027-08-01");

      const officerRows = await setupSql<{ officer_type: string; name: string }[]>`
        select officer_type, name from officers where company_id = ${companyId}
      `;
      expect(officerRows).toHaveLength(1);
      expect(officerRows[0].officer_type).toBe("secretary");
      expect(officerRows[0].name).toBe("Kossilon Secretaries Ltd");

      await expect(
        repository.completeCase({
          caseId: created.id,
          crNumber: `CR-INC2-${crypto.randomUUID().slice(0, 8)}`,
          brNumber: `BR-INC2-${crypto.randomUUID().slice(0, 8)}`,
          incorporationDate: "2026-08-01",
          actorId: owner.id,
        }),
      ).rejects.toThrow("Cannot complete a case from status Completed");
    } finally {
      // incorporation_cases.company_id is `on delete restrict` — delete the
      // case row BEFORE the company row it points at, or this cleanup itself
      // reproduces the exact CI failure documented in the design spec.
      if (caseId) {
        await setupSql`delete from incorporation_cases where id = ${caseId}`;
      }
      if (companyId) {
        await setupSql`delete from officers where company_id = ${companyId}`;
        await setupSql`delete from companies where id = ${companyId}`;
      }
      await setupSql.end();
    }
  });

  it("serializes concurrent completions so exactly one company is created", async () => {
    const setupSql = sqlForTests();
    let caseId: string | undefined;
    let companyIds: string[] = [];

    try {
      const repository = createIncorporationRepository({ sql: setupSql });
      const [owner] = await setupSql<{ id: string }[]>`select id from users where active limit 1`;
      const [team] = await setupSql<{ id: string }[]>`select id from teams where active limit 1`;

      const created = await repository.createCase({
        proposedCompanyNameEn: "Race Test Limited",
        proposedCompanyNameZh: null,
        proposedRegisteredOffice: "1 Test Street, Hong Kong",
        proposedCompanySecretary: "Kossilon Secretaries Ltd",
        registeredCapital: 10000,
        businessNature: "Trading",
        ownerId: owner.id,
        teamId: team.id,
        targetCompletionDate: "2026-09-01",
        actorId: owner.id,
      });
      caseId = created.id;

      await repository.updateCaseStatus({
        caseId: created.id,
        status: "Documents pending",
        actorId: owner.id,
      });
      await repository.updateCaseStatus({
        caseId: created.id,
        status: "Ready to file",
        actorId: owner.id,
      });
      await repository.updateCaseStatus({
        caseId: created.id,
        status: "Filed with Registrar",
        actorId: owner.id,
      });

      // Two independent connections racing to complete the SAME case
      // concurrently — this is what actually exercises the `for update` lock
      // added in completeCase. A single shared transaction calling
      // completeCase twice sequentially would never race at all, since there
      // is nothing to serialize against — the exact tautological-test mistake
      // made once already in this codebase's history (P1-5's first attempt at
      // the secretary-appointment race test) and corrected since.
      const sqlA = createSqlClient(databaseUrl!, { max: 1 });
      const sqlB = createSqlClient(databaseUrl!, { max: 1 });

      let results: PromiseSettledResult<unknown>[];
      try {
        results = await Promise.allSettled([
          createIncorporationRepository({ sql: sqlA }).completeCase({
            caseId: created.id,
            crNumber: `CR-RACEA-${crypto.randomUUID().slice(0, 8)}`,
            brNumber: `BR-RACEA-${crypto.randomUUID().slice(0, 8)}`,
            incorporationDate: "2026-08-01",
            actorId: owner.id,
          }),
          createIncorporationRepository({ sql: sqlB }).completeCase({
            caseId: created.id,
            crNumber: `CR-RACEB-${crypto.randomUUID().slice(0, 8)}`,
            brNumber: `BR-RACEB-${crypto.randomUUID().slice(0, 8)}`,
            incorporationDate: "2026-08-01",
            actorId: owner.id,
          }),
        ]);
      } finally {
        await sqlA.end();
        await sqlB.end();
      }

      // Populate the cleanup list BEFORE any assertion below can throw. The
      // query only depends on the fixed CR-number prefixes used in the race,
      // not on which promise fulfilled/rejected, so it's safe to run
      // unconditionally here. If this ran after the expect()s instead, a
      // regression in the `for update` lock (both calls succeeding) would
      // throw on `expect(fulfilled).toHaveLength(1)` and skip straight to
      // `finally` with `companyIds` still empty, leaking both orphan
      // companies (and their officers) into the test database forever.
      const companyRows = await setupSql<{ id: string }[]>`
        select id from companies
        where cr_number like 'CR-RACEA-%' or cr_number like 'CR-RACEB-%'
      `;
      companyIds = companyRows.map((row) => row.id);

      const fulfilled = results.filter(
        (result): result is PromiseFulfilledResult<unknown> => result.status === "fulfilled",
      );
      const rejected = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );

      // Exactly one call wins and creates the company; the other loses the
      // race (blocked by the `for update` lock, then sees the
      // already-committed 'Completed' status and throws) rather than both
      // succeeding and creating two orphan companies.
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0].reason).toBeInstanceOf(Error);
      expect((rejected[0].reason as Error).message).toContain(
        "Cannot complete a case from status Completed",
      );

      const finalCase = await repository.getCase(created.id);
      expect(finalCase?.companyId).not.toBeNull();

      // The whole point of the fix: only ONE companies row exists for this
      // race, not two.
      expect(companyIds).toHaveLength(1);
    } finally {
      if (caseId) {
        await setupSql`delete from incorporation_cases where id = ${caseId}`;
      }
      for (const companyId of companyIds) {
        await setupSql`delete from officers where company_id = ${companyId}`;
        await setupSql`delete from companies where id = ${companyId}`;
      }
      await setupSql.end();
    }
  });
});
