import "dotenv/config";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSqlClient, type SqlClient } from "@/server/db/client";
import { createAnnualReturnRepository, hongKongBusinessDate } from "./repository";
import type { AnnualReturnStatus, ChecklistStatus, PaymentStatus } from "./types";

const databaseUrl = process.env.TEST_DATABASE_URL;

const USER_AMY_ID = "20000000-0000-0000-0000-000000000001";
const USER_KEN_ID = "20000000-0000-0000-0000-000000000002";
const USER_MEI_ID = "20000000-0000-0000-0000-000000000003";
const USER_PRIYA_ID = "20000000-0000-0000-0000-000000000004";
const TEAM_ANNUAL_RETURN_ID = "10000000-0000-0000-0000-000000000001";
const TEAM_EVIDENCE_ID = "10000000-0000-0000-0000-000000000002";
const TEST_COMPANY_UUID_PREFIX = "90000000";
const TEST_CASE_UUID_PREFIX = "91000000";
const TEST_DOCUMENT_UUID_PREFIX = "92000000";
const TEST_CHECKLIST_UUID_PREFIX = "93000000";
const TEST_PAYMENT_UUID_PREFIX = "94000000";
const TEST_FIXTURE_SEQUENCES = [1, 2, 3, 4, 5, 6] as const;

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
    await tx`delete from reminder_logs where case_id = any(${caseIds}::uuid[])`;
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
  });
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
        ${USER_AMY_ID},
        ${TEAM_ANNUAL_RETURN_ID}
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
        ${USER_AMY_ID},
        ${USER_KEN_ID},
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

  it("returns dashboard metrics for active operational work", async () => {
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

    await expect(repository.dashboardMetrics("2026-07-05", USER_PRIYA_ID)).resolves.toMatchObject({
      assignedToMe: 1,
    });
  });

  it("records reminders, increments the case counter, moves upcoming cases, and writes timeline", async () => {
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
  });

  it("updates checklist, payment, and filing proof data and records timeline events", async () => {
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
    ]);
  });

  it("blocks incomplete completion and locks fully evidenced completed cases", async () => {
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

    const completed = await repository.updateStatus(readyFixture.caseId, "Completed", USER_AMY_ID);

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
  });

  it("rejects case mutations after a case is locked", async () => {
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
      repository.updateFilingProof({
        caseId: fixture.caseId,
        filingReference: "CR-NAR1-LOCKED",
        confirmationDocumentId: fixture.confirmationDocumentId,
        actorId: USER_AMY_ID,
      }),
    ).rejects.toThrow(/locked|completed/i);
  });

  it("rejects missing checklist items and missing payments without writing timeline events", async () => {
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
  });
});
