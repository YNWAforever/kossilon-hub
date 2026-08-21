import "dotenv/config";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWhatsAppRepository } from "@/features/whatsapp/repository";
import * as notificationOutbox from "@/features/notifications/outbox";
import { createSqlClient, type SqlClient } from "@/server/db/client";
import {
  createAnnualReturnRepository,
  hongKongBusinessDate,
  DASHBOARD_METRICS_SCAN_LIMIT,
  DEFAULT_CASE_LIMIT,
  RISK_FILTER_SCAN_LIMIT,
} from "./repository";
import { assertAnnualReturnStatusActionAllowed } from "./server-fns";
import type { AnnualReturnStatus, ChecklistStatus, PaymentStatus } from "./types";
import { queueAnnualReturnWhatsAppReminder } from "./whatsapp-reminders";

const databaseUrl = process.env.TEST_DATABASE_URL;

const USER_AMY_ID = "20000000-0000-0000-0000-000000000001";
const USER_KEN_ID = "20000000-0000-0000-0000-000000000002";
const USER_MEI_ID = "20000000-0000-0000-0000-000000000003";
const USER_PRIYA_ID = "20000000-0000-0000-0000-000000000004";
const USER_SAM_ID = "20000000-0000-0000-0000-000000000005";
const TEAM_ANNUAL_RETURN_ID = "10000000-0000-0000-0000-000000000001";
const TEAM_EVIDENCE_ID = "10000000-0000-0000-0000-000000000002";
const TEST_COMPANY_UUID_PREFIX = "90000000";
const TEST_CASE_UUID_PREFIX = "91000000";
const TEST_DOCUMENT_UUID_PREFIX = "92000000";
const TEST_CHECKLIST_UUID_PREFIX = "93000000";
const TEST_PAYMENT_UUID_PREFIX = "94000000";
const TEST_FIXTURE_SEQUENCES = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27,
  28, 29, 30, 31, 32,
] as const;
const INTEGRATION_TEST_TIMEOUT_MS = 20_000;

type ClosableRepository = ReturnType<typeof createAnnualReturnRepository>;

const repositories: ClosableRepository[] = [];
let testSql: SqlClient | undefined;

type MutableAnnualReturnFixtureOptions = {
  sequence: number;
  currentStatus?: AnnualReturnStatus;
  locked?: boolean;
  remindersSent?: number;
  checklistStatus?: ChecklistStatus;
  checklistDocument?: boolean;
  paymentStatus?: PaymentStatus;
  paymentProof?: boolean;
  filingProof?: boolean;
  ownerId?: string;
  reviewerId?: string;
  teamId?: string;
};

type MutableAnnualReturnFixture = {
  companyId: string;
  caseId: string;
  checklistItemId: string;
  evidenceDocumentId: string;
  paymentProofDocumentId: string;
  confirmationDocumentId: string;
  paymentId: string;
};

function repositoryFor(today = "2026-07-05"): ClosableRepository {
  const repository = createAnnualReturnRepository(databaseUrl!, { today });
  repositories.push(repository);
  return repository;
}

function testUuid(prefix: string, sequence: number): string {
  return `${prefix}-0000-0000-0000-${String(sequence).padStart(12, "0")}`;
}

function sqlForTests(): SqlClient {
  if (!databaseUrl) {
    throw new Error("TEST_DATABASE_URL is required for annual return integration tests.");
  }

  testSql ??= createSqlClient(databaseUrl, { max: 1 });
  return testSql;
}

function timestampForChecklistStatus(status: ChecklistStatus, kind: "received" | "verified") {
  if (status === "Missing") return null;
  if (kind === "verified" && status !== "Verified") return null;
  return kind === "received" ? "2026-07-02T09:00:00.000Z" : "2026-07-03T10:00:00.000Z";
}

async function cleanupAnnualReturnTestFixtures() {
  if (!databaseUrl) return;

  const sql = sqlForTests();
  const companyIds = TEST_FIXTURE_SEQUENCES.map((sequence) =>
    testUuid(TEST_COMPANY_UUID_PREFIX, sequence),
  );
  const caseIds = TEST_FIXTURE_SEQUENCES.map((sequence) =>
    testUuid(TEST_CASE_UUID_PREFIX, sequence),
  );
  const checklistItemIds = TEST_FIXTURE_SEQUENCES.map((sequence) =>
    testUuid(TEST_CHECKLIST_UUID_PREFIX, sequence),
  );
  const paymentIds = TEST_FIXTURE_SEQUENCES.map((sequence) =>
    testUuid(TEST_PAYMENT_UUID_PREFIX, sequence),
  );
  const documentIds = TEST_FIXTURE_SEQUENCES.flatMap((sequence) => [
    testUuid(TEST_DOCUMENT_UUID_PREFIX, sequence * 10 + 1),
    testUuid(TEST_DOCUMENT_UUID_PREFIX, sequence * 10 + 2),
    testUuid(TEST_DOCUMENT_UUID_PREFIX, sequence * 10 + 3),
  ]);

  await sql.begin(async (tx) => {
    await tx`
      update annual_return_cases
      set confirmation_document_id = null
      where id = any(${caseIds}::uuid[])
    `;
    await tx`
      update annual_return_checklist_items
      set document_id = null
      where id = any(${checklistItemIds}::uuid[])
        or case_id = any(${caseIds}::uuid[])
    `;
    await tx`
      update payments
      set payment_proof_document_id = null
      where id = any(${paymentIds}::uuid[])
        or case_id = any(${caseIds}::uuid[])
    `;
    await tx`
      delete from whatsapp_webhook_events
      where normalized_message_id in (
        select id
        from whatsapp_messages
        where case_id = any(${caseIds}::uuid[])
          or company_id = any(${companyIds}::uuid[])
      )
    `;
    await tx`
      delete from whatsapp_messages
      where case_id = any(${caseIds}::uuid[])
        or company_id = any(${companyIds}::uuid[])
    `;
    await tx`
      delete from whatsapp_templates
      where template_name = 'annual_return_manual_reminder'
        and created_by in (${USER_AMY_ID}, ${USER_KEN_ID}, ${USER_MEI_ID}, ${USER_PRIYA_ID})
    `;
    await tx`
      delete from whatsapp_contacts
      where company_id = any(${companyIds}::uuid[])
        or phone_e164 in ('+85261234567', '+85255550123')
    `;
    // Before companies: notification_outbox references companies with ON DELETE
    // RESTRICT, so any test that queues a reminder leaves a row that blocks the
    // company delete below — and one failed teardown fails every later test.
    await tx`
      delete from notification_outbox
      where company_id = any(${companyIds}::uuid[])
        or work_item_id in (
          select id from work_items where annual_return_case_id = any(${caseIds}::uuid[])
        )
    `;
    await tx`delete from reminder_logs where case_id = any(${caseIds}::uuid[])`;
    await tx`delete from annual_return_audit_events where case_id = any(${caseIds}::uuid[])`;
    // annual_return_reminder_events.case_id deliberately has no ON DELETE CASCADE
    // (durability intent, matching annual_return_audit_events above), so it must
    // be cleared before the annual_return_cases delete below or that delete fails
    // with a foreign-key violation for any test that wrote a reminder event.
    await tx`delete from annual_return_reminder_events where case_id = any(${caseIds}::uuid[])`;
    await tx`
      delete from assignment_events where work_item_id in (
        select id from work_items where annual_return_case_id = any(${caseIds}::uuid[])
      )`;
    await tx`
      delete from escalation_events where work_item_id in (
        select id from work_items where annual_return_case_id = any(${caseIds}::uuid[])
      )`;
    await tx`delete from work_items where annual_return_case_id = any(${caseIds}::uuid[])`;
    await tx`delete from timeline_events where case_id = any(${caseIds}::uuid[])`;
    await tx`
      delete from payments
      where id = any(${paymentIds}::uuid[])
        or case_id = any(${caseIds}::uuid[])
    `;
    await tx`
      delete from annual_return_checklist_items
      where id = any(${checklistItemIds}::uuid[])
        or case_id = any(${caseIds}::uuid[])
    `;
    await tx`
      delete from documents
      where id = any(${documentIds}::uuid[])
        or case_id = any(${caseIds}::uuid[])
        or company_id = any(${companyIds}::uuid[])
    `;
    await tx`
      delete from annual_return_cases
      where id = any(${caseIds}::uuid[])
        or company_id = any(${companyIds}::uuid[])
    `;
    await tx`delete from companies where id = any(${companyIds}::uuid[])`;
    await tx`delete from users where id = ${USER_SAM_ID}`;
  });
}

async function ensurePolicyTestUsers() {
  const sql = sqlForTests();

  await sql`
    insert into users (
      id,
      name,
      email,
      role,
      team_id,
      active
    )
    values (
      ${USER_SAM_ID},
      'Sam Tse',
      'sam.tse.policy-test@kossilon.hk',
      'Staff',
      ${TEAM_EVIDENCE_ID},
      true
    )
    on conflict (id) do update
    set name = excluded.name,
        email = excluded.email,
        role = excluded.role,
        team_id = excluded.team_id,
        active = excluded.active,
        updated_at = now()
  `;
}

async function createMutableAnnualReturnFixture({
  sequence,
  currentStatus = "Upcoming",
  locked = false,
  remindersSent = 0,
  checklistStatus = "Missing",
  checklistDocument = false,
  paymentStatus = "Payment pending",
  paymentProof = false,
  filingProof = false,
  ownerId = USER_AMY_ID,
  reviewerId = USER_KEN_ID,
  teamId = TEAM_ANNUAL_RETURN_ID,
}: MutableAnnualReturnFixtureOptions): Promise<MutableAnnualReturnFixture> {
  const sql = sqlForTests();
  const companyId = testUuid(TEST_COMPANY_UUID_PREFIX, sequence);
  const caseId = testUuid(TEST_CASE_UUID_PREFIX, sequence);
  const checklistItemId = testUuid(TEST_CHECKLIST_UUID_PREFIX, sequence);
  const paymentId = testUuid(TEST_PAYMENT_UUID_PREFIX, sequence);
  const evidenceDocumentId = testUuid(TEST_DOCUMENT_UUID_PREFIX, sequence * 10 + 1);
  const paymentProofDocumentId = testUuid(TEST_DOCUMENT_UUID_PREFIX, sequence * 10 + 2);
  const confirmationDocumentId = testUuid(TEST_DOCUMENT_UUID_PREFIX, sequence * 10 + 3);
  const checklistDocumentId = checklistDocument ? evidenceDocumentId : null;
  const paymentProofDocumentIdForRow = paymentProof ? paymentProofDocumentId : null;
  const filingReference = filingProof ? `CR-NAR1-TEST-${sequence}` : null;
  const confirmationDocumentIdForRow = filingProof ? confirmationDocumentId : null;
  const paidAt = paymentStatus === "Payment received" ? "2026-07-04T09:00:00.000Z" : null;
  const lockedAt = locked ? "2026-07-05T09:00:00.000Z" : null;
  const completedAt = locked ? "2026-07-05T09:05:00.000Z" : null;

  await sql.begin(async (tx) => {
    await tx`
      insert into companies (
        id,
        company_name,
        cr_number,
        br_number,
        incorporation_date,
        annual_return_basis_date,
        registered_office,
        company_secretary,
        status,
        assigned_owner_id,
        assigned_team_id
      )
      values (
        ${companyId},
        ${`Task 5 Test Company ${sequence} Ltd`},
        ${`T5CR${String(sequence).padStart(5, "0")}`},
        ${`T5BR${String(sequence).padStart(5, "0")}`},
        '2021-07-01',
        '2026-07-01',
        'Unit 5, Test Tower, Hong Kong',
        'Kossilon Corporate Services Limited',
        'active',
        ${ownerId},
        ${teamId}
      )
    `;

    await tx`
      insert into annual_return_cases (
        id,
        company_id,
        return_year,
        made_up_date,
        filing_due_date,
        current_status,
        risk_level,
        owner_id,
        reviewer_id,
        reminders_sent,
        filing_reference,
        locked_at,
        completed_at
      )
      values (
        ${caseId},
        ${companyId},
        2090,
        '2026-07-01',
        '2026-08-12',
        ${currentStatus},
        'green',
        ${ownerId},
        ${reviewerId},
        ${remindersSent},
        ${filingReference},
        ${lockedAt},
        ${completedAt}
      )
    `;

    await tx`
      insert into documents (
        id,
        company_id,
        case_id,
        file_type,
        file_name,
        storage_url,
        upload_source,
        verification_status,
        uploaded_by,
        uploaded_at,
        verified_by,
        verified_at
      )
      values
        (
          ${evidenceDocumentId},
          ${companyId},
          ${caseId},
          'annual-return-evidence',
          ${`task-5-evidence-${sequence}.pdf`},
          ${`kossilon://task-5/${sequence}/evidence.pdf`},
          'staff',
          'verified',
          ${USER_AMY_ID},
          '2026-07-02T09:00:00.000Z',
          ${USER_KEN_ID},
          '2026-07-03T10:00:00.000Z'
        ),
        (
          ${paymentProofDocumentId},
          ${companyId},
          ${caseId},
          'payment-proof',
          ${`task-5-payment-${sequence}.pdf`},
          ${`kossilon://task-5/${sequence}/payment.pdf`},
          'staff',
          'verified',
          ${USER_AMY_ID},
          '2026-07-04T09:00:00.000Z',
          ${USER_KEN_ID},
          '2026-07-04T10:00:00.000Z'
        ),
        (
          ${confirmationDocumentId},
          ${companyId},
          ${caseId},
          'filing-confirmation',
          ${`task-5-confirmation-${sequence}.pdf`},
          ${`kossilon://task-5/${sequence}/confirmation.pdf`},
          'staff',
          'verified',
          ${USER_AMY_ID},
          '2026-07-05T09:00:00.000Z',
          ${USER_KEN_ID},
          '2026-07-05T10:00:00.000Z'
        )
    `;

    if (confirmationDocumentIdForRow) {
      await tx`
        update annual_return_cases
        set confirmation_document_id = ${confirmationDocumentIdForRow}
        where id = ${caseId}
      `;
    }

    await tx`
      insert into annual_return_checklist_items (
        id,
        case_id,
        item_label,
        required,
        status,
        due_date,
        received_at,
        verified_at,
        document_id
      )
      values (
        ${checklistItemId},
        ${caseId},
        'Signed NAR1 form',
        true,
        ${checklistStatus},
        '2026-08-05',
        ${timestampForChecklistStatus(checklistStatus, "received")},
        ${timestampForChecklistStatus(checklistStatus, "verified")},
        ${checklistDocumentId}
      )
    `;

    await tx`
      insert into payments (
        id,
        company_id,
        case_id,
        invoice_number,
        amount,
        currency,
        status,
        due_date,
        paid_at,
        payment_proof_document_id
      )
      values (
        ${paymentId},
        ${companyId},
        ${caseId},
        ${`KOS-T5-${String(sequence).padStart(4, "0")}`},
        3800,
        'HKD',
        ${paymentStatus},
        '2026-08-05',
        ${paidAt},
        ${paymentProofDocumentIdForRow}
      )
    `;
  });

  return {
    companyId,
    caseId,
    checklistItemId,
    evidenceDocumentId,
    paymentProofDocumentId,
    confirmationDocumentId,
    paymentId,
  };
}

afterEach(async () => {
  await Promise.all(repositories.splice(0).map((repository) => repository.close()));
  vi.unstubAllEnvs();
});

afterAll(async () => {
  await testSql?.end();
});

describe("annual return repository configuration", () => {
  it("uses Hong Kong business dates by default", () => {
    expect(hongKongBusinessDate(new Date("2026-07-04T15:59:59.000Z"))).toBe("2026-07-04");
    expect(hongKongBusinessDate(new Date("2026-07-04T16:00:00.000Z"))).toBe("2026-07-05");
  });

  it("exposes owner assignment and case note commands", async () => {
    const unusedSql = (() => {
      throw new Error("SQL client should not be called by this test.");
    }) as unknown as SqlClient;
    const repository = createAnnualReturnRepository({ sql: unusedSql });
    repositories.push(repository);

    expect(repository.assignOwner).toBeTypeOf("function");
    expect(repository.listNotes).toBeTypeOf("function");
    expect(repository.addNote).toBeTypeOf("function");
  });
  it("honors options when the database URL argument is explicitly undefined", async () => {
    vi.stubEnv("DATABASE_URL", "");

    const unusedSql = (() => {
      throw new Error("SQL client should not be called by this test.");
    }) as unknown as SqlClient;

    const repository = createAnnualReturnRepository(undefined, {
      sql: unusedSql,
      today: "2026-07-05",
    });
    repositories.push(repository);

    await expect(repository.close()).resolves.toBeUndefined();
  });
});

describe.skipIf(!databaseUrl)("annual return repository", () => {
  beforeEach(async () => {
    await cleanupAnnualReturnTestFixtures();
  });

  afterEach(async () => {
    await cleanupAnnualReturnTestFixtures();
  });

  it(
    "updates the case and active work items in one owner assignment",
    async () => {
      const fixture = await createMutableAnnualReturnFixture({ sequence: 22 });
      const repository = repositoryFor("2026-07-05");
      await repository.updateStatus(fixture.caseId, "Client reminder sent", USER_AMY_ID);

      const updated = await repository.assignOwner({
        caseId: fixture.caseId,
        ownerId: USER_MEI_ID,
        actorId: USER_KEN_ID,
      });

      expect(updated.ownerId).toBe(USER_MEI_ID);

      const sql = sqlForTests();
      const workItems = await sql<{ owner_id: string | null; status: string }[]>`
        select owner_id, status
        from work_items
        where annual_return_case_id = ${fixture.caseId}
          and status in ('open', 'in_progress', 'blocked')
      `;
      expect(workItems.length).toBeGreaterThan(0);
      expect(workItems.every((item) => item.owner_id === USER_MEI_ID)).toBe(true);

      const assignmentEvents = await sql<{ assigned_to_id: string; assigned_by_id: string }[]>`
        select assigned_to_id, assigned_by_id
        from assignment_events
        where work_item_id in (
          select id from work_items where annual_return_case_id = ${fixture.caseId}
        )
      `;
      expect(assignmentEvents).toContainEqual({
        assigned_to_id: USER_MEI_ID,
        assigned_by_id: USER_KEN_ID,
      });

      const timelineEvents = await sql<{ event_type: string }[]>`
        select event_type
        from timeline_events
        where case_id = ${fixture.caseId}
      `;
      expect(timelineEvents).toContainEqual({
        event_type: "annual_return_owner_assigned",
      });
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "persists and lists case notes in chronological order",
    async () => {
      const fixture = await createMutableAnnualReturnFixture({ sequence: 23 });
      const repository = repositoryFor("2026-07-05");

      await repository.addNote({
        caseId: fixture.caseId,
        body: "Client confirmed the address.",
        actorId: USER_AMY_ID,
      });
      await repository.addNote({
        caseId: fixture.caseId,
        body: "Ready for reviewer follow-up.",
        actorId: USER_KEN_ID,
      });

      expect(await repository.listNotes(fixture.caseId)).toEqual([
        expect.objectContaining({
          body: "Client confirmed the address.",
          authorId: USER_AMY_ID,
        }),
        expect.objectContaining({
          body: "Ready for reviewer follow-up.",
          authorId: USER_KEN_ID,
        }),
      ]);

      const sql = sqlForTests();
      const events = await sql<{ event_type: string }[]>`
        select event_type
        from timeline_events
        where case_id = ${fixture.caseId}
      `;
      expect(events.filter((event) => event.event_type === "case_note_added")).toHaveLength(2);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );
  it("lists annual return cases with company, owner, reviewer, checklist, payment, and recalculated risk", async () => {
    const repository = repositoryFor("2026-07-05");

    const cases = await repository.listCases({});

    expect(cases.map((case_) => case_.companyName)).toEqual([
      "Victoria Peak Holdings Ltd",
      "Kowloon Textiles Ltd",
      "Harbour Trading Ltd",
    ]);

    const harbour = cases.find((case_) => case_.companyName === "Harbour Trading Ltd");
    expect(harbour).toMatchObject({
      currentStatus: "Documents pending",
      ownerId: USER_MEI_ID,
      ownerName: "Mei Lam",
      reviewerId: USER_KEN_ID,
      reviewerName: "Ken Wong",
      filingDueDate: "2026-08-12",
      riskLevel: "green",
    });
    expect(harbour?.checklist).toHaveLength(5);
    expect(harbour?.payment).toMatchObject({
      invoiceNumber: "KOS-AR-2026-1200001",
      amount: 3800,
      currency: "HKD",
      status: "Payment pending",
      dueDate: "2026-08-05",
    });

    const kowloon = cases.find((case_) => case_.companyName === "Kowloon Textiles Ltd");
    expect(kowloon?.riskLevel).toBe("yellow");

    const victoria = cases.find((case_) => case_.companyName === "Victoria Peak Holdings Ltd");
    expect(victoria?.riskLevel).toBe("green");
  });

  it("returns one hydrated case by id and null for an unknown case", async () => {
    const repository = repositoryFor("2026-07-05");
    const [firstCase] = await repository.listCases({ status: "Documents pending" });

    const case_ = await repository.getCase(firstCase.id);

    expect(case_).toMatchObject({
      id: firstCase.id,
      companyName: "Harbour Trading Ltd",
      currentStatus: "Documents pending",
    });
    expect(case_?.checklist).toHaveLength(5);
    expect(case_?.payment?.invoiceNumber).toBe("KOS-AR-2026-1200001");
    await expect(repository.getCase("00000000-0000-0000-0000-000000000000")).resolves.toBeNull();
  });

  it("filters cases by owner, team, reviewer, status, payment, risk, and missing documents", async () => {
    const repository = repositoryFor("2026-07-05");

    await expect(repository.listCases({ ownerId: USER_MEI_ID })).resolves.toHaveLength(1);
    await expect(repository.listCases({ teamId: TEAM_ANNUAL_RETURN_ID })).resolves.toHaveLength(2);
    await expect(repository.listCases({ teamId: TEAM_EVIDENCE_ID })).resolves.toHaveLength(1);
    await expect(repository.listCases({ reviewerId: USER_KEN_ID })).resolves.toHaveLength(3);
    await expect(repository.listCases({ status: "Filed" })).resolves.toHaveLength(1);
    await expect(repository.listCases({ paymentStatus: "Payment pending" })).resolves.toHaveLength(
      2,
    );

    const riskyCases = await repository.listCases({ risk: "yellow" });
    expect(riskyCases.map((case_) => case_.companyName)).toEqual(["Kowloon Textiles Ltd"]);

    const casesMissingDocuments = await repository.listCases({ missingDocuments: true });
    expect(casesMissingDocuments.map((case_) => case_.companyName)).toEqual([
      "Harbour Trading Ltd",
    ]);

    const casesWithoutMissingDocuments = await repository.listCases({ missingDocuments: false });
    expect(casesWithoutMissingDocuments.map((case_) => case_.companyName)).toEqual([
      "Victoria Peak Holdings Ltd",
      "Kowloon Textiles Ltd",
    ]);
  });

  it("returns cases a user owns or reviews under one filter", async () => {
    const repository = repositoryFor("2026-07-05");

    // ownerId and reviewerId are separate AND-ed clauses, so owner-OR-reviewer
    // cannot be asked for with them. Ken reviews all three; Mei owns one of them.
    await expect(repository.listCases({ visibleToUserId: USER_KEN_ID })).resolves.toHaveLength(3);

    const meiCases = await repository.listCases({ visibleToUserId: USER_MEI_ID });
    const meiOwned = await repository.listCases({ ownerId: USER_MEI_ID });

    expect(meiCases.length).toBeGreaterThanOrEqual(meiOwned.length);
    for (const case_ of meiCases) {
      expect(case_.ownerId === USER_MEI_ID || case_.reviewerId === USER_MEI_ID).toBe(true);
    }
  });

  it("caps how many cases a single read returns", async () => {
    const repository = repositoryFor("2026-07-05");

    await expect(repository.listCases({})).resolves.toHaveLength(3);
    await expect(repository.listCases({ limit: 2 })).resolves.toHaveLength(2);
    await expect(repository.listCases({ limit: 1 })).resolves.toHaveLength(1);
  });

  it("uses the repository date source for overdue-only reads", async () => {
    const julyFiveRepository = repositoryFor("2026-07-05");
    const julyTwentyEightRepository = repositoryFor("2026-07-28");

    await expect(julyFiveRepository.listCases({ overdueOnly: true })).resolves.toHaveLength(1);

    const overdueCases = await julyTwentyEightRepository.listCases({ overdueOnly: true });
    expect(overdueCases.map((case_) => case_.companyName)).toEqual([
      "Victoria Peak Holdings Ltd",
      "Kowloon Textiles Ltd",
    ]);
  });

  it(
    "returns dashboard metrics for active operational work",
    async () => {
      const repository = repositoryFor("2026-07-05");

      await expect(repository.dashboardMetrics("2026-07-05", USER_AMY_ID)).resolves.toEqual({
        dueIn7: 0,
        dueIn30: 1,
        overdue: 0,
        highRisk: 0,
        missingDocuments: 4,
        paymentPending: 2,
        assignedToMe: 1,
      });

      await expect(repository.dashboardMetrics("2026-07-05", USER_PRIYA_ID)).resolves.toMatchObject(
        {
          assignedToMe: 1,
        },
      );
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "records reminders, increments the case counter, moves upcoming cases, and writes timeline",
    async () => {
      const fixture = await createMutableAnnualReturnFixture({ sequence: 1 });
      const repository = repositoryFor("2026-07-05");

      const updated = await repository.recordReminder({
        caseId: fixture.caseId,
        actorId: USER_AMY_ID,
        templateLabel: "First statutory reminder",
        recipientName: "Chris Client",
        recipientPhone: "+85255550123",
        draftBody: "Please send the signed NAR1 form.",
        note: "Called before sending WhatsApp copy.",
      });

      expect(updated).toMatchObject({
        id: fixture.caseId,
        currentStatus: "Client reminder sent",
        remindersSent: 1,
      });

      const sql = sqlForTests();
      const reminderLogs = await sql<
        {
          template_label: string;
          recipient_name: string;
          recipient_phone: string;
          draft_body: string;
          note: string | null;
        }[]
      >`
      select template_label, recipient_name, recipient_phone, draft_body, note
      from reminder_logs
      where case_id = ${fixture.caseId}
    `;
      expect(reminderLogs).toEqual([
        {
          template_label: "First statutory reminder",
          recipient_name: "Chris Client",
          recipient_phone: "+85255550123",
          draft_body: "Please send the signed NAR1 form.",
          note: "Called before sending WhatsApp copy.",
        },
      ]);

      const timelineEvents = await sql<{ event_type: string; actor_id: string | null }[]>`
      select event_type, actor_id
      from timeline_events
      where case_id = ${fixture.caseId}
    `;
      expect(timelineEvents).toContainEqual({
        event_type: "client_reminder_logged",
        actor_id: USER_AMY_ID,
      });
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "queues annual return WhatsApp reminders while preserving compliance records",
    async () => {
      const fixture = await createMutableAnnualReturnFixture({ sequence: 21 });
      const sql = sqlForTests();

      await sql.begin(async (tx) => {
        const annualReturnRepository = createAnnualReturnRepository({
          sql: tx,
          today: "2026-07-05",
        });
        const whatsAppRepository = createWhatsAppRepository({ sql: tx });
        const result = await queueAnnualReturnWhatsAppReminder({
          annualReturnRepository,
          whatsAppRepository,
          case_: (await annualReturnRepository.getCase(fixture.caseId))!,
          actorId: USER_AMY_ID,
          recipientName: "Ada Director",
          recipientPhone: "+852 6123 4567",
          today: "2026-07-05",
        });

        expect(result.case).toMatchObject({
          id: fixture.caseId,
          currentStatus: "Client reminder sent",
          remindersSent: 1,
        });
        expect(result.message).toMatchObject({
          direction: "outbound",
          status: "queued",
          companyId: fixture.companyId,
          caseId: fixture.caseId,
          phoneE164: "+85261234567",
          body: expect.stringContaining("Task 5 Test Company 21 Ltd"),
        });

        const reminderLogs = await tx<
          {
            template_label: string;
            recipient_name: string;
            recipient_phone: string;
            note: string | null;
          }[]
        >`
          select template_label, recipient_name, recipient_phone, note
          from reminder_logs
          where case_id = ${fixture.caseId}
        `;
        expect(reminderLogs).toEqual([
          {
            template_label: "Annual return WhatsApp reminder",
            recipient_name: "Ada Director",
            recipient_phone: "+852 6123 4567",
            note: "Queued as WhatsApp template message.",
          },
        ]);

        const auditEvents = await tx<
          {
            action: string;
            actor_id: string | null;
            summary: string;
          }[]
        >`
          select action, actor_id, summary
          from annual_return_audit_events
          where case_id = ${fixture.caseId}
        `;
        expect(auditEvents).toContainEqual({
          action: "record_reminder",
          actor_id: USER_AMY_ID,
          summary: "Manual WhatsApp reminder logged for Ada Director.",
        });

        const whatsAppMessages = await tx<
          {
            id: string;
            direction: string;
            status: string;
            template_name: string;
            phone_e164: string | null;
            sent_by: string | null;
          }[]
        >`
          select
            wm.id,
            wm.direction,
            wm.status,
            wt.template_name,
            wm.phone_e164,
            wm.sent_by
          from whatsapp_messages wm
          join whatsapp_templates wt on wt.id = wm.template_id
          where wm.case_id = ${fixture.caseId}
        `;
        expect(whatsAppMessages).toEqual([
          {
            id: result.message.id,
            direction: "outbound",
            status: "queued",
            template_name: "annual_return_manual_reminder",
            phone_e164: "+85261234567",
            sent_by: USER_AMY_ID,
          },
        ]);

        const timelineEvents = await tx<
          {
            event_type: string;
            actor_id: string | null;
          }[]
        >`
          select event_type, actor_id
          from timeline_events
          where case_id = ${fixture.caseId}
          -- event_type breaks the tie: both rows are written in one transaction,
          -- so now() gives them the same created_at and created_at alone leaves
          -- the order up to the planner.
          order by created_at asc, event_type asc
        `;
        expect(timelineEvents).toEqual([
          {
            event_type: "client_reminder_logged",
            actor_id: USER_AMY_ID,
          },
          {
            event_type: "whatsapp_message_queued",
            actor_id: USER_AMY_ID,
          },
        ]);
      });
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "updates checklist, payment, and filing proof data and records timeline events",
    async () => {
      const fixture = await createMutableAnnualReturnFixture({
        sequence: 2,
        currentStatus: "Documents pending",
      });
      const repository = repositoryFor("2026-07-05");

      const afterChecklist = await repository.updateChecklistItem({
        caseId: fixture.caseId,
        itemId: fixture.checklistItemId,
        status: "Verified",
        documentId: fixture.evidenceDocumentId,
        actorId: USER_AMY_ID,
      });
      const checklistItem = afterChecklist.checklist.find(
        (item) => item.id === fixture.checklistItemId,
      );
      expect(checklistItem).toMatchObject({
        status: "Verified",
        documentId: fixture.evidenceDocumentId,
      });
      expect(checklistItem?.receivedAt).toEqual(expect.any(String));
      expect(checklistItem?.verifiedAt).toEqual(expect.any(String));

      const afterPayment = await repository.updatePayment({
        caseId: fixture.caseId,
        status: "Payment received",
        paymentProofDocumentId: fixture.paymentProofDocumentId,
        actorId: USER_AMY_ID,
      });
      expect(afterPayment.payment).toMatchObject({
        id: fixture.paymentId,
        status: "Payment received",
        paymentProofDocumentId: fixture.paymentProofDocumentId,
      });
      expect(afterPayment.payment?.paidAt).toEqual(expect.any(String));

      const afterFiling = await repository.updateFilingProof({
        caseId: fixture.caseId,
        filingReference: "CR-NAR1-TEST-2",
        confirmationDocumentId: fixture.confirmationDocumentId,
        actorId: USER_AMY_ID,
      });
      expect(afterFiling).toMatchObject({
        filingReference: "CR-NAR1-TEST-2",
        confirmationDocumentId: fixture.confirmationDocumentId,
      });
      await expect(
        repository.updateFilingProof({
          caseId: fixture.caseId,
          filingReference: "CR-NAR1-TEST-2",
          confirmationDocumentId: fixture.confirmationDocumentId,
          actorId: USER_AMY_ID,
        }),
      ).resolves.toMatchObject({
        filingReference: "CR-NAR1-TEST-2",
        confirmationDocumentId: fixture.confirmationDocumentId,
      });
      await expect(
        repository.updateFilingProof({
          caseId: fixture.caseId,
          filingReference: "CR-NAR1-REPLACEMENT",
          confirmationDocumentId: fixture.confirmationDocumentId,
          actorId: USER_AMY_ID,
        }),
      ).rejects.toThrow(/already been accepted/i);

      await repository.updateChecklistItem({
        caseId: fixture.caseId,
        itemId: fixture.checklistItemId,
        status: "Verified",
        documentId: fixture.evidenceDocumentId,
        actorId: USER_AMY_ID,
      });
      await repository.updateChecklistItem({
        caseId: fixture.caseId,
        itemId: fixture.checklistItemId,
        status: "Missing",
        documentId: null,
        actorId: USER_AMY_ID,
      });
      await repository.updateChecklistItem({
        caseId: fixture.caseId,
        itemId: fixture.checklistItemId,
        status: "Verified",
        documentId: fixture.evidenceDocumentId,
        actorId: USER_AMY_ID,
      });

      const workItems = await sqlForTests()<
        {
          source_event_type: string;
        }[]
      >`
        select source_event_type from work_items
        where annual_return_case_id = ${fixture.caseId}
        order by source_event_type
      `;
      expect(workItems.map((item) => item.source_event_type)).toEqual([
        "annual_return_document_updated",
        "annual_return_document_updated",
        "annual_return_document_updated",
        "annual_return_filing_proof_updated",
        "annual_return_payment_updated",
      ]);

      const timelineEvents = await sqlForTests()<
        {
          event_type: string;
        }[]
      >`
        select event_type
        from timeline_events
        where case_id = ${fixture.caseId}
        order by created_at asc
      `;
      expect(timelineEvents.map((event) => event.event_type)).toEqual([
        "checklist_item_updated",
        "payment_updated",
        "filing_proof_updated",
        "checklist_item_updated",
        "checklist_item_updated",
        "checklist_item_updated",
      ]);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "writes structured audit events for successful mutations",
    async () => {
      const fixture = await createMutableAnnualReturnFixture({
        sequence: 20,
        currentStatus: "Payment pending",
      });
      const repository = repositoryFor("2026-07-05");

      await repository.updatePayment({
        caseId: fixture.caseId,
        status: "Payment received",
        paymentProofDocumentId: fixture.paymentProofDocumentId,
        actorId: USER_AMY_ID,
      });

      const auditEvents = await sqlForTests()<
        {
          case_id: string;
          company_id: string;
          actor_id: string | null;
          actor_role: string;
          action: string;
          result: string;
          summary: string;
          metadata: Record<string, unknown>;
        }[]
      >`
        select case_id, company_id, actor_id, actor_role, action, result, summary, metadata
        from annual_return_audit_events
        where case_id = ${fixture.caseId}
        order by created_at asc
      `;

      expect(auditEvents).toEqual([
        {
          case_id: fixture.caseId,
          company_id: fixture.companyId,
          actor_id: USER_AMY_ID,
          actor_role: "Admin",
          action: "update_payment",
          result: "succeeded",
          summary: "Payment status changed to Payment received.",
          metadata: {
            invoiceNumber: "KOS-T5-0020",
            paymentId: fixture.paymentId,
            paymentProofDocumentId: fixture.paymentProofDocumentId,
            status: "Payment received",
          },
        },
      ]);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "blocks incomplete completion and locks fully evidenced completed cases",
    async () => {
      const incompleteFixture = await createMutableAnnualReturnFixture({
        sequence: 3,
        currentStatus: "Filed",
      });
      const readyFixture = await createMutableAnnualReturnFixture({
        sequence: 4,
        currentStatus: "Filed",
        checklistStatus: "Verified",
        checklistDocument: true,
        paymentStatus: "Payment received",
        paymentProof: true,
        filingProof: true,
      });
      const repository = repositoryFor("2026-07-05");

      await expect(
        repository.updateStatus(incompleteFixture.caseId, "Completed", USER_AMY_ID),
      ).rejects.toThrow(/Cannot complete annual return case/i);

      await expect(repository.getCase(incompleteFixture.caseId)).resolves.toMatchObject({
        currentStatus: "Filed",
        lockedAt: null,
        completedAt: null,
      });

      const completed = await repository.updateStatus(
        readyFixture.caseId,
        "Completed",
        USER_AMY_ID,
      );

      expect(completed).toMatchObject({
        currentStatus: "Completed",
      });
      expect(completed.lockedAt).toEqual(expect.any(String));
      expect(completed.completedAt).toEqual(expect.any(String));

      const timelineEvents = await sqlForTests()<
        {
          event_type: string;
        }[]
      >`
      select event_type
      from timeline_events
      where case_id = ${readyFixture.caseId}
    `;
      expect(timelineEvents).toContainEqual({ event_type: "status_changed" });
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "rejects stale non-completion transitions against the locked current status",
    async () => {
      const fixture = await createMutableAnnualReturnFixture({
        sequence: 13,
        currentStatus: "Documents pending",
      });
      const repository = repositoryFor("2026-07-05");

      await sqlForTests()`
        update annual_return_cases
        set current_status = 'Payment pending',
            updated_at = now()
        where id = ${fixture.caseId}
      `;

      await expect(
        repository.updateStatus(fixture.caseId, "Documents received", USER_AMY_ID),
      ).rejects.toThrow(/Cannot move from Payment pending to Documents received/i);

      await expect(repository.getCase(fixture.caseId)).resolves.toMatchObject({
        currentStatus: "Payment pending",
      });

      const timelineEvents = await sqlForTests()<
        {
          event_type: string;
        }[]
      >`
        select event_type
        from timeline_events
        where case_id = ${fixture.caseId}
      `;
      expect(timelineEvents).toEqual([]);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "rejects case mutations after a case is locked",
    async () => {
      const fixture = await createMutableAnnualReturnFixture({
        sequence: 5,
        currentStatus: "Completed",
        locked: true,
        checklistStatus: "Verified",
        checklistDocument: true,
        paymentStatus: "Payment received",
        paymentProof: true,
        filingProof: true,
      });
      const repository = repositoryFor("2026-07-05");

      await expect(repository.updateStatus(fixture.caseId, "Filed", USER_AMY_ID)).rejects.toThrow(
        /locked|completed/i,
      );
      await expect(
        repository.recordReminder({
          caseId: fixture.caseId,
          actorId: USER_AMY_ID,
          templateLabel: "Locked reminder",
          recipientName: "Chris Client",
          recipientPhone: "+85255550123",
          draftBody: "Please ignore.",
          note: "",
        }),
      ).rejects.toThrow(/locked|completed/i);

      await expect(
        repository.updateChecklistItem({
          caseId: fixture.caseId,
          itemId: fixture.checklistItemId,
          status: "Received",
          documentId: fixture.evidenceDocumentId,
          actorId: USER_AMY_ID,
        }),
      ).rejects.toThrow(/locked|completed/i);
      await expect(
        repository.updatePayment({
          caseId: fixture.caseId,
          status: "Payment pending",
          paymentProofDocumentId: null,
          actorId: USER_AMY_ID,
        }),
      ).rejects.toThrow(/locked|completed/i);
      await expect(
        repository.assertCanMutateCase(fixture.caseId, USER_AMY_ID, "update_filing_proof"),
      ).rejects.toThrow(/locked|completed/i);
      await expect(
        repository.updateFilingProof({
          caseId: fixture.caseId,
          filingReference: "CR-NAR1-LOCKED",
          confirmationDocumentId: fixture.confirmationDocumentId,
          actorId: USER_AMY_ID,
        }),
      ).rejects.toThrow(/locked|completed/i);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "rejects missing checklist items and missing payments without writing timeline events",
    async () => {
      const fixture = await createMutableAnnualReturnFixture({
        sequence: 6,
        currentStatus: "Documents pending",
      });
      const repository = repositoryFor("2026-07-05");

      await expect(
        repository.updateChecklistItem({
          caseId: fixture.caseId,
          itemId: "93000000-0000-0000-0000-000000999999",
          status: "Received",
          documentId: fixture.evidenceDocumentId,
          actorId: USER_AMY_ID,
        }),
      ).rejects.toThrow(/Checklist item not found/i);

      await sqlForTests()`delete from payments where case_id = ${fixture.caseId}`;

      await expect(
        repository.updatePayment({
          caseId: fixture.caseId,
          status: "Payment received",
          paymentProofDocumentId: fixture.paymentProofDocumentId,
          actorId: USER_AMY_ID,
        }),
      ).rejects.toThrow(/payment not found/i);

      const timelineEvents = await sqlForTests()<
        {
          event_type: string;
        }[]
      >`
      select event_type
      from timeline_events
      where case_id = ${fixture.caseId}
    `;
      expect(timelineEvents).toEqual([]);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "rejects verified checklist updates without a same-case verified annual return evidence document",
    async () => {
      const fixture = await createMutableAnnualReturnFixture({
        sequence: 7,
        currentStatus: "Documents pending",
      });
      const foreignFixture = await createMutableAnnualReturnFixture({
        sequence: 8,
        currentStatus: "Documents pending",
      });
      const repository = repositoryFor("2026-07-05");

      await expect(
        repository.updateChecklistItem({
          caseId: fixture.caseId,
          itemId: fixture.checklistItemId,
          status: "Verified",
          documentId: null,
          actorId: USER_AMY_ID,
        }),
      ).rejects.toThrow(/document/i);

      await sqlForTests()`
      update documents
      set verification_status = 'pending',
          verified_by = null,
          verified_at = null
      where id = ${fixture.evidenceDocumentId}
    `;

      await expect(
        repository.updateChecklistItem({
          caseId: fixture.caseId,
          itemId: fixture.checklistItemId,
          status: "Verified",
          documentId: fixture.evidenceDocumentId,
          actorId: USER_AMY_ID,
        }),
      ).rejects.toThrow(/verified annual return evidence/i);

      await expect(
        repository.updateChecklistItem({
          caseId: fixture.caseId,
          itemId: fixture.checklistItemId,
          status: "Verified",
          documentId: foreignFixture.evidenceDocumentId,
          actorId: USER_AMY_ID,
        }),
      ).rejects.toThrow(/verified annual return evidence/i);

      await expect(repository.getCase(fixture.caseId)).resolves.toMatchObject({
        checklist: [
          expect.objectContaining({
            id: fixture.checklistItemId,
            status: "Missing",
            documentId: null,
          }),
        ],
      });
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "rejects payment received updates without a same-case verified payment proof document",
    async () => {
      const fixture = await createMutableAnnualReturnFixture({
        sequence: 9,
        currentStatus: "Payment pending",
      });
      const foreignFixture = await createMutableAnnualReturnFixture({
        sequence: 10,
        currentStatus: "Payment pending",
      });
      const repository = repositoryFor("2026-07-05");

      await expect(
        repository.updatePayment({
          caseId: fixture.caseId,
          status: "Payment received",
          paymentProofDocumentId: null,
          actorId: USER_AMY_ID,
        }),
      ).rejects.toThrow(/payment proof/i);

      await expect(
        repository.updatePayment({
          caseId: fixture.caseId,
          status: "Payment received",
          paymentProofDocumentId: fixture.evidenceDocumentId,
          actorId: USER_AMY_ID,
        }),
      ).rejects.toThrow(/verified payment proof/i);

      await expect(
        repository.updatePayment({
          caseId: fixture.caseId,
          status: "Payment received",
          paymentProofDocumentId: foreignFixture.paymentProofDocumentId,
          actorId: USER_AMY_ID,
        }),
      ).rejects.toThrow(/verified payment proof/i);

      await expect(repository.getCase(fixture.caseId)).resolves.toMatchObject({
        payment: expect.objectContaining({
          status: "Payment pending",
          paidAt: null,
          paymentProofDocumentId: null,
        }),
      });
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "rejects filing proof updates without a same-case verified filing confirmation document",
    async () => {
      const fixture = await createMutableAnnualReturnFixture({
        sequence: 11,
        currentStatus: "Filed",
      });
      const foreignFixture = await createMutableAnnualReturnFixture({
        sequence: 12,
        currentStatus: "Filed",
      });
      const repository = repositoryFor("2026-07-05");

      await expect(
        repository.updateFilingProof({
          caseId: fixture.caseId,
          filingReference: "CR-NAR1-TEST-11",
          confirmationDocumentId: fixture.paymentProofDocumentId,
          actorId: USER_AMY_ID,
        }),
      ).rejects.toThrow(/verified filing confirmation/i);

      await expect(
        repository.updateFilingProof({
          caseId: fixture.caseId,
          filingReference: "CR-NAR1-TEST-11",
          confirmationDocumentId: foreignFixture.confirmationDocumentId,
          actorId: USER_AMY_ID,
        }),
      ).rejects.toThrow(/verified filing confirmation/i);

      await expect(repository.getCase(fixture.caseId)).resolves.toMatchObject({
        filingReference: null,
        confirmationDocumentId: null,
      });
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "rechecks current evidence, payment, and filing proof validity before completion",
    async () => {
      const fixture = await createMutableAnnualReturnFixture({
        sequence: 11,
        currentStatus: "Filed",
        checklistStatus: "Verified",
        checklistDocument: true,
        paymentStatus: "Payment received",
        paymentProof: true,
        filingProof: true,
      });
      const repository = repositoryFor("2026-07-05");

      await sqlForTests()`
      update documents
      set verification_status = 'pending',
          verified_by = null,
          verified_at = null
      where id = ${fixture.paymentProofDocumentId}
    `;

      await expect(
        repository.updateStatus(fixture.caseId, "Completed", USER_AMY_ID),
      ).rejects.toThrow(/payment proof/i);

      await expect(repository.getCase(fixture.caseId)).resolves.toMatchObject({
        currentStatus: "Filed",
        lockedAt: null,
        completedAt: null,
      });
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "validates completion payment proof against the locked case company",
    async () => {
      const fixture = await createMutableAnnualReturnFixture({
        sequence: 14,
        currentStatus: "Filed",
        checklistStatus: "Verified",
        checklistDocument: true,
        paymentStatus: "Payment received",
        paymentProof: true,
        filingProof: true,
      });
      const foreignFixture = await createMutableAnnualReturnFixture({
        sequence: 15,
        currentStatus: "Filed",
      });
      const repository = repositoryFor("2026-07-05");

      await sqlForTests()`
        update documents
        set company_id = ${foreignFixture.companyId}
        where id = ${fixture.paymentProofDocumentId}
      `;
      await sqlForTests()`
        update payments
        set company_id = ${foreignFixture.companyId}
        where case_id = ${fixture.caseId}
      `;

      await expect(
        repository.updateStatus(fixture.caseId, "Completed", USER_AMY_ID),
      ).rejects.toThrow(/payment proof/i);

      await expect(repository.getCase(fixture.caseId)).resolves.toMatchObject({
        currentStatus: "Filed",
        lockedAt: null,
        completedAt: null,
      });
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "rejects operational annual return mutations from staff who are not assigned to the case",
    async () => {
      await ensurePolicyTestUsers();
      const fixture = await createMutableAnnualReturnFixture({
        sequence: 16,
        currentStatus: "Documents pending",
        ownerId: USER_MEI_ID,
        reviewerId: USER_KEN_ID,
        teamId: TEAM_ANNUAL_RETURN_ID,
      });
      const repository = repositoryFor("2026-07-05");
      await expect(
        repository.assertCanMutateCase(fixture.caseId, USER_SAM_ID, "update_checklist"),
      ).rejects.toThrow(/assigned staff|reviewers|team managers|admins/i);

      await expect(
        repository.updateChecklistItem({
          caseId: fixture.caseId,
          itemId: fixture.checklistItemId,
          status: "Received",
          documentId: fixture.evidenceDocumentId,
          actorId: USER_SAM_ID,
        }),
      ).rejects.toThrow(/assigned staff|reviewers|team managers|admins/i);

      const timelineEvents = await sqlForTests()<{ event_type: string }[]>`
        select event_type
        from timeline_events
        where case_id = ${fixture.caseId}
      `;
      expect(timelineEvents).toEqual([]);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "rejects operational annual return mutations from managers outside the assigned team",
    async () => {
      const fixture = await createMutableAnnualReturnFixture({
        sequence: 17,
        currentStatus: "Payment pending",
        ownerId: USER_MEI_ID,
        reviewerId: USER_KEN_ID,
        teamId: TEAM_ANNUAL_RETURN_ID,
      });
      const repository = repositoryFor("2026-07-05");

      await expect(
        repository.assertCanMutateCase(fixture.caseId, USER_PRIYA_ID, "update_payment"),
      ).rejects.toThrow(/assigned staff|reviewers|team managers|admins/i);

      await expect(
        repository.updatePayment({
          caseId: fixture.caseId,
          status: "Payment received",
          paymentProofDocumentId: fixture.paymentProofDocumentId,
          actorId: USER_PRIYA_ID,
        }),
      ).rejects.toThrow(/assigned staff|reviewers|team managers|admins/i);

      await expect(repository.getCase(fixture.caseId)).resolves.toMatchObject({
        payment: expect.objectContaining({
          status: "Payment pending",
          paymentProofDocumentId: null,
        }),
      });
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "rejects completion by an owner staff member who is not the reviewer",
    async () => {
      const fixture = await createMutableAnnualReturnFixture({
        sequence: 18,
        currentStatus: "Filed",
        checklistStatus: "Verified",
        checklistDocument: true,
        paymentStatus: "Payment received",
        paymentProof: true,
        filingProof: true,
        ownerId: USER_MEI_ID,
        reviewerId: USER_KEN_ID,
        teamId: TEAM_ANNUAL_RETURN_ID,
      });
      const repository = repositoryFor("2026-07-05");

      await expect(
        repository.updateStatus(fixture.caseId, "Completed", USER_MEI_ID),
      ).rejects.toThrow(/admins|team managers|assigned reviewers/i);

      await expect(repository.getCase(fixture.caseId)).resolves.toMatchObject({
        currentStatus: "Filed",
        lockedAt: null,
        completedAt: null,
      });
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "allows an assigned staff reviewer to complete a ready case",
    async () => {
      await ensurePolicyTestUsers();
      const fixture = await createMutableAnnualReturnFixture({
        sequence: 19,
        currentStatus: "Filed",
        checklistStatus: "Verified",
        checklistDocument: true,
        paymentStatus: "Payment received",
        paymentProof: true,
        filingProof: true,
        ownerId: USER_MEI_ID,
        reviewerId: USER_SAM_ID,
        teamId: TEAM_ANNUAL_RETURN_ID,
      });
      const repository = repositoryFor("2026-07-05");

      const completed = await repository.updateStatus(fixture.caseId, "Completed", USER_SAM_ID);

      expect(completed).toMatchObject({
        currentStatus: "Completed",
      });
      expect(completed.lockedAt).toEqual(expect.any(String));
      expect(completed.completedAt).toEqual(expect.any(String));
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "allows the status server action rules to complete a ready case from a non-adjacent status",
    async () => {
      const fixture = await createMutableAnnualReturnFixture({
        sequence: 12,
        currentStatus: "Documents pending",
        checklistStatus: "Verified",
        checklistDocument: true,
        paymentStatus: "Payment received",
        paymentProof: true,
        filingProof: true,
      });
      const repository = repositoryFor("2026-07-05");
      const current = await repository.getCase(fixture.caseId);

      expect(current).not.toBeNull();
      expect(() => assertAnnualReturnStatusActionAllowed(current!, "Completed")).not.toThrow();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );
});

describe.skipIf(!databaseUrl)("evaluateReminders", () => {
  beforeEach(async () => {
    await cleanupAnnualReturnTestFixtures();
  });

  afterEach(async () => {
    await cleanupAnnualReturnTestFixtures();
    vi.restoreAllMocks();
  });

  it(
    "sends a milestone reminder to the primary contact and enqueues a WhatsApp notification",
    async () => {
      const fixture = await createMutableAnnualReturnFixture({ sequence: 24 });
      const sql = sqlForTests();
      await sql`
        insert into company_contacts (company_id, name, role, email, phone, is_primary)
        values (${fixture.companyId}, 'Ada Contact', 'Director', 'ada@example.test', '+85291234567', true)
      `;
      const repository = repositoryFor("2026-07-13"); // 30 days before the fixture's 2026-08-12 due date

      const result = await repository.evaluateReminders();

      // evaluateReminders sweeps the whole active book by design (see
      // DASHBOARD_METRICS_SCAN_LIMIT above `listCasesForToday` in the
      // repository), so the seeded reference companies (e.g. Kowloon Textiles,
      // Harbour Trading — both due within 30 days of "2026-07-13" and without a
      // company_contacts row) are also evaluated and contribute their own
      // "skipped" outcomes here. Assert this fixture's own contribution rather
      // than a whole-book total that isn't this test's to own.
      expect(result.sent).toBeGreaterThanOrEqual(1);

      const eventRows = await sql<{ milestone: string }[]>`
        select milestone from annual_return_reminder_events where case_id = ${fixture.caseId}
      `;
      expect(eventRows).toEqual([{ milestone: "1_month" }]);

      const outboxRows = await sql<
        { channel: string; notification_type: string; recipient: string }[]
      >`
        select channel, notification_type, recipient from notification_outbox
        where company_id = ${fixture.companyId}
      `;
      expect(outboxRows).toEqual([
        {
          channel: "whatsapp",
          notification_type: "annual_return_reminder_1_month",
          recipient: "+85291234567",
        },
      ]);

      const updatedCase = await repository.getCase(fixture.caseId);
      expect(updatedCase?.remindersSent).toBe(1);
      expect(updatedCase?.currentStatus).toBe("Client reminder sent");

      const timelineRows = await sql<{ event_type: string; actor_type: string }[]>`
        select event_type, actor_type from timeline_events where case_id = ${fixture.caseId}
      `;
      expect(timelineRows).toEqual([
        { event_type: "annual_return_reminder_sent", actor_type: "system" },
      ]);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "does not send a duplicate reminder for a milestone that already fired",
    async () => {
      const fixture = await createMutableAnnualReturnFixture({ sequence: 25 });
      const sql = sqlForTests();
      await sql`
        insert into company_contacts (company_id, name, role, email, phone, is_primary)
        values (${fixture.companyId}, 'Ada Contact', 'Director', 'ada@example.test', '+85291234567', true)
      `;
      const repository = repositoryFor("2026-07-13");

      await repository.evaluateReminders();
      const secondResult = await repository.evaluateReminders();

      expect(secondResult).toEqual({ sent: 0, skipped: 0 });
      const outboxRows = await sql`
        select id from notification_outbox where company_id = ${fixture.companyId}
      `;
      expect(outboxRows).toHaveLength(1);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "chooses email when the primary contact has no phone",
    async () => {
      const fixture = await createMutableAnnualReturnFixture({ sequence: 26 });
      const sql = sqlForTests();
      await sql`
        insert into company_contacts (company_id, name, role, email, phone, is_primary)
        values (${fixture.companyId}, 'Ada Contact', 'Director', 'ada@example.test', null, true)
      `;
      const repository = repositoryFor("2026-07-13");

      await repository.evaluateReminders();

      const outboxRows = await sql<{ channel: string; recipient: string }[]>`
        select channel, recipient from notification_outbox where company_id = ${fixture.companyId}
      `;
      expect(outboxRows).toEqual([{ channel: "email", recipient: "ada@example.test" }]);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "skips and logs a timeline event when no primary contact exists",
    async () => {
      const fixture = await createMutableAnnualReturnFixture({ sequence: 27 });
      const sql = sqlForTests();
      const repository = repositoryFor("2026-07-13");

      const result = await repository.evaluateReminders();

      // Same whole-book caveat as the first test in this block: the seeded
      // reference companies also contribute "skipped" outcomes of their own, so
      // only the lower bound (this fixture's own contribution) is guaranteed.
      expect(result.sent).toBe(0);
      expect(result.skipped).toBeGreaterThanOrEqual(1);
      const outboxRows = await sql`
        select id from notification_outbox where company_id = ${fixture.companyId}
      `;
      expect(outboxRows).toHaveLength(0);
      const timelineRows = await sql<{ event_type: string }[]>`
        select event_type from timeline_events where case_id = ${fixture.caseId}
      `;
      expect(timelineRows).toEqual([{ event_type: "annual_return_reminder_skipped" }]);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "never evaluates a Filed or Completed case",
    async () => {
      const fixture = await createMutableAnnualReturnFixture({
        sequence: 28,
        currentStatus: "Filed",
      });
      const sql = sqlForTests();
      await sql`
        insert into company_contacts (company_id, name, role, email, phone, is_primary)
        values (${fixture.companyId}, 'Ada Contact', 'Director', 'ada@example.test', '+85291234567', true)
      `;
      const repository = repositoryFor("2026-07-13");

      const result = await repository.evaluateReminders();

      // The whole-book scan may also evaluate unrelated cases (e.g. seeded
      // reference companies due within the same window), so the aggregate
      // result alone can't prove THIS Filed case was excluded — assert its own
      // non-effect directly instead.
      expect(result.sent).toBe(0);
      const eventRows = await sql`
        select id from annual_return_reminder_events where case_id = ${fixture.caseId}
      `;
      expect(eventRows).toHaveLength(0);
      const outboxRows = await sql`
        select id from notification_outbox where company_id = ${fixture.companyId}
      `;
      expect(outboxRows).toHaveLength(0);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "skips rather than throws when the primary contact has neither a usable phone nor email",
    async () => {
      const fixture = await createMutableAnnualReturnFixture({ sequence: 32 });
      const sql = sqlForTests();
      // company_contacts' check constraint only guarantees email IS NOT NULL OR
      // phone IS NOT NULL — not that either is a non-empty string. An empty-string
      // phone with no email satisfies the constraint but leaves nobody reachable.
      await sql`
        insert into company_contacts (company_id, name, role, email, phone, is_primary)
        values (${fixture.companyId}, 'Ada Contact', 'Director', null, '', true)
      `;
      const repository = repositoryFor("2026-07-13");

      const result = await repository.evaluateReminders();

      expect(result.sent).toBe(0);
      expect(result.skipped).toBeGreaterThanOrEqual(1);
      const outboxRows = await sql`
        select id from notification_outbox where company_id = ${fixture.companyId}
      `;
      expect(outboxRows).toHaveLength(0);
      const timelineRows = await sql<{ event_type: string }[]>`
        select event_type from timeline_events where case_id = ${fixture.caseId}
      `;
      expect(timelineRows).toEqual([{ event_type: "annual_return_reminder_skipped" }]);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "does not send a reminder for a case that transitions to Filed mid-sweep",
    async () => {
      const gate = await createMutableAnnualReturnFixture({ sequence: 29 });
      const target = await createMutableAnnualReturnFixture({ sequence: 30 });
      const sql = sqlForTests();
      await sql`
        insert into company_contacts (company_id, name, role, email, phone, is_primary)
        values (${gate.companyId}, 'Gate Contact', 'Director', 'gate@example.test', '+85291111111', true)
      `;
      await sql`
        insert into company_contacts (company_id, name, role, email, phone, is_primary)
        values (${target.companyId}, 'Target Contact', 'Director', 'target@example.test', '+85292222222', true)
      `;

      // Both fixtures share the same 2026-08-12 due date, and "Task 5 Test
      // Company 29 Ltd" sorts before "...30 Ltd", so evaluateReminders reaches
      // `gate` before `target`. Hooking gate's own enqueueNotification call
      // gives a deterministic control-flow checkpoint — it only runs once
      // gate's per-case lock, milestone check, and contact lookup have all
      // already succeeded, which is necessarily strictly after the upfront
      // candidate snapshot (which already captured `target` as "Upcoming") and
      // strictly before `target`'s own turn in the sequential loop. Flipping
      // `target` to Filed from a second connection right there reproduces
      // exactly what a concurrent staff action would do, with no timing or
      // manual-locking guesswork required.
      const originalEnqueue = notificationOutbox.enqueueNotification;
      const enqueueSpy = vi
        .spyOn(notificationOutbox, "enqueueNotification")
        .mockImplementationOnce(async (client, input) => {
          await sql`update annual_return_cases set current_status = 'Filed' where id = ${target.caseId}`;
          return originalEnqueue(client, input);
        });

      const repository = repositoryFor("2026-07-13");
      await repository.evaluateReminders();

      expect(enqueueSpy).toHaveBeenCalledOnce();

      const eventRows = await sql`
        select id from annual_return_reminder_events where case_id = ${target.caseId}
      `;
      expect(eventRows).toHaveLength(0);
      const outboxRows = await sql`
        select id from notification_outbox where company_id = ${target.companyId}
      `;
      expect(outboxRows).toHaveLength(0);
      const updatedTarget = await repository.getCase(target.caseId);
      expect(updatedTarget?.remindersSent).toBe(0);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "rolls back the reminder event when enqueueNotification fails",
    async () => {
      const fixture = await createMutableAnnualReturnFixture({ sequence: 31 });
      const sql = sqlForTests();
      await sql`
        insert into company_contacts (company_id, name, role, email, phone, is_primary)
        values (${fixture.companyId}, 'Ada Contact', 'Director', 'ada@example.test', '+85291234567', true)
      `;
      const enqueueSpy = vi
        .spyOn(notificationOutbox, "enqueueNotification")
        .mockRejectedValueOnce(new Error("simulated outbox failure"));
      const repository = repositoryFor("2026-07-13");

      // No try/catch wraps withTransaction inside evaluateReminders' loop (that
      // gap mirrors evaluateEscalations and is unchanged here), so a genuine
      // infrastructure failure still surfaces as a rejection — what this test
      // pins down is that the per-case transaction itself rolls back atomically
      // rather than leaving a "reminder already sent" record with nothing
      // actually sent.
      await expect(repository.evaluateReminders()).rejects.toThrow(/simulated outbox failure/);
      expect(enqueueSpy).toHaveBeenCalledOnce();

      const eventRows = await sql`
        select id from annual_return_reminder_events where case_id = ${fixture.caseId}
      `;
      expect(eventRows).toHaveLength(0);
      const updatedCase = await repository.getCase(fixture.caseId);
      expect(updatedCase?.remindersSent).toBe(0);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );
});

/**
 * risk, missingDocuments and overdueOnly used to be applied in JS *after* the SQL
 * LIMIT, so past DEFAULT_CASE_LIMIT a filtered board silently omitted matches and
 * the dashboard tiles counted the same truncated page. Two of the three are SQL
 * predicates now; the third scans a wider window.
 */
describe("case filters narrow before the limit", () => {
  const source = readFileSync(new URL("./repository.ts", import.meta.url), "utf8");
  const selectCaseRows = source.slice(
    source.indexOf("async function selectCaseRows"),
    source.indexOf("async function hydrateCases"),
  );

  it("filters overdue cases in SQL", () => {
    expect(selectCaseRows).toContain("arc.filing_due_date <");
  });

  it("filters missing documents in SQL", () => {
    expect(selectCaseRows).toContain("annual_return_checklist_items i");
    expect(selectCaseRows).toContain("i.required = true");
  });

  it("leaves only the derived risk filter to run after hydration", () => {
    const hydrated = source.slice(
      source.indexOf("function caseMatchesHydratedFilters"),
      source.indexOf("function countOutstandingRequiredEvidence"),
    );

    expect(hydrated).toContain("filters.risk");
    expect(hydrated).not.toContain("missingDocuments");
    expect(hydrated).not.toContain("overdueOnly");
  });

  it("scans a wider window when the derived risk filter is active", () => {
    expect(RISK_FILTER_SCAN_LIMIT).toBeGreaterThan(DEFAULT_CASE_LIMIT);
    expect(selectCaseRows).toContain("RISK_FILTER_SCAN_LIMIT");
  });

  it("counts dashboard tiles over more than one page of cases, within the actor's scope", () => {
    expect(DASHBOARD_METRICS_SCAN_LIMIT).toBeGreaterThan(DEFAULT_CASE_LIMIT);
    // The tiles were firm-wide for every role while the board was scoped, so a
    // Staff user saw headline numbers for books they cannot open.
    expect(source).toContain("scope: CaseFilters = {}");
    expect(source).toContain("{ ...scope, limit: DASHBOARD_METRICS_SCAN_LIMIT }");
    expect(source).toContain("limit: DASHBOARD_METRICS_SCAN_LIMIT");
  });

  // The SQL EXISTS clause and hasOutstandingRequiredEvidence must agree, or a
  // filtered board and the case detail behind it disagree about the same case.
  it("keeps the SQL predicate identical to hasOutstandingRequiredEvidence", () => {
    const js = source.slice(
      source.indexOf("function hasOutstandingRequiredEvidence"),
      source.indexOf("function hasText"),
    );

    for (const [jsClause, sqlClause] of [
      ["item.required", "i.required = true"],
      ['item.status !== "Verified"', "i.status <> 'Verified'"],
      ["item.receivedAt === null", "i.received_at is null"],
      ["item.verifiedAt === null", "i.verified_at is null"],
      ["item.documentId === null", "i.document_id is null"],
    ]) {
      expect(js, `JS side missing ${jsClause}`).toContain(jsClause);
      expect(selectCaseRows, `SQL side missing ${sqlClause}`).toContain(sqlClause);
    }
  });
});

describe.skipIf(!databaseUrl)("createCase", () => {
  const TEST_TEMPLATE_ID = "95000000-0000-0000-0000-000000000001";
  const TEST_COMPANY_ID = "96000000-0000-0000-0000-000000000001";

  afterEach(async () => {
    const sql = sqlForTests();
    // Deleted in dependency order rather than relying on cascade behavior for
    // every table — explicit and correct regardless of each FK's own ON DELETE rule.
    await sql`delete from work_items where company_id = ${TEST_COMPANY_ID}`;
    await sql`delete from timeline_events where company_id = ${TEST_COMPANY_ID}`;
    await sql`delete from annual_return_audit_events where company_id = ${TEST_COMPANY_ID}`;
    await sql`delete from payments where company_id = ${TEST_COMPANY_ID}`;
    await sql`delete from annual_return_checklist_items where case_id in (
      select id from annual_return_cases where company_id = ${TEST_COMPANY_ID}
    )`;
    await sql`delete from annual_return_cases where company_id = ${TEST_COMPANY_ID}`;
    await sql`delete from companies where id = ${TEST_COMPANY_ID}`;
    await sql`delete from checklist_templates where id = ${TEST_TEMPLATE_ID}`;
  });

  async function seedCompanyAndTemplate(basisDate: string) {
    const sql = sqlForTests();
    await sql`
      insert into companies (
        id, company_name, cr_number, br_number, incorporation_date,
        annual_return_basis_date, registered_office, company_secretary,
        status, assigned_owner_id, assigned_team_id
      ) values (
        ${TEST_COMPANY_ID}, 'Test Harbour Ltd', 'CR-CREATE-TEST', 'BR-CREATE-TEST',
        '2020-01-01', ${basisDate}, 'Test office', 'Test Secretary Ltd',
        'active', ${USER_AMY_ID}, ${TEAM_ANNUAL_RETURN_ID}
      )
      on conflict (id) do nothing
    `;
    await sql`
      insert into checklist_templates (id, name, service_type, description, active, documents, reminders, risk_rules)
      values (
        ${TEST_TEMPLATE_ID}, 'Test template', 'Annual Return — Private Ltd', '', true,
        ${sql.json([
          { id: "doc-1", label: "Signed NAR1", required: true, daysBeforeDue: 14 },
          { id: "doc-2", label: "Register extract", required: false, daysBeforeDue: 7 },
        ])},
        '[]'::jsonb, '[]'::jsonb
      )
      on conflict (id) do nothing
    `;
  }

  it(
    "creates a case with checklist items derived from the template, a payment row, and a work item",
    async () => {
      await seedCompanyAndTemplate("2026-07-01");
      const repository = repositoryFor();

      const created = await repository.createCase({
        companyId: TEST_COMPANY_ID,
        templateId: TEST_TEMPLATE_ID,
        ownerId: USER_AMY_ID,
        invoiceNumber: "INV-TEST-0001",
        feeAmount: 2800,
        actorId: USER_AMY_ID,
      });

      expect(created.companyId).toBe(TEST_COMPANY_ID);
      expect(created.returnYear).toBe(2026);
      expect(created.filingDueDate).toBe("2026-08-12");
      expect(created.currentStatus).toBe("Upcoming");
      expect(created.ownerId).toBe(USER_AMY_ID);
      expect(created.checklist).toHaveLength(2);
      expect(created.checklist.find((item) => item.itemLabel === "Signed NAR1")?.dueDate).toBe(
        "2026-07-29",
      );
      expect(created.checklist.find((item) => item.itemLabel === "Register extract")?.dueDate).toBe(
        "2026-08-05",
      );
      expect(created.payment).not.toBeNull();
      expect(created.payment?.invoiceNumber).toBe("INV-TEST-0001");
      expect(created.payment?.amount).toBe(2800);
      expect(created.payment?.status).toBe("Payment pending");

      const sql = sqlForTests();
      const workItemRows = await sql`
        select work_type, owner_id, team_id from work_items where annual_return_case_id = ${created.id}
      `;
      expect(workItemRows).toHaveLength(1);
      expect(workItemRows[0]?.work_type).toBe("annual_return_case");
      expect(workItemRows[0]?.owner_id).toBe(USER_AMY_ID);
      expect(workItemRows[0]?.team_id).toBe(TEAM_ANNUAL_RETURN_ID);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "rejects a second case for a company that already has one for its return year",
    async () => {
      await seedCompanyAndTemplate("2026-07-01");
      const repository = repositoryFor();
      await repository.createCase({
        companyId: TEST_COMPANY_ID,
        templateId: TEST_TEMPLATE_ID,
        ownerId: USER_AMY_ID,
        invoiceNumber: "INV-TEST-0002",
        feeAmount: 2800,
        actorId: USER_AMY_ID,
      });

      await expect(
        repository.createCase({
          companyId: TEST_COMPANY_ID,
          templateId: TEST_TEMPLATE_ID,
          ownerId: USER_AMY_ID,
          invoiceNumber: "INV-TEST-0003",
          feeAmount: 2800,
          actorId: USER_AMY_ID,
        }),
      ).rejects.toThrow("This company already has a case for 2026.");
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "rejects an inactive checklist template",
    async () => {
      await seedCompanyAndTemplate("2026-07-01");
      const sql = sqlForTests();
      await sql`update checklist_templates set active = false where id = ${TEST_TEMPLATE_ID}`;
      const repository = repositoryFor();

      await expect(
        repository.createCase({
          companyId: TEST_COMPANY_ID,
          templateId: TEST_TEMPLATE_ID,
          ownerId: USER_AMY_ID,
          invoiceNumber: "INV-TEST-0004",
          feeAmount: 2800,
          actorId: USER_AMY_ID,
        }),
      ).rejects.toThrow("Checklist template not found or inactive.");
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "lists the new company as eligible before creating a case, and not after",
    async () => {
      await seedCompanyAndTemplate("2026-09-15");
      const repository = repositoryFor();

      const beforeCreate = await repository.listCompaniesEligibleForCase();
      expect(beforeCreate.some((company) => company.id === TEST_COMPANY_ID)).toBe(true);

      await repository.createCase({
        companyId: TEST_COMPANY_ID,
        templateId: TEST_TEMPLATE_ID,
        ownerId: USER_AMY_ID,
        invoiceNumber: "INV-TEST-0005",
        feeAmount: 2800,
        actorId: USER_AMY_ID,
      });

      const afterCreate = await repository.listCompaniesEligibleForCase();
      expect(afterCreate.some((company) => company.id === TEST_COMPANY_ID)).toBe(false);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );
});
