import "dotenv/config";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSqlClient, type SqlClient } from "@/server/db/client";
import { createClientRepository } from "./repository";

const databaseUrl = process.env.TEST_DATABASE_URL;

const USER_AMY_ID = "20000000-0000-0000-0000-000000000001";
const USER_KEN_ID = "20000000-0000-0000-0000-000000000002";
const TEAM_ANNUAL_RETURN_ID = "10000000-0000-0000-0000-000000000001";
const PACKAGE_BASIC_ID = "30000000-0000-0000-0000-000000000001";
const PACKAGE_STANDARD_ID = "30000000-0000-0000-0000-000000000002";

const TEST_COMPANY_UUID_PREFIX = "97000000";
const TEST_CASE_UUID_PREFIX = "97100000";
const TEST_PAYMENT_UUID_PREFIX = "97200000";
const TEST_CONTACT_UUID_PREFIX = "97300000";
const TEST_FIXTURE_SEQUENCES = [1, 2, 3] as const;
// Matches INTEGRATION_TEST_TIMEOUT_MS in the annual-return suite. Every test here does
// several round trips to a remote database; the 5s vitest default is not enough.
const INTEGRATION_TEST_TIMEOUT_MS = 30_000;

type ClientRepositoryInstance = ReturnType<typeof createClientRepository>;

const repositories: ClientRepositoryInstance[] = [];
let testSql: SqlClient | undefined;

function testUuid(prefix: string, sequence: number): string {
  return `${prefix}-0000-0000-0000-${String(sequence).padStart(12, "0")}`;
}

function sqlForTests(): SqlClient {
  if (!databaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for client register integration tests.");
  }

  testSql ??= createSqlClient(databaseUrl, { max: 1 });
  return testSql;
}

function repositoryForTests(): ClientRepositoryInstance {
  const repository = createClientRepository(databaseUrl!);
  repositories.push(repository);
  return repository;
}

async function cleanupClientFixtures() {
  if (!databaseUrl) return;

  const sql = sqlForTests();
  const companyIds = TEST_FIXTURE_SEQUENCES.map((sequence) =>
    testUuid(TEST_COMPANY_UUID_PREFIX, sequence),
  );

  // Companies cascade to contacts, cases, payments, and timeline events.
  await sql`delete from companies where id = any(${companyIds}::uuid[])`;
  // Companies created by createClient tests use generated ids, so match on the fixture prefix.
  await sql`delete from companies where cr_number like 'TEST-CR-%'`;

  // The inactive-actor test deactivates a real user and restores it in a `finally`, which
  // does not survive the process being killed mid-test. These run against a real database,
  // so heal unconditionally rather than trusting the previous run to have exited cleanly.
  await sql`
    update users set active = true
    where id = any(${[USER_AMY_ID, USER_KEN_ID]}::uuid[]) and not active
  `;
}

/**
 * Inserts a company with an optional latest annual-return case and payment.
 * Returns the company id.
 */
async function seedCompany(options: {
  sequence: number;
  companyName: string;
  packageId?: string | null;
  status?: "active" | "inactive";
  cases?: { returnYear: number; filingDueDate: string; paymentStatus?: string }[];
  contacts?: {
    name: string;
    role: string;
    email: string | null;
    phone: string | null;
    isPrimary: boolean;
  }[];
}): Promise<string> {
  const sql = sqlForTests();
  const companyId = testUuid(TEST_COMPANY_UUID_PREFIX, options.sequence);

  await sql`
    insert into companies (
      id, company_name, cr_number, br_number, incorporation_date,
      annual_return_basis_date, registered_office, company_secretary,
      status, assigned_owner_id, assigned_team_id, service_package_id
    )
    values (
      ${companyId},
      ${options.companyName},
      ${`CR-${options.sequence}-${TEST_COMPANY_UUID_PREFIX}`},
      ${`BR-${options.sequence}-${TEST_COMPANY_UUID_PREFIX}`},
      '2020-01-15',
      '2026-01-15',
      'Unit 1, Test Tower, Hong Kong',
      'Kossilon Secretaries Ltd',
      ${options.status ?? "active"},
      ${USER_AMY_ID},
      ${TEAM_ANNUAL_RETURN_ID},
      ${options.packageId === undefined ? PACKAGE_STANDARD_ID : options.packageId}
    )
  `;

  for (const [index, case_] of (options.cases ?? []).entries()) {
    const caseId = testUuid(TEST_CASE_UUID_PREFIX, options.sequence * 10 + index);
    await sql`
      insert into annual_return_cases (
        id, company_id, return_year, made_up_date, filing_due_date,
        current_status, risk_level, owner_id, reminders_sent
      )
      values (
        ${caseId}, ${companyId}, ${case_.returnYear}, '2026-01-15',
        ${case_.filingDueDate}, 'Upcoming', 'green', ${USER_AMY_ID}, 0
      )
    `;

    if (case_.paymentStatus) {
      await sql`
        insert into payments (id, company_id, case_id, invoice_number, amount, status, due_date)
        values (
          ${testUuid(TEST_PAYMENT_UUID_PREFIX, options.sequence * 10 + index)},
          ${companyId}, ${caseId},
          ${`KOS-TEST-${options.sequence}-${index}`}, 3800,
          ${case_.paymentStatus}, ${case_.filingDueDate}
        )
      `;
    }
  }

  for (const [index, contact] of (options.contacts ?? []).entries()) {
    await sql`
      insert into company_contacts (id, company_id, name, role, email, phone, is_primary)
      values (
        ${testUuid(TEST_CONTACT_UUID_PREFIX, options.sequence * 10 + index)},
        ${companyId}, ${contact.name}, ${contact.role},
        ${contact.email}, ${contact.phone}, ${contact.isPrimary}
      )
    `;
  }

  return companyId;
}

afterAll(async () => {
  await Promise.all(repositories.map((repository) => repository.close()));
  await testSql?.end();
}, INTEGRATION_TEST_TIMEOUT_MS);

describe.skipIf(!databaseUrl)(
  "client repository reads",
  { timeout: INTEGRATION_TEST_TIMEOUT_MS },
  () => {
    beforeEach(async () => {
      await cleanupClientFixtures();
    }, INTEGRATION_TEST_TIMEOUT_MS);

    afterEach(async () => {
      await cleanupClientFixtures();
    }, INTEGRATION_TEST_TIMEOUT_MS);

    it("lists seeded service packages in sort order", async () => {
      const repository = repositoryForTests();

      const packages = await repository.listServicePackages();

      expect(packages.map((servicePackage) => servicePackage.name)).toEqual([
        "Basic",
        "Standard",
        "Premium",
      ]);
      expect(packages[0]).toMatchObject({
        id: PACKAGE_BASIC_ID,
        defaultFee: 2800,
        currency: "HKD",
        active: true,
      });
    });

    it("returns owners, teams, and packages for assignment forms", async () => {
      const repository = repositoryForTests();

      const options = await repository.listAssignmentOptions();

      expect(options.owners.some((owner) => owner.id === USER_AMY_ID)).toBe(true);
      expect(options.teams.some((team) => team.id === TEAM_ANNUAL_RETURN_ID)).toBe(true);
      expect(options.packages).toHaveLength(3);
    });

    it("derives AR due date and payment status from the most recent case", async () => {
      await seedCompany({
        sequence: 1,
        companyName: "Aaa Lateral Test Ltd",
        cases: [
          { returnYear: 2025, filingDueDate: "2025-03-01", paymentStatus: "Payment received" },
          { returnYear: 2026, filingDueDate: "2026-09-30", paymentStatus: "Payment pending" },
        ],
      });
      const repository = repositoryForTests();

      const clients = await repository.listClients();
      const client = clients.find((row) => row.companyName === "Aaa Lateral Test Ltd");

      expect(client).toMatchObject({
        arDueDate: "2026-09-30",
        paymentStatus: "Payment pending",
        invoiceAmount: 3800,
        packageName: "Standard",
        ownerName: "Amy Chan",
        ownerInitials: "AC",
        status: "active",
      });
    });

    it("includes companies that have no annual return cases", async () => {
      await seedCompany({ sequence: 2, companyName: "Aab No Case Ltd" });
      const repository = repositoryForTests();

      const clients = await repository.listClients();
      const client = clients.find((row) => row.companyName === "Aab No Case Ltd");

      expect(client).toBeDefined();
      expect(client?.arDueDate).toBeNull();
      expect(client?.paymentStatus).toBeNull();
      expect(client?.invoiceAmount).toBeNull();
    });

    it("includes inactive companies so the directory can filter on status", async () => {
      await seedCompany({ sequence: 3, companyName: "Aac Inactive Ltd", status: "inactive" });
      const repository = repositoryForTests();

      const clients = await repository.listClients();

      expect(clients.find((row) => row.companyName === "Aac Inactive Ltd")?.status).toBe(
        "inactive",
      );
    });

    it("hydrates a client with contacts ordered primary first", async () => {
      const companyId = await seedCompany({
        sequence: 1,
        companyName: "Aaa Hydrate Test Ltd",
        cases: [{ returnYear: 2026, filingDueDate: "2026-09-30", paymentStatus: "Overdue" }],
        contacts: [
          {
            name: "Zoe Ng",
            role: "Accountant",
            email: "zoe@example.hk",
            phone: null,
            isPrimary: false,
          },
          {
            name: "Alan Ho",
            role: "Director",
            email: null,
            phone: "+85290000001",
            isPrimary: true,
          },
        ],
      });
      const repository = repositoryForTests();

      const detail = await repository.getClient(companyId);

      expect(detail?.contacts.map((contact) => contact.name)).toEqual(["Alan Ho", "Zoe Ng"]);
      expect(detail?.contacts[0]).toMatchObject({
        isPrimary: true,
        phone: "+85290000001",
        email: null,
      });
      expect(detail?.annualReturnHistory).toHaveLength(1);
      expect(detail?.annualReturnHistory[0]).toMatchObject({
        returnYear: 2026,
        filingDueDate: "2026-09-30",
      });
      expect(detail?.registeredOffice).toBe("Unit 1, Test Tower, Hong Kong");
      expect(detail?.incorporationDate).toBe("2020-01-15");
      expect(detail?.paymentStatus).toBe("Overdue");
    });

    it("returns null for an unknown client id", async () => {
      const repository = repositoryForTests();

      await expect(
        repository.getClient("99999999-0000-0000-0000-000000000000"),
      ).resolves.toBeNull();
    });
  },
);

const CREATE_INPUT_BASE = {
  incorporationDate: "2021-06-01",
  annualReturnBasisDate: "2026-06-01",
  registeredOffice: "Room 8, Test Plaza, Hong Kong",
  companySecretary: "Kossilon Secretaries Ltd",
  ownerId: USER_AMY_ID,
  teamId: TEAM_ANNUAL_RETURN_ID,
  packageId: PACKAGE_BASIC_ID,
  actorId: USER_KEN_ID,
};

describe.skipIf(!databaseUrl)(
  "client repository company writes",
  { timeout: INTEGRATION_TEST_TIMEOUT_MS },
  () => {
    beforeEach(async () => {
      await cleanupClientFixtures();
    }, INTEGRATION_TEST_TIMEOUT_MS);

    afterEach(async () => {
      await cleanupClientFixtures();
    }, INTEGRATION_TEST_TIMEOUT_MS);

    it("creates a company with its initial contact and a client_created timeline entry", async () => {
      const repository = repositoryForTests();

      const created = await repository.createClient({
        ...CREATE_INPUT_BASE,
        companyName: "Test Create Ltd",
        crNumber: "TEST-CR-0001",
        brNumber: "TEST-BR-0001",
        contacts: [
          {
            name: "Alan Ho",
            role: "Director",
            email: "alan@example.hk",
            phone: null,
            isPrimary: true,
          },
        ],
      });

      expect(created).toMatchObject({
        companyName: "Test Create Ltd",
        crNumber: "TEST-CR-0001",
        status: "active",
        packageName: "Basic",
        ownerName: "Amy Chan",
      });
      expect(created.contacts).toHaveLength(1);
      expect(created.contacts[0]).toMatchObject({ name: "Alan Ho", isPrimary: true });
      expect(created.timeline[0]).toMatchObject({
        eventType: "client_created",
        actorType: "user",
        actorName: "Ken Wong",
      });
    });

    it("creates a company with no contacts", async () => {
      const repository = repositoryForTests();

      const created = await repository.createClient({
        ...CREATE_INPUT_BASE,
        companyName: "Test No Contact Ltd",
        crNumber: "TEST-CR-0002",
        brNumber: "TEST-BR-0002",
        contacts: [],
      });

      expect(created.contacts).toEqual([]);
    });

    it("rejects a duplicate CR number, identifying the field", async () => {
      const repository = repositoryForTests();
      await repository.createClient({
        ...CREATE_INPUT_BASE,
        companyName: "Test Dup One Ltd",
        crNumber: "TEST-CR-0003",
        brNumber: "TEST-BR-0003",
        contacts: [],
      });

      await expect(
        repository.createClient({
          ...CREATE_INPUT_BASE,
          companyName: "Test Dup Two Ltd",
          crNumber: "TEST-CR-0003",
          brNumber: "TEST-BR-0004",
          contacts: [],
        }),
      ).rejects.toMatchObject({
        name: "ClientWriteError",
        field: "crNumber",
        message: "A company with this CR number already exists.",
      });
    });

    it("rejects a duplicate BR number, identifying the field", async () => {
      const repository = repositoryForTests();
      await repository.createClient({
        ...CREATE_INPUT_BASE,
        companyName: "Test Dup Br One Ltd",
        crNumber: "TEST-CR-0005",
        brNumber: "TEST-BR-0005",
        contacts: [],
      });

      await expect(
        repository.createClient({
          ...CREATE_INPUT_BASE,
          companyName: "Test Dup Br Two Ltd",
          crNumber: "TEST-CR-0006",
          brNumber: "TEST-BR-0005",
          contacts: [],
        }),
      ).rejects.toMatchObject({ field: "brNumber" });
    });

    it("rejects an initial contact with neither email nor phone", async () => {
      const repository = repositoryForTests();

      await expect(
        repository.createClient({
          ...CREATE_INPUT_BASE,
          companyName: "Test Unreachable Ltd",
          crNumber: "TEST-CR-0007",
          brNumber: "TEST-BR-0007",
          contacts: [
            { name: "Ghost", role: "Director", email: null, phone: null, isPrimary: true },
          ],
        }),
      ).rejects.toMatchObject({ field: "contact" });
    });

    it("rolls the company back when its initial contact is rejected", async () => {
      const repository = repositoryForTests();

      await expect(
        repository.createClient({
          ...CREATE_INPUT_BASE,
          companyName: "Test Rollback Ltd",
          crNumber: "TEST-CR-0008",
          brNumber: "TEST-BR-0008",
          contacts: [
            { name: "Ghost", role: "Director", email: null, phone: null, isPrimary: true },
          ],
        }),
      ).rejects.toThrow();

      const rows = await sqlForTests()`
      select id from companies where cr_number = 'TEST-CR-0008'
    `;
      expect(rows).toHaveLength(0);
    });

    it("rejects an unknown actor before writing anything", async () => {
      const repository = repositoryForTests();

      await expect(
        repository.createClient({
          ...CREATE_INPUT_BASE,
          actorId: "99999999-0000-0000-0000-000000000000",
          companyName: "Test Bad Actor Ltd",
          crNumber: "TEST-CR-0009",
          brNumber: "TEST-BR-0009",
          contacts: [],
        }),
      ).rejects.toThrow("Client actor not found or inactive.");

      const rows = await sqlForTests()`
      select id from companies where cr_number = 'TEST-CR-0009'
    `;
      expect(rows).toHaveLength(0);
    });

    it("records changed field names when updating a company", async () => {
      const companyId = await seedCompany({ sequence: 1, companyName: "Aaa Update Test Ltd" });
      const repository = repositoryForTests();

      const updated = await repository.updateClient({
        id: companyId,
        companyName: "Aaa Update Test Ltd",
        registeredOffice: "New Office, Central, Hong Kong",
        status: "inactive",
        ownerId: USER_KEN_ID,
        teamId: TEAM_ANNUAL_RETURN_ID,
        packageId: PACKAGE_BASIC_ID,
        actorId: USER_AMY_ID,
      });

      expect(updated).toMatchObject({
        status: "inactive",
        ownerName: "Ken Wong",
        packageName: "Basic",
        registeredOffice: "New Office, Central, Hong Kong",
      });
      expect(updated.timeline[0]).toMatchObject({
        eventType: "client_updated",
        actorType: "user",
      });
      expect(updated.timeline[0].description).toContain("registeredOffice");
      expect(updated.timeline[0].description).toContain("status");
      expect(updated.timeline[0].description).not.toContain("companyName");
    });

    it("rejects updating an unknown company", async () => {
      const repository = repositoryForTests();

      await expect(
        repository.updateClient({
          id: "99999999-0000-0000-0000-000000000000",
          companyName: "Nowhere Ltd",
          registeredOffice: "Nowhere",
          status: "active",
          ownerId: USER_AMY_ID,
          teamId: TEAM_ANNUAL_RETURN_ID,
          packageId: null,
          actorId: USER_AMY_ID,
        }),
      ).rejects.toThrow("Client not found.");
    });
  },
);

describe.skipIf(!databaseUrl)(
  "client repository contact writes",
  { timeout: INTEGRATION_TEST_TIMEOUT_MS },
  () => {
    beforeEach(async () => {
      await cleanupClientFixtures();
    }, INTEGRATION_TEST_TIMEOUT_MS);

    afterEach(async () => {
      await cleanupClientFixtures();
    }, INTEGRATION_TEST_TIMEOUT_MS);

    it("adds a contact and records a timeline entry", async () => {
      const companyId = await seedCompany({ sequence: 1, companyName: "Aaa Contact Add Ltd" });
      const repository = repositoryForTests();

      const detail = await repository.addContact({
        companyId,
        name: "Alan Ho",
        role: "Director",
        email: "alan@example.hk",
        phone: null,
        isPrimary: true,
        actorId: USER_AMY_ID,
      });

      expect(detail.contacts).toHaveLength(1);
      expect(detail.contacts[0]).toMatchObject({ name: "Alan Ho", isPrimary: true });
      expect(detail.timeline[0]).toMatchObject({ eventType: "contact_added" });
      expect(detail.timeline[0].description).toContain("Alan Ho");
    });

    it("demotes the previous primary when a new contact is promoted", async () => {
      const companyId = await seedCompany({
        sequence: 1,
        companyName: "Aaa Primary Swap Ltd",
        contacts: [
          {
            name: "Alan Ho",
            role: "Director",
            email: "alan@example.hk",
            phone: null,
            isPrimary: true,
          },
        ],
      });
      const repository = repositoryForTests();

      const detail = await repository.addContact({
        companyId,
        name: "Bella Sit",
        role: "Company Secretary",
        email: null,
        phone: "+85290000002",
        isPrimary: true,
        actorId: USER_AMY_ID,
      });

      const primaries = detail.contacts.filter((contact) => contact.isPrimary);
      expect(primaries).toHaveLength(1);
      expect(primaries[0].name).toBe("Bella Sit");
    });

    it("promotes an existing contact and demotes the previous primary", async () => {
      const companyId = await seedCompany({
        sequence: 1,
        companyName: "Aaa Promote Ltd",
        contacts: [
          {
            name: "Alan Ho",
            role: "Director",
            email: "alan@example.hk",
            phone: null,
            isPrimary: true,
          },
          {
            name: "Zoe Ng",
            role: "Accountant",
            email: "zoe@example.hk",
            phone: null,
            isPrimary: false,
          },
        ],
      });
      const repository = repositoryForTests();
      const before = await repository.getClient(companyId);
      const zoe = before!.contacts.find((contact) => contact.name === "Zoe Ng")!;

      const detail = await repository.updateContact({
        companyId,
        contactId: zoe.id,
        name: "Zoe Ng",
        role: "Accountant",
        email: "zoe@example.hk",
        phone: null,
        isPrimary: true,
        actorId: USER_AMY_ID,
      });

      const primaries = detail.contacts.filter((contact) => contact.isPrimary);
      expect(primaries).toHaveLength(1);
      expect(primaries[0].name).toBe("Zoe Ng");
      expect(detail.timeline[0]).toMatchObject({ eventType: "contact_updated" });
    });

    it("rejects a contact with neither email nor phone", async () => {
      const companyId = await seedCompany({ sequence: 1, companyName: "Aaa Unreachable Ltd" });
      const repository = repositoryForTests();

      await expect(
        repository.addContact({
          companyId,
          name: "Ghost",
          role: "Director",
          email: null,
          phone: null,
          isPrimary: false,
          actorId: USER_AMY_ID,
        }),
      ).rejects.toMatchObject({ field: "contact" });
    });

    it("removes the primary contact without error, leaving none", async () => {
      const companyId = await seedCompany({
        sequence: 1,
        companyName: "Aaa Remove Primary Ltd",
        contacts: [
          {
            name: "Alan Ho",
            role: "Director",
            email: "alan@example.hk",
            phone: null,
            isPrimary: true,
          },
          {
            name: "Zoe Ng",
            role: "Accountant",
            email: "zoe@example.hk",
            phone: null,
            isPrimary: false,
          },
        ],
      });
      const repository = repositoryForTests();
      const before = await repository.getClient(companyId);
      const alan = before!.contacts.find((contact) => contact.name === "Alan Ho")!;

      const detail = await repository.removeContact({
        companyId,
        contactId: alan.id,
        actorId: USER_AMY_ID,
      });

      expect(detail.contacts).toHaveLength(1);
      expect(detail.contacts.some((contact) => contact.isPrimary)).toBe(false);
      expect(detail.timeline[0]).toMatchObject({ eventType: "contact_removed" });
    });

    it("rejects removing a contact that belongs to another company", async () => {
      const companyId = await seedCompany({
        sequence: 1,
        companyName: "Aaa Owner Ltd",
        contacts: [
          {
            name: "Alan Ho",
            role: "Director",
            email: "alan@example.hk",
            phone: null,
            isPrimary: true,
          },
        ],
      });
      const otherCompanyId = await seedCompany({ sequence: 2, companyName: "Aab Other Ltd" });
      const repository = repositoryForTests();
      const before = await repository.getClient(companyId);
      const alan = before!.contacts[0];

      await expect(
        repository.removeContact({
          companyId: otherCompanyId,
          contactId: alan.id,
          actorId: USER_AMY_ID,
        }),
      ).rejects.toThrow("Contact not found for this company.");
    });

    it("rejects an inactive actor", async () => {
      const companyId = await seedCompany({ sequence: 1, companyName: "Aaa Inactive Actor Ltd" });
      const sql = sqlForTests();
      await sql`update users set active = false where id = ${USER_KEN_ID}`;
      const repository = repositoryForTests();

      try {
        await expect(
          repository.addContact({
            companyId,
            name: "Alan Ho",
            role: "Director",
            email: "alan@example.hk",
            phone: null,
            isPrimary: false,
            actorId: USER_KEN_ID,
          }),
        ).rejects.toThrow("Client actor not found or inactive.");
      } finally {
        await sql`update users set active = true where id = ${USER_KEN_ID}`;
      }
    });
  },
);

describe.skipIf(!databaseUrl)("officers integration", () => {
  it("appointing a new secretary cessates the old one and syncs companies.company_secretary", async () => {
    const sql = createSqlClient(databaseUrl!, { max: 1 });

    try {
      await expect(
        sql.begin(async (tx) => {
          const repository = createClientRepository({ sql: tx });

          const [owner] = await tx<{ id: string }[]>`
            select id from users where active limit 1
          `;
          const [team] = await tx<{ id: string }[]>`
            select id from teams where active limit 1
          `;

          const client = await repository.createClient({
            companyName: "Officer Test Co Ltd",
            crNumber: `CR-OFF-${crypto.randomUUID().slice(0, 8)}`,
            brNumber: `BR-OFF-${crypto.randomUUID().slice(0, 8)}`,
            incorporationDate: "2020-01-15",
            annualReturnBasisDate: "2020-01-15",
            registeredOffice: "1 Test Street, Hong Kong",
            companySecretary: "Original Secretary Ltd",
            ownerId: owner.id,
            teamId: team.id,
            packageId: null,
            contacts: [],
            actorId: owner.id,
          });

          // Company creation seeds an initial secretary officer.
          expect(client.officers).toHaveLength(1);
          expect(client.officers[0].officerType).toBe("secretary");
          expect(client.officers[0].name).toBe("Original Secretary Ltd");
          expect(client.officers[0].cessationDate).toBeNull();
          expect(client.companySecretary).toBe("Original Secretary Ltd");

          const updated = await repository.appointOfficer({
            companyId: client.id,
            officerType: "secretary",
            name: "New Secretary Ltd",
            identificationType: null,
            identificationNumber: null,
            address: null,
            appointmentDate: "2026-01-01",
            actorId: owner.id,
          });

          const originalSecretary = updated.officers.find((o) => o.name === "Original Secretary Ltd");
          const newSecretary = updated.officers.find((o) => o.name === "New Secretary Ltd");

          expect(originalSecretary?.cessationDate).toBe("2026-01-01");
          expect(newSecretary?.cessationDate).toBeNull();
          expect(updated.companySecretary).toBe("New Secretary Ltd");

          throw new Error("rollback officers integration fixture");
        }),
      ).rejects.toThrow("rollback officers integration fixture");
    } finally {
      await sql.end();
    }
  });

  it("appointing a director does not affect companies.company_secretary", async () => {
    const sql = createSqlClient(databaseUrl!, { max: 1 });

    try {
      await expect(
        sql.begin(async (tx) => {
          const repository = createClientRepository({ sql: tx });

          const [owner] = await tx<{ id: string }[]>`
            select id from users where active limit 1
          `;
          const [team] = await tx<{ id: string }[]>`
            select id from teams where active limit 1
          `;

          const client = await repository.createClient({
            companyName: "Director Test Co Ltd",
            crNumber: `CR-DIR-${crypto.randomUUID().slice(0, 8)}`,
            brNumber: `BR-DIR-${crypto.randomUUID().slice(0, 8)}`,
            incorporationDate: "2020-01-15",
            annualReturnBasisDate: "2020-01-15",
            registeredOffice: "1 Test Street, Hong Kong",
            companySecretary: "A Secretary Ltd",
            ownerId: owner.id,
            teamId: team.id,
            packageId: null,
            contacts: [],
            actorId: owner.id,
          });

          const updated = await repository.appointOfficer({
            companyId: client.id,
            officerType: "director",
            name: "Jane Director",
            identificationType: "hkid",
            identificationNumber: "A1234567",
            address: "2 Test Street, Hong Kong",
            appointmentDate: "2026-01-01",
            actorId: owner.id,
          });

          expect(updated.companySecretary).toBe("A Secretary Ltd");
          expect(updated.officers.find((o) => o.name === "Jane Director")?.officerType).toBe(
            "director",
          );

          const ceased = await repository.ceaseOfficer({
            companyId: client.id,
            officerId: updated.officers.find((o) => o.name === "Jane Director")!.id,
            cessationDate: "2026-06-01",
            actorId: owner.id,
          });

          expect(ceased.officers.find((o) => o.name === "Jane Director")?.cessationDate).toBe(
            "2026-06-01",
          );
          expect(ceased.companySecretary).toBe("A Secretary Ltd");

          throw new Error("rollback officers integration fixture");
        }),
      ).rejects.toThrow("rollback officers integration fixture");
    } finally {
      await sql.end();
    }
  });

  it("never leaves two simultaneously-active secretaries after repeated appointments", async () => {
    const sql = createSqlClient(databaseUrl!, { max: 1 });

    try {
      await expect(
        sql.begin(async (tx) => {
          const repository = createClientRepository({ sql: tx });

          const [owner] = await tx<{ id: string }[]>`
            select id from users where active limit 1
          `;
          const [team] = await tx<{ id: string }[]>`
            select id from teams where active limit 1
          `;

          const client = await repository.createClient({
            companyName: "Secretary Race Test Co Ltd",
            crNumber: `CR-RACE-${crypto.randomUUID().slice(0, 8)}`,
            brNumber: `BR-RACE-${crypto.randomUUID().slice(0, 8)}`,
            incorporationDate: "2020-01-15",
            annualReturnBasisDate: "2020-01-15",
            registeredOffice: "1 Test Street, Hong Kong",
            companySecretary: "First Secretary Ltd",
            ownerId: owner.id,
            teamId: team.id,
            packageId: null,
            contacts: [],
            actorId: owner.id,
          });

          await repository.appointOfficer({
            companyId: client.id,
            officerType: "secretary",
            name: "Second Secretary Ltd",
            identificationType: null,
            identificationNumber: null,
            address: null,
            appointmentDate: "2026-01-01",
            actorId: owner.id,
          });

          const final = await repository.appointOfficer({
            companyId: client.id,
            officerType: "secretary",
            name: "Third Secretary Ltd",
            identificationType: null,
            identificationNumber: null,
            address: null,
            appointmentDate: "2026-02-01",
            actorId: owner.id,
          });

          const activeSecretaries = final.officers.filter(
            (o) => o.officerType === "secretary" && o.cessationDate === null,
          );

          expect(activeSecretaries).toHaveLength(1);
          expect(activeSecretaries[0].name).toBe("Third Secretary Ltd");
          expect(final.companySecretary).toBe("Third Secretary Ltd");

          throw new Error("rollback secretary race fixture");
        }),
      ).rejects.toThrow("rollback secretary race fixture");
    } finally {
      await sql.end();
    }
  });
});
