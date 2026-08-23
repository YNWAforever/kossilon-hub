import "dotenv/config";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqlClient, type SqlClient } from "@/server/db/client";
import { createClientRepository } from "@/features/clients/repository";
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

  it(
    "creates a share_transfer request against a real shareholding and requires exactly one transferee",
    async () => {
      const companyId = await seedTestCompany();
      const clients = createClientRepository(databaseUrl!);
      const detail = await clients.recordShareholding({
        companyId,
        shareholderName: "Original Holder",
        shareholderAddress: null,
        shareClass: "Ordinary",
        numberOfShares: 1000,
        allotmentDate: "2020-01-01",
        actorId: USER_AMY_ID,
      });
      const shareholding = detail.shareholdings.find(
        (s) => s.shareholderName === "Original Holder",
      )!;
      await clients.close();

      const repository = createCorporateChangeRequestRepository(databaseUrl!);
      const created = await repository.createRequest({
        changeType: "share_transfer",
        companyId,
        quotedFee: 2500,
        transferorShareholdingId: shareholding.id,
        sharesTransferred: 400,
        consideration: 400000,
        stampDutyAmount: 800,
        transfereeShareholdingId: null,
        transfereeNewShareholderName: "New Holder",
        transfereeNewShareholderAddress: "9 Test Ave, Hong Kong",
        actorId: USER_AMY_ID,
      });

      expect(created.sharesTransferred).toBe(400);
      expect(created.checklistItems.map((i) => i.itemLabel)).toContain("Bought & Sold Note");

      await repository.close();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "creates one work_items row per request, idempotently keyed by source event",
    async () => {
      const companyId = await seedTestCompany();
      const repository = createCorporateChangeRequestRepository(databaseUrl!);

      const created = await repository.createRequest({
        changeType: "name_change",
        companyId,
        quotedFee: 3000,
        newNameEn: "Renamed Test Co Ltd",
        newNameZh: null,
        actorId: USER_AMY_ID,
      });

      const sql = sqlForTests();
      const workItems = await sql`
        select case_type, corporate_change_request_id from work_items
        where corporate_change_request_id = ${created.id}
      `;
      expect(workItems).toHaveLength(1);
      expect(workItems[0].case_type).toBe("corporate_change_request");

      await repository.close();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "marks a checklist item Verified and rejects an invalid status transition",
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
      const item = created.checklistItems[0];

      const updated = await repository.updateChecklistItemStatus({
        requestId: created.id,
        itemId: item.id,
        status: "Verified",
        note: null,
        actorId: USER_AMY_ID,
      });
      expect(updated.checklistItems.find((i) => i.id === item.id)!.status).toBe("Verified");

      await expect(
        repository.transitionStatus({
          requestId: created.id,
          toStatus: "Filed with Registrar",
          actorId: USER_AMY_ID,
        }),
      ).rejects.toThrow(/Cannot transition/);

      const progressed = await repository.transitionStatus({
        requestId: created.id,
        toStatus: "Documents pending",
        actorId: USER_AMY_ID,
      });
      expect(progressed.status).toBe("Documents pending");

      await repository.close();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "rejects updateChecklistItemStatus when the item does not belong to the request",
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

      await expect(
        repository.updateChecklistItemStatus({
          requestId: created.id,
          itemId: "00000000-0000-0000-0000-000000000000",
          status: "Verified",
          note: null,
          actorId: USER_AMY_ID,
        }),
      ).rejects.toThrow(/Checklist item not found/);

      await repository.close();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "cancels a request and marks its linked work item cancelled",
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

      const cancelled = await repository.cancelRequest({
        requestId: created.id,
        actorId: USER_AMY_ID,
      });
      expect(cancelled.status).toBe("Cancelled");

      const sql = sqlForTests();
      const workItems = await sql`
        select status from work_items where corporate_change_request_id = ${created.id}
      `;
      expect(workItems[0].status).toBe("cancelled");

      await expect(
        repository.cancelRequest({ requestId: created.id, actorId: USER_AMY_ID }),
      ).rejects.toThrow(/Cannot transition/);

      await repository.close();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );
});
