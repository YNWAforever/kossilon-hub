import { afterAll, describe, expect, it } from "vitest";
import { createSqlClient } from "@/server/db/client";
import type { AuthenticatedActor } from "@/features/auth/types";
import { createBulkOperationRepository } from "@/features/bulk-operations/repository";
import { bulkOperationCsv } from "@/features/bulk-operations/server-fns";
import { createNarImportApplyRepository } from "./apply-repository";
import { readNarSheet } from "./mapping";
import { createNarImportRepository } from "./repository";
import type { WorkbookCell, WorkbookSheet } from "./xlsx/workbook";

const databaseUrl = process.env.TEST_DATABASE_URL;
const sql = databaseUrl ? createSqlClient(databaseUrl, { max: 3 }) : null;
function cell(column: string, row: number, text: string): WorkbookCell {
  return {
    ref: `${column}${row}`,
    column,
    row,
    type: "s",
    raw: text,
    text,
    dateFormatted: false,
    fromFormula: false,
  };
}
function sheet(ids: string[], names: string[]): WorkbookSheet {
  const headers = new Map<string, WorkbookCell>();
  for (const [column, label] of Object.entries({
    B: "Client ID",
    C: "Name",
    D: "Date of Incorp",
    E: "Invoice no.",
    F: "Payment Rcvd Date",
    G: "AR Due Date",
    H: "BR Due Date",
  }))
    headers.set(column, cell(column, 1, label));
  const rows = new Map<number, Map<string, WorkbookCell>>([[1, headers]]);
  for (let index = 0; index < ids.length; index += 1) {
    const n = index + 2;
    const due = ["12/8/2025", "11/8/2025", "10/8/2025", "12/8/2025"][index];
    rows.set(
      n,
      new Map([
        ["B", cell("B", n, ids[index])],
        ["C", cell("C", n, names[index])],
        ["D", cell("D", n, "15/6")],
        ["E", cell("E", n, "(Nil)")],
        ["F", cell("F", n, "27/8/2025")],
        ["G", cell("G", n, due)],
        ["H", cell("H", n, "(Nil)")],
      ]),
    );
  }
  return { name: "Anonymous fixture", rows };
}
type Fixture = {
  actor: AuthenticatedActor & { userId: string };
  batchId: string;
  companyIds: string[];
  externalIds: string[];
  importRepository: ReturnType<typeof createNarImportRepository>;
  applyRepository: ReturnType<typeof createNarImportApplyRepository>;
  bulkRepository: ReturnType<typeof createBulkOperationRepository>;
  cleanup: () => Promise<void>;
};
async function fixture(): Promise<Fixture> {
  if (!sql) throw new Error("TEST_DATABASE_URL is required");
  const [admin] = await sql<{ auth_user_id: string; user_id: string; team_id: string | null }[]>`
    select sp.auth_user_id,sp.user_id,sp.team_id from staff_profiles sp
    join users u on u.id = sp.user_id and u.active
    where sp.role = 'Admin' and sp.active limit 1`;
  const [owner] = await sql<{ id: string; team_id: string }[]>`
    select u.id,sp.team_id from users u join staff_profiles sp on sp.user_id = u.id
    where u.active and sp.active and sp.team_id is not null limit 1`;
  if (!admin || !owner) throw new Error("Seeded Admin and owner are required");
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const companyIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const externalIds = [0, 1, 2, 3].map((n) => `T11-${nonce}-${n}`);
  const names = ["Fixture New Ltd", "Fixture Update Ltd", "Fixture Filed Ltd", "Unmapped Ltd"];
  for (let index = 0; index < companyIds.length; index += 1) {
    await sql`insert into companies
      (id,company_name,cr_number,br_number,incorporation_date,annual_return_basis_date,
        registered_office,company_secretary,assigned_owner_id,assigned_team_id,data_origin)
      values (${companyIds[index]},${names[index]},${`CR-T11-${nonce}-${index}`},
        ${`BR-T11-${nonce}-${index}`},'2020-06-15','2020-06-15',
        'Fixture address','Fixture secretary',${owner.id},${owner.team_id},'fixture')`;
  }
  await sql`insert into annual_return_cases
    (company_id,return_year,made_up_date,filing_due_date,current_status,owner_id)
    values (${companyIds[1]},2025,'2025-06-15','2025-08-10','Upcoming',${owner.id}),
      (${companyIds[2]},2025,'2025-06-15','2025-08-10','Filed',${owner.id})`;
  const importRepository = createNarImportRepository({ sql });
  const applyRepository = createNarImportApplyRepository({ sql });
  const bulkRepository = createBulkOperationRepository({ sql });
  const hash = nonce.repeat(2);
  const staged = await importRepository.stageBatch({
    sourceFileName: "anonymous-t11.xlsx",
    sourceSha256: hash,
    sourceSizeBytes: 512,
    parserVersion: "t11-fixture",
    returnYear: 2025,
    createdBy: admin.user_id,
    read: readNarSheet(sheet(externalIds, names), false),
  });
  for (let index = 0; index < 3; index += 1) {
    await importRepository.mapExternalReference({
      externalClientId: externalIds[index],
      companyId: companyIds[index],
      mappedBy: admin.user_id,
    });
  }
  return {
    actor: {
      authUserId: admin.auth_user_id,
      userId: admin.user_id,
      role: "Admin",
      teamId: admin.team_id,
      active: true,
    },
    batchId: staged.batch.id,
    companyIds,
    externalIds,
    importRepository,
    applyRepository,
    bulkRepository,
    cleanup: async () => {
      await sql`delete from bulk_operations where preview_id in
        (select id from bulk_previews where parameters->>'approvalId' in
          (select id::text from nar_import_approvals where batch_id = ${staged.batch.id}))`;
      await sql`delete from bulk_previews where parameters->>'approvalId' in
        (select id::text from nar_import_approvals where batch_id = ${staged.batch.id})`;
      await sql`delete from nar_import_payment_observations where source_row_id in
        (select id from nar_import_rows where batch_id = ${staged.batch.id})`;
      await sql`delete from nar_import_apply_events where approval_id in
        (select id from nar_import_approvals where batch_id = ${staged.batch.id})`;
      await sql`delete from nar_import_approvals where batch_id = ${staged.batch.id}`;
      await sql`delete from nar_import_previews where batch_id = ${staged.batch.id}`;
      await sql`delete from nar_import_batches where id = ${staged.batch.id}`;
      await sql`delete from work_items where annual_return_case_id in
        (select id from annual_return_cases where company_id = any(${companyIds}::uuid[]))`;
      await sql`delete from annual_return_audit_events where company_id = any(${companyIds}::uuid[])`;
      await sql`delete from timeline_events where company_id = any(${companyIds}::uuid[])`;
      await sql`delete from annual_return_cases where company_id = any(${companyIds}::uuid[])`;
      await sql`delete from company_external_references where company_id = any(${companyIds}::uuid[])`;
      await sql`delete from companies where id = any(${companyIds}::uuid[])`;
    },
  };
}

describe.skipIf(!databaseUrl)("T11 approved import transaction", () => {
  afterAll(async () => {
    await sql?.end();
  });
  it("t27_scenario_2 approves and queues at least 1001 preview rows for resumable background apply", async () => {
    if (!sql) throw new Error("TEST_DATABASE_URL is required");
    const fx = await fixture();
    const targetRows = process.env.RUN_T27_IMPORT_SCALE === "1" ? 10_000 : 1_001;
    try {
      const [source] = await sql<
        {
          raw: unknown;
          parsed: unknown;
          issues: unknown;
          source_issues: unknown;
        }[]
      >`
        select raw,parsed,issues,source_issues from nar_import_rows
        where batch_id = ${fx.batchId} and row_number = 5`;
      await sql`
        insert into nar_import_rows (
          batch_id,row_number,external_client_id,company_name,raw,parsed,issues,
          source_issues,disposition,matched_company_id,matched_case_id
        )
        select ${fx.batchId}, n,
          'T27-UNMAPPED-' || ${fx.batchId}::text || '-' || n::text,
          'Unmapped scale fixture',${sql.json(source.raw as never)},
          ${sql.json(source.parsed as never)},${sql.json(source.issues as never)},
          ${sql.json(source.source_issues as never)},'needs_company_mapping',null,null
        from generate_series(6,${targetRows + 1}::integer) n
      `;
      await sql`update nar_import_batches set row_count = ${targetRows} where id = ${fx.batchId}`;
      const batch = await fx.importRepository.getBatch(fx.batchId);
      const preview = await fx.importRepository.revalidate(
        fx.batchId,
        fx.actor.userId,
        batch!.revision,
      );
      expect(preview.totalRows).toBe(targetRows);
      expect(preview.rows).toHaveLength(50);
      const next = await fx.importRepository.listPreviewPage({
        previewId: preview.id,
        actorId: fx.actor.userId,
        offset: 50,
        limit: 50,
      });
      expect(next.rows).toHaveLength(50);
      expect(next.nextOffset).toBe(100);
      await expect(
        fx.importRepository.listPreviewPage({
          previewId: preview.id,
          actorId: crypto.randomUUID(),
          offset: 0,
          limit: 50,
        }),
      ).rejects.toThrow("Import preview not found.");
      const approval = await fx.applyRepository.approve(fx.actor, {
        previewId: preview.id,
        previewHash: preview.previewHash,
      });
      const operation = await fx.bulkRepository.commitImportApproval(fx.actor, {
        approvalId: approval.id,
        idempotencyKey: crypto.randomUUID(),
      });
      const [count] = await sql<{ count: string }[]>`
        select count(*) from bulk_operation_items where operation_id = ${operation.id}`;
      expect(Number(count.count)).toBe(targetRows);
      const partial = await fx.bulkRepository.runBatch(operation.id, { limit: 1 });
      expect(partial.counts.succeeded + partial.counts.skipped).toBe(1);
      const resumed = await fx.bulkRepository.runBatch(operation.id, { limit: 100 });
      expect(resumed.counts.succeeded + resumed.counts.skipped).toBe(3);
    } finally {
      await fx.cleanup();
    }
  }, 180_000);

  it("t11_database_replay_and_resume keeps one case and observation per row with auditable partial results", async () => {
    if (!sql) throw new Error("TEST_DATABASE_URL is required");
    const fx = await fixture();
    try {
      const batch = await fx.importRepository.getBatch(fx.batchId);
      const preview = await fx.importRepository.revalidate(
        fx.batchId,
        fx.actor.userId,
        batch!.revision,
      );
      expect(preview.rows.map((row) => row.disposition)).toEqual([
        "new",
        "updated",
        "unchanged",
        "needsCompanyMapping",
      ]);
      const approval = await fx.applyRepository.approve(fx.actor, {
        previewId: preview.id,
        previewHash: preview.previewHash,
      });
      const operation = await fx.bulkRepository.commitImportApproval(fx.actor, {
        approvalId: approval.id,
        idempotencyKey: crypto.randomUUID(),
      });
      const replay = await fx.bulkRepository.commitImportApproval(fx.actor, {
        approvalId: approval.id,
        idempotencyKey: crypto.randomUUID(),
      });
      expect(replay.id).toBe(operation.id);
      let failOnce = true;
      const afterCrash = await fx.bulkRepository.runBatch(operation.id, {
        limit: 1,
        afterDomainWrite: () => {
          if (failOnce) {
            failOnce = false;
            throw new Error("Fixture crash");
          }
        },
      });
      expect(afterCrash.counts.failed).toBe(1);
      const completed = await fx.bulkRepository.runBatch(operation.id, { limit: 100 });
      expect(completed.state).toBe("completed-with-errors");
      expect(completed.counts.succeeded + completed.counts.skipped).toBe(3);
      expect(completed.counts.conflict).toBe(1);
      const cases = await sql<
        { company_id: string; current_status: string; filing_due_date: string }[]
      >`
        select company_id,current_status,filing_due_date::text filing_due_date
        from annual_return_cases where company_id = any(${fx.companyIds}::uuid[])`;
      expect(cases).toHaveLength(3);
      expect(cases.find((row) => row.company_id === fx.companyIds[0])?.current_status).toBe(
        "Upcoming",
      );
      expect(cases.find((row) => row.company_id === fx.companyIds[1])?.filing_due_date).toBe(
        "2025-08-11",
      );
      expect(cases.find((row) => row.company_id === fx.companyIds[2])).toMatchObject({
        current_status: "Filed",
        filing_due_date: "2025-08-10",
      });
      const [observations] = await sql<{ count: string }[]>`
        select count(*) from nar_import_payment_observations where company_id = any(${fx.companyIds}::uuid[])`;
      expect(Number(observations.count)).toBe(3);
      const [payments] = await sql<{ count: string }[]>`
        select count(*) from payments where company_id = any(${fx.companyIds}::uuid[])`;
      expect(Number(payments.count)).toBe(0);
      const csv = bulkOperationCsv(completed);
      expect(csv).toContain(preview.rows[0].rowId);
      expect(csv).toContain(completed.items.find((item) => item.state === "succeeded")!.auditRef!);
      expect((await fx.bulkRepository.runBatch(operation.id, { limit: 100 })).items).toEqual(
        completed.items,
      );
    } finally {
      await fx.cleanup();
    }
  });

  it("t11_database_changed_case_conflicts then new validation may approve remaining rows", async () => {
    if (!sql) throw new Error("TEST_DATABASE_URL is required");
    const fx = await fixture();
    try {
      const batch = await fx.importRepository.getBatch(fx.batchId);
      const preview = await fx.importRepository.revalidate(
        fx.batchId,
        fx.actor.userId,
        batch!.revision,
      );
      const approval = await fx.applyRepository.approve(fx.actor, {
        previewId: preview.id,
        previewHash: preview.previewHash,
      });
      await sql`update annual_return_cases set filing_due_date = '2025-08-09',updated_at = now()
        where company_id = ${fx.companyIds[1]} and return_year = 2025`;
      const operation = await fx.bulkRepository.commitImportApproval(fx.actor, {
        approvalId: approval.id,
        idempotencyKey: crypto.randomUUID(),
      });
      const result = await fx.bulkRepository.runBatch(operation.id, { limit: 100 });
      expect(
        result.items.find((item) => item.resourceId === preview.rows[1].rowId)?.reasonCode,
      ).toBe("CASE_CHANGED_AFTER_PREVIEW");
      const failedBatch = await fx.importRepository.getBatch(fx.batchId);
      expect(failedBatch?.status).toBe("failed");
      const refreshed = await fx.importRepository.revalidate(
        fx.batchId,
        fx.actor.userId,
        failedBatch!.revision,
      );
      expect(refreshed.revision).toBeGreaterThan(preview.revision);
      const nextApproval = await fx.applyRepository.approve(fx.actor, {
        previewId: refreshed.id,
        previewHash: refreshed.previewHash,
      });
      const nextOperation = await fx.bulkRepository.commitImportApproval(fx.actor, {
        approvalId: nextApproval.id,
        idempotencyKey: crypto.randomUUID(),
      });
      const resolved = await fx.bulkRepository.runBatch(nextOperation.id, { limit: 100 });
      expect(resolved.items.find((item) => item.resourceId === preview.rows[1].rowId)?.state).toBe(
        "succeeded",
      );
      const [case_] = await sql<{ filing_due_date: string }[]>`
        select filing_due_date::text filing_due_date from annual_return_cases
        where company_id = ${fx.companyIds[1]} and return_year = 2025`;
      expect(case_.filing_due_date).toBe("2025-08-11");
    } finally {
      await fx.cleanup();
    }
  });

  it("t11_database_revoked_admin and cancellation never apply a queued row", async () => {
    if (!sql) throw new Error("TEST_DATABASE_URL is required");
    const fx = await fixture();
    let revoked = false;
    try {
      const batch = await fx.importRepository.getBatch(fx.batchId);
      const preview = await fx.importRepository.revalidate(
        fx.batchId,
        fx.actor.userId,
        batch!.revision,
      );
      const approval = await fx.applyRepository.approve(fx.actor, {
        previewId: preview.id,
        previewHash: preview.previewHash,
      });
      const operation = await fx.bulkRepository.commitImportApproval(fx.actor, {
        approvalId: approval.id,
        idempotencyKey: crypto.randomUUID(),
      });
      await sql`update staff_profiles set active = false where user_id = ${fx.actor.userId}`;
      revoked = true;
      const denied = await fx.bulkRepository.runBatch(operation.id, { limit: 100 });
      expect(denied.counts.forbidden).toBe(3);
      const [unwritten] = await sql<{ count: string }[]>`
        select count(*) from annual_return_cases where company_id = ${fx.companyIds[0]}
          and return_year = 2025`;
      expect(Number(unwritten.count)).toBe(0);
      await sql`update staff_profiles set active = true where user_id = ${fx.actor.userId}`;
      revoked = false;
      const fresh = await fx.importRepository.getBatch(fx.batchId);
      const retryPreview = await fx.importRepository.revalidate(
        fx.batchId,
        fx.actor.userId,
        fresh!.revision,
      );
      const retryApproval = await fx.applyRepository.approve(fx.actor, {
        previewId: retryPreview.id,
        previewHash: retryPreview.previewHash,
      });
      const retry = await fx.bulkRepository.commitImportApproval(fx.actor, {
        approvalId: retryApproval.id,
        idempotencyKey: crypto.randomUUID(),
      });
      await fx.bulkRepository.cancel(fx.actor, retry.id);
      const cancelled = await fx.bulkRepository.runBatch(retry.id, { limit: 100 });
      expect(cancelled.state).toBe("cancelled");
      const [stillUnwritten] = await sql<{ count: string }[]>`
        select count(*) from annual_return_cases where company_id = ${fx.companyIds[0]}
          and return_year = 2025`;
      expect(Number(stillUnwritten.count)).toBe(0);
    } finally {
      if (revoked)
        await sql`update staff_profiles set active = true where user_id = ${fx.actor.userId}`;
      await fx.cleanup();
    }
  });

  it("t11_database_cancelled_prior_operation cannot change a newly approved batch", async () => {
    if (!sql) throw new Error("TEST_DATABASE_URL is required");
    const fx = await fixture();
    try {
      const initial = await fx.importRepository.getBatch(fx.batchId);
      const preview = await fx.importRepository.revalidate(
        fx.batchId,
        fx.actor.userId,
        initial!.revision,
      );
      const approval = await fx.applyRepository.approve(fx.actor, {
        previewId: preview.id,
        previewHash: preview.previewHash,
      });
      const first = await fx.bulkRepository.commitImportApproval(fx.actor, {
        approvalId: approval.id,
        idempotencyKey: crypto.randomUUID(),
      });
      await fx.bulkRepository.cancel(fx.actor, first.id);
      const failed = await fx.importRepository.getBatch(fx.batchId);
      const fresh = await fx.importRepository.revalidate(
        fx.batchId,
        fx.actor.userId,
        failed!.revision,
      );
      const newApproval = await fx.applyRepository.approve(fx.actor, {
        previewId: fresh.id,
        previewHash: fresh.previewHash,
      });
      const second = await fx.bulkRepository.commitImportApproval(fx.actor, {
        approvalId: newApproval.id,
        idempotencyKey: crypto.randomUUID(),
      });
      expect(second.state).toBe("queued");
      await fx.bulkRepository.runBatch(first.id, { limit: 1 });
      expect((await fx.importRepository.getBatch(fx.batchId))?.status).toBe("applying");
    } finally {
      await fx.cleanup();
    }
  });

  it("t11_database_duplicate_company_year is blocked before any case write", async () => {
    if (!sql) throw new Error("TEST_DATABASE_URL is required");
    const fx = await fixture();
    try {
      await fx.importRepository.mapExternalReference({
        externalClientId: fx.externalIds[3],
        companyId: fx.companyIds[0],
        mappedBy: fx.actor.userId,
      });
      const batch = await fx.importRepository.getBatch(fx.batchId);
      const preview = await fx.importRepository.revalidate(
        fx.batchId,
        fx.actor.userId,
        batch!.revision,
      );
      await expect(
        fx.applyRepository.approve(fx.actor, {
          previewId: preview.id,
          previewHash: preview.previewHash,
        }),
      ).rejects.toThrow(/same company and return year/i);
      const [cases] = await sql<{ count: string }[]>`
        select count(*) from annual_return_cases where company_id = ${fx.companyIds[0]}
          and return_year = 2025`;
      expect(Number(cases.count)).toBe(0);
    } finally {
      await fx.cleanup();
    }
  });
});
