import "dotenv/config";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqlClient, type SqlClient } from "@/server/db/client";
import { createCorporateChangeRequestRepository } from "./repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
const USER_AMY_ID = "20000000-0000-0000-0000-000000000001";
const TEST_COMPANY_UUID_PREFIX = "98000000";
const INTEGRATION_TEST_TIMEOUT_MS = 30_000;

function testUuid(prefix: string, sequence: number): string {
  return `${prefix}-0000-0000-0000-${String(sequence).padStart(12, "0")}`;
}

let testSql: SqlClient | undefined;
function sqlForTests(): SqlClient {
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL is required.");
  testSql ??= createSqlClient(databaseUrl, { max: 1 });
  return testSql;
}

async function cleanupCorporateChangeFixtures() {
  if (!databaseUrl) return;
  const sql = sqlForTests();
  const companyId = testUuid(TEST_COMPANY_UUID_PREFIX, 1);
  await sql`delete from work_items where company_id = ${companyId}`;
  await sql`delete from corporate_change_requests where company_id = ${companyId}`;
  await sql`delete from officers where company_id = ${companyId}`;
  await sql`delete from shareholdings where company_id = ${companyId}`;
  await sql`delete from companies where id = ${companyId}`;
}

async function seedTestCompany(): Promise<string> {
  const sql = sqlForTests();
  const companyId = testUuid(TEST_COMPANY_UUID_PREFIX, 1);
  await sql`
    insert into companies (
      id, company_name, cr_number, br_number, incorporation_date,
      annual_return_basis_date, registered_office, company_secretary,
      status, assigned_owner_id, assigned_team_id
    ) values (
      ${companyId}, 'Test Corporate Change Co Ltd', 'TEST-CCR-98000001', 'TEST-CBR-98000001',
      '2020-01-01', '2027-01-01', '1 Test Street, Hong Kong', 'Original Secretary',
      'active', ${USER_AMY_ID}, '10000000-0000-0000-0000-000000000001'
    )
    on conflict (id) do nothing
  `;
  return companyId;
}

describe.skipIf(!databaseUrl)("corporate change request repository", () => {
  beforeEach(cleanupCorporateChangeFixtures);
  afterEach(cleanupCorporateChangeFixtures);
  afterAll(async () => {
    await cleanupCorporateChangeFixtures();
    await testSql?.end();
  });

  it(
    "creates an address_change request, seeds its checklist, and lists it",
    async () => {
      const companyId = await seedTestCompany();
      const repository = createCorporateChangeRequestRepository(databaseUrl!);

      const created = await repository.createRequest({
        changeType: "address_change",
        companyId,
        quotedFee: 2800,
        newRegisteredOffice: "88 New Road, Central, Hong Kong",
        actorId: USER_AMY_ID,
      });

      expect(created.status).toBe("Requested");
      expect(created.checklistItems).toHaveLength(3);
      expect(created.checklistItems.map((item) => item.itemLabel)).toContain("NR1 form");

      const fetched = await repository.getRequest(created.id);
      expect(fetched.newRegisteredOffice).toBe("88 New Road, Central, Hong Kong");

      const list = await repository.listRequests({ companyId } as never);
      expect(list.some((row) => row.id === created.id)).toBe(true);

      await repository.close();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );
});
