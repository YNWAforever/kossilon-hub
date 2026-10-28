import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, closeSync, openSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { getCurrentTest } from "@vitest/runner";
import { describe, expect, it, onTestFinished } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import { createSqlClient } from "@/server/db/client";
import { guardSqlTestLifetime } from "@/test/sql-test-lifetime";
import { createNarApplyRepository, runNarApplyChunk, type NarRowInputs } from "./apply";
import { createNarImportRepository } from "./repository";
import { getNarImportBatchReviewForActor, stageNarImportForActor } from "./server-fns";
import { buildMixedNarWorkbook } from "./mixed-xlsx-fixture";
import { readXlsxWorkbook } from "./xlsx/workbook";
import { readNarSheet } from "./mapping";

// Explicit operator opt-in only after a fresh disposable target identity gate.
// Collecting/skipping this file constructs no client and writes no artifact.
const databaseUrl = process.env.TEST_DATABASE_URL;
const runId = process.env.KOSSILON_NAR_XLSX_RUN_ID;
const eventsPath = process.env.KOSSILON_NAR_XLSX_EVENTS_PATH;
const workbookPath = process.env.KOSSILON_NAR_XLSX_WORKBOOK_PATH;
function ownedArtifact(path: string) {
  const absolute = resolve(path),
    local = relative(resolve("docs/audit-remediation"), absolute);
  if (
    local.startsWith("..") ||
    isAbsolute(local) ||
    realpathSync(dirname(absolute)) !== dirname(absolute)
  )
    throw new Error(
      "Fresh artifacts must be inside the run-owned audit directory without redirection.",
    );
  return absolute;
}
describe.skipIf(!databaseUrl || !runId)(
  "R26.4 mixed 500-row XLSX through real repositories",
  () => {
    it("parses actual bytes, refuses all duplicate/invalid rows and resumes only eligible rows", async () => {
      if (
        !databaseUrl ||
        !runId ||
        !/^cosec-[a-z0-9-]{8,100}$/.test(runId) ||
        !eventsPath ||
        !workbookPath
      )
        throw new Error(
          "Verified disposable target, unique run ID and fresh artifact paths required.",
        );
      const context = getCurrentTest()?.context;
      if (!context) throw new Error("A running test lifetime is required.");
      const pending = scenario(
        databaseUrl,
        runId,
        ownedArtifact(eventsPath),
        ownedArtifact(workbookPath),
        context.signal,
      );
      onTestFinished(async () => {
        try {
          await pending;
        } catch (error) {
          if (!context.signal.aborted || error !== context.signal.reason) throw error;
        }
      });
      await pending;
    }, 180_000);
  },
);

async function scenario(
  url: string,
  tag: string,
  eventFile: string,
  binaryFile: string,
  signal: AbortSignal,
) {
  const fd = openSync(eventFile, "wx");
  const record = (phase: string, data: object) =>
    appendFileSync(fd, JSON.stringify({ runId: tag, phase, ...data }) + "\n");
  // Pure fixture generation and actual ZIP parsing precede any fixture DB write.
  let raw: ReturnType<typeof createSqlClient> | undefined;
  let reader: ReturnType<typeof createSqlClient> | undefined;
  const teamId = randomUUID(),
    templateId = randomUUID(),
    userIds = [randomUUID(), randomUUID(), randomUUID()];
  const [adminId, staffId, otherId] = userIds;
  const actor = (userId: string, role: "Admin" | "Staff"): AuthenticatedActor => ({
    userId,
    authUserId: `${tag}:${userId}`,
    role,
    teamId,
    active: true,
  });
  const admin = actor(adminId, "Admin"),
    staff = actor(staffId, "Staff"),
    other = actor(otherId, "Admin");
  const companies: string[] = [];
  try {
    const fixture = await buildMixedNarWorkbook(tag);
    writeFileSync(binaryFile, fixture.bytes, { flag: "wx" });
    const sha256 = createHash("sha256").update(fixture.bytes).digest("hex");
    const workbook = await readXlsxWorkbook(fixture.bytes);
    const sheet = workbook.sheet("8.2025");
    expect(sheet).toBeDefined();
    const parsed = readNarSheet(sheet!, workbook.date1904);
    expect(parsed.rows).toHaveLength(500);
    expect(parsed.skippedRowNumbers).toEqual([]);
    expect(parsed.rows.filter((r) => r.issues.some((i) => i.severity === "blocking"))).toHaveLength(
      150,
    );
    record("workbook", {
      file: binaryFile,
      sha256,
      bytes: fixture.bytes.length,
      parserVersion: workbook.parserVersion,
      rowCount: parsed.rows.length,
      validRowNumbers: fixture.validRowNumbers,
      duplicateRowNumbers: fixture.duplicateRowNumbers,
      invalidRowNumbers: fixture.invalidRowNumbers,
      sourceRows: parsed.rows.map((r) => ({
        rowNumber: r.rowNumber,
        externalClientId: r.externalClientId,
        raw: r.raw,
        issues: r.issues,
      })),
    });
    companies.push(...fixture.companyKeys.map(() => randomUUID()));
    const companyByKey = new Map(fixture.companyKeys.map((key, index) => [key, companies[index]]));
    record("planned-ids", {
      teamId,
      templateId,
      userIds,
      companyMappings: Object.fromEntries(companyByKey),
    });
    raw = createSqlClient(url, { max: 4 });
    const sql = guardSqlTestLifetime(raw, () => signal);
    await sql.begin(async (tx) => {
      await tx`insert into teams(id,name) values(${teamId},${tag + ":mixed-xlsx"})`;
      for (const identity of [admin, staff, other]) {
        await tx`insert into users(id,name,email,role,team_id,active) values(${identity.userId!},'Synthetic XLSX reviewer',${identity.userId + "@example.test"},${identity.role},${teamId},true)`;
        await tx`insert into staff_profiles(user_id,auth_user_id,role,team_id,active) values(${identity.userId!},${identity.authUserId},${identity.role},${teamId},true)`;
      }
      await tx`insert into checklist_templates(id,name,service_type,documents) values(${templateId},${tag + ":mixed"},'Annual Return — Private Ltd',${tx.json([{ label: "NAR1", required: true, daysBeforeDue: 7 }])})`;
      await tx`insert into companies ${tx(companies.map((id, i) => ({ id, company_name: `Synthetic XLSX company ${i}`, cr_number: id, br_number: id, incorporation_date: "2020-01-01", annual_return_basis_date: "2026-01-01", registered_office: "Synthetic office", company_secretary: "Synthetic secretary", status: "active", assigned_owner_id: staffId, assigned_team_id: teamId, data_origin: "client" })))}`;
      await tx`insert into company_external_references ${tx(fixture.companyKeys.map((key) => ({ source_system: "nar-monthly-workbook", external_client_id: key, company_id: companyByKey.get(key)!, mapped_by: adminId })))}`;
    });
    const imports = createNarImportRepository({ sql });
    const request = {
      fileName: `${tag}-mixed-500.xlsx`,
      bodyBase64: Buffer.from(fixture.bytes).toString("base64"),
      sheetName: "8.2025",
      returnYear: 2025,
    };
    await expect(stageNarImportForActor(staff, request, { repository: imports })).rejects.toThrow(
      /Admin/,
    );
    const staged = await stageNarImportForActor(admin, request, { repository: imports });
    expect(staged.reused).toBe(false);
    expect(staged.batch).toMatchObject({
      rowCount: 500,
      sourceSha256: sha256,
      sourceSizeBytes: fixture.bytes.length,
      parserVersion: workbook.parserVersion,
      returnYear: 2025,
    });
    expect(await stageNarImportForActor(admin, request, { repository: imports })).toMatchObject({
      reused: true,
      batch: { id: staged.batch.id },
    });
    const review = await getNarImportBatchReviewForActor(
      admin,
      { batchId: staged.batch.id },
      { repository: imports },
    );
    expect(review.counts).toMatchObject({ new: 350, invalid: 150, needsCompanyMapping: 0 });
    expect(review.rows).toHaveLength(500);
    for (const row of review.rows)
      expect(row.raw).toEqual(parsed.rows.find((r) => r.rowNumber === row.rowNumber)!.raw);
    const validNumbers = new Set(fixture.validRowNumbers);
    const validRows = review.rows.filter((r) => validNumbers.has(r.rowNumber));
    const blockedRows = review.rows.filter((r) => !validNumbers.has(r.rowNumber));
    const rowIds = review.rows.map((r) => r.id);
    const inputs: Record<string, NarRowInputs> = Object.fromEntries(
      rowIds.map((id) => [
        id,
        {
          templateId,
          ownerId: staffId,
          feeAmount: 1200,
          madeUpDate: "2025-01-01",
          acknowledgeDueDifference: true,
          acknowledgeSourceIssues: true,
        },
      ]),
    );
    record("staged-ids", {
      batchId: staged.batch.id,
      rows: review.rows.map((r) => ({
        id: r.id,
        rowNumber: r.rowNumber,
        externalClientId: r.externalClientId,
        disposition: r.disposition,
      })),
      counts: review.counts,
    });
    const repo = createNarApplyRepository({ sql });
    const preview = await repo.preview(admin, { batchId: staged.batch.id, rowIds, inputs });
    expect(preview).toMatchObject({ selected: 500, eligibleCount: 350 });
    expect(
      new Set(
        preview.rows.filter((r) => r.conflicts.includes("source_row_invalid")).map((r) => r.rowId),
      ),
    ).toEqual(new Set(blockedRows.map((r) => r.id)));
    expect(
      await sql`select id from annual_return_cases where company_id=any(${companies}::uuid[])`,
    ).toHaveLength(0);
    record("preview", {
      previewId: preview.previewId,
      selected: preview.selected,
      eligibleCount: preview.eligibleCount,
      rows: preview.rows.map((r) => ({
        rowId: r.rowId,
        conflicts: r.conflicts,
        requiredInputs: r.requiredInputs,
        command: r.command,
      })),
    });
    const command = { previewId: preview.previewId, idempotencyKey: `${tag}:initial` };
    await expect(repo.execute({ ...staff, role: "Admin" }, command)).rejects.toThrow(
      /current verified Admin/,
    );
    const [job, duplicate] = await Promise.all([
      repo.execute(admin, command),
      repo.execute(admin, command),
    ]);
    expect(duplicate).toEqual(job);
    await expect(repo.getJob(other, job.jobId)).rejects.toThrow(/own NAR job/);
    record("initial-job", job);
    await expect(
      runNarApplyChunk({
        repository: repo,
        actor: admin,
        jobId: job.jobId,
        afterCommit: (n) => {
          if (n === 37) throw new Error("Synthetic post-commit interruption at 37");
        },
      }),
    ).rejects.toThrow(/interruption at 37/);
    reader = createSqlClient(url, { max: 2 });
    const readSql = guardSqlTestLifetime(reader, () => signal);
    const reopened = createNarApplyRepository({ sql: readSql });
    const interrupted = await reopened.getJob(admin, job.jobId);
    expect(interrupted.counts).toEqual({
      pending: 313,
      applied: 37,
      conflict: 150,
      failed: 0,
      cancelled: 0,
    });
    expect(await reopened.cancel(admin, job.jobId)).toEqual({ cancelled: 313 });
    expect(await reopened.cancel(admin, job.jobId)).toEqual({ cancelled: 0 });
    expect(await reopened.execute(admin, command)).toEqual(job);
    expect(await runNarApplyChunk({ repository: repo, actor: admin, jobId: job.jobId })).toEqual({
      processed: 0,
    });
    const cancelled = await reopened.getJob(admin, job.jobId);
    expect(cancelled.state).toBe("cancelled");
    record("cancelled", { jobId: job.jobId, counts: cancelled.counts, rows: cancelled.rows });
    const remainingIds = cancelled.rows.filter((r) => r.state === "cancelled").map((r) => r.row_id);
    expect(remainingIds).toHaveLength(313);
    const retryPreview = await reopened.preview(admin, {
      batchId: staged.batch.id,
      rowIds: remainingIds,
      inputs,
    });
    expect(retryPreview).toMatchObject({ selected: 313, eligibleCount: 313 });
    await expect(
      reopened.execute(admin, { ...command, previewId: retryPreview.previewId }),
    ).rejects.toThrow(/Idempotency payload conflict/);
    const retryCommand = { previewId: retryPreview.previewId, idempotencyKey: `tag:${tag}:retry` };
    const [retryJob, sameRetry] = await Promise.all([
      repo.execute(admin, retryCommand),
      reopened.execute(admin, retryCommand),
    ]);
    expect(sameRetry).toEqual(retryJob);
    const processed: number[] = [];
    for (let n = 0; n < 4; n++)
      processed.push(
        (await runNarApplyChunk({ repository: reopened, actor: admin, jobId: retryJob.jobId }))
          .processed,
      );
    expect(processed).toEqual([100, 100, 100, 13]);
    expect(
      await runNarApplyChunk({ repository: repo, actor: admin, jobId: retryJob.jobId }),
    ).toEqual({ processed: 0 });
    expect(await reopened.getJob(admin, retryJob.jobId)).toMatchObject({
      state: "completed",
      selected: 313,
      unselected: 187,
      counts: { applied: 313, pending: 0, conflict: 0, failed: 0, cancelled: 0 },
    });
    record("retry", { jobId: retryJob.jobId, previewId: retryPreview.previewId, processed });
    // Acknowledging every source attention cannot authorize a blocking row.
    const deniedPreview = await reopened.preview(admin, {
      batchId: staged.batch.id,
      rowIds: blockedRows.map((r) => r.id),
      inputs,
    });
    expect(deniedPreview.eligibleCount).toBe(0);
    const deniedJob = await reopened.execute(admin, {
      previewId: deniedPreview.previewId,
      idempotencyKey: `${tag}:blocked-only`,
    });
    expect(
      await runNarApplyChunk({ repository: reopened, actor: admin, jobId: deniedJob.jobId }),
    ).toEqual({ processed: 0 });
    expect(await reopened.getJob(admin, deniedJob.jobId)).toMatchObject({
      state: "partial",
      counts: { applied: 0, conflict: 150, pending: 0, failed: 0, cancelled: 0 },
    });
    const facts =
      await readSql`select a.id,a.company_id,a.filing_due_date::text due,a.import_origin,p.id payment_id,p.status,p.invoice_number,p.amount,p.paid_at,w.id work_id from annual_return_cases a join payments p on p.case_id=a.id join work_items w on w.annual_return_case_id=a.id where a.company_id=any(${companies}::uuid[])`;
    expect(facts).toHaveLength(350);
    for (const key of ["id", "company_id", "payment_id", "work_id"])
      expect(new Set(facts.map((r) => r[key])).size).toBe(350);
    const expectedCompanies = validRows.map((r) => companyByKey.get(r.externalClientId));
    expect(new Set(facts.map((r) => r.company_id))).toEqual(new Set(expectedCompanies));
    expect(
      facts.every(
        (r) =>
          r.status === "Payment pending" &&
          r.paid_at === null &&
          r.amount === 1200 &&
          r.invoice_number === "SHARED-XLSX-INVOICE" &&
          r.due === "2025-02-15" &&
          r.import_origin === "historical",
      ),
    ).toBe(true);
    const journals =
      await readSql`select id,row_id,case_id,job_id,command from nar_apply_journal where batch_id=${staged.batch.id}`;
    expect(journals).toHaveLength(350);
    expect(new Set(journals.map((r) => r.row_id))).toEqual(new Set(validRows.map((r) => r.id)));
    const finalImports = createNarImportRepository({ sql: readSql });
    const finalRows = await finalImports.listRows(staged.batch.id);
    expect(finalRows.filter((r) => r.appliedAt !== null)).toHaveLength(350);
    expect(
      finalRows
        .filter((r) => !validNumbers.has(r.rowNumber))
        .every((r) => r.appliedAt === null && r.appliedCaseId === null),
    ).toBe(true);
    expect(await finalImports.getBatch(staged.batch.id)).toMatchObject({
      rowCount: 500,
      status: "pending_review",
      appliedAt: null,
      sourceSha256: sha256,
      parserVersion: workbook.parserVersion,
    });
    for (const row of finalRows) {
      expect(row.raw).toEqual(parsed.rows.find((r) => r.rowNumber === row.rowNumber)!.raw);
      expect(row.parsed).toMatchObject({
        paymentReceived: { kind: "text", iso: "2025-03-01", raw: "1/3/2025 (credit note)" },
      });
    }
    expect(
      await stageNarImportForActor(admin, request, { repository: finalImports }),
    ).toMatchObject({ reused: true, batch: { id: staged.batch.id, status: "pending_review" } });
    expect((await reopened.getJob(admin, job.jobId)).counts).toEqual(cancelled.counts);
    const [outbox] =
      await readSql`select count(*)::int n from notification_outbox where company_id=any(${companies}::uuid[])`;
    expect(outbox.n).toBe(0);
    record("readback", {
      batchId: staged.batch.id,
      sha256,
      facts,
      journals,
      rows: finalRows.map((r) => ({
        id: r.id,
        rowNumber: r.rowNumber,
        appliedCaseId: r.appliedCaseId,
        appliedAt: r.appliedAt,
      })),
      blockedOnlyJobId: deniedJob.jobId,
      batchStatus: "pending_review",
      outboxCount: outbox.n,
    });
  } finally {
    try {
      await reader?.end();
      if (raw)
        await raw.begin(async (tx) => {
          const cases =
            await tx`select id from annual_return_cases where company_id=any(${companies}::uuid[])`;
          const batches = await tx`select id from nar_import_batches where created_by=${adminId}`;
          const caseIds = cases.map((r) => r.id),
            batchIds = batches.map((r) => r.id);
          const jobs =
            await tx`select id from nar_apply_jobs where batch_id=any(${batchIds}::uuid[])`;
          const jobIds = jobs.map((r) => r.id);
          const descendants =
            await tx`select 'payment' kind,id from payments where company_id=any(${companies}::uuid[]) union all select 'work',id from work_items where company_id=any(${companies}::uuid[]) union all select 'checklist',id from annual_return_checklist_items where case_id=any(${caseIds}::uuid[]) union all select 'timeline',id from timeline_events where company_id=any(${companies}::uuid[]) union all select 'audit',id from annual_return_audit_events where case_id=any(${caseIds}::uuid[])`;
          record("cleanup-ids", {
            companyIds: companies,
            userIds,
            caseIds,
            batchIds,
            jobIds,
            descendants,
          });
          await tx`delete from notification_outbox where company_id=any(${companies}::uuid[])`;
          await tx`delete from nar_apply_journal where batch_id=any(${batchIds}::uuid[])`;
          await tx`delete from nar_apply_job_items where job_id=any(${jobIds}::uuid[])`;
          await tx`delete from nar_apply_jobs where id=any(${jobIds}::uuid[])`;
          await tx`delete from nar_apply_previews where actor_user_id=${adminId}`;
          await tx`delete from nar_batch_review_events where batch_id=any(${batchIds}::uuid[])`;
          await tx`delete from nar_import_batches where id=any(${batchIds}::uuid[])`;
          await tx`delete from nar_mapping_events where actor_user_id=${adminId}`;
          await tx`delete from assignment_events where work_item_id in(select id from work_items where company_id=any(${companies}::uuid[]))`;
          await tx`delete from work_items where company_id=any(${companies}::uuid[])`;
          await tx`delete from annual_return_audit_events where case_id=any(${caseIds}::uuid[])`;
          await tx`delete from timeline_events where company_id=any(${companies}::uuid[])`;
          await tx`delete from annual_return_cases where id=any(${caseIds}::uuid[])`;
          await tx`delete from companies where id=any(${companies}::uuid[])`;
          await tx`delete from checklist_templates where id=${templateId}`;
          await tx`delete from staff_access_events where actor_user_id=any(${userIds}::uuid[])`;
          await tx`delete from staff_profiles where user_id=any(${userIds}::uuid[])`;
          await tx`delete from users where id=any(${userIds}::uuid[])`;
          await tx`delete from teams where id=${teamId}`;
          const [remaining] =
            await tx`select (select count(*) from companies where id=any(${companies}::uuid[]))::int companies,(select count(*) from annual_return_cases where id=any(${caseIds}::uuid[]))::int cases,(select count(*) from nar_import_batches where id=any(${batchIds}::uuid[]))::int batches,(select count(*) from nar_apply_jobs where id=any(${jobIds}::uuid[]))::int jobs,(select count(*) from users where id=any(${userIds}::uuid[]))::int users,(select count(*) from teams where id=${teamId})::int teams`;
          expect(remaining).toEqual({
            companies: 0,
            cases: 0,
            batches: 0,
            jobs: 0,
            users: 0,
            teams: 0,
          });
          record("cleanup-readback", remaining);
        });
    } finally {
      try {
        await raw?.end();
      } finally {
        closeSync(fd);
      }
    }
  }
}
