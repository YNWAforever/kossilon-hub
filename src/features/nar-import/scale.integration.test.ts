import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, closeSync, openSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { getCurrentTest } from "@vitest/runner";
import { describe, expect, it, onTestFinished } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import { createSqlClient } from "@/server/db/client";
import { guardSqlTestLifetime } from "@/test/sql-test-lifetime";
import { createNarImportRepository, type StageBatchInput } from "./repository";
import { createNarApplyRepository, runNarApplyChunk, type NarRowInputs } from "./apply";

// Opt in only AFTER the operator has verified a fresh disposable target's
// container/project ID, port mapping, data paths and ownership. A URL or run ID
// alone is not that proof. No client is constructed while collecting/skipping.
const url = process.env.TEST_DATABASE_URL;
const runId = process.env.KOSSILON_NAR_500_RUN_ID;
const eventsPath = process.env.KOSSILON_NAR_500_EVENTS_PATH;
const enabled = Boolean(url && runId);

describe.skipIf(!enabled)("R26.4 actual SQL 500-row NAR persistence", () => {
  it("reviews, interrupts, cancels and resumes all 500 rows without duplicate or credited payments", async () => {
    if (!url || !runId || !/^cosec-[a-z0-9-]{8,100}$/.test(runId))
      throw new Error("A unique cosec run ID and verified disposable DB are required.");
    const context = getCurrentTest()?.context;
    if (!context) throw new Error("This fixture requires the Vitest test lifetime.");
    if (!eventsPath)
      throw new Error("A new run-owned event file is required; passing stdout may be suppressed.");
    const pending = scenario(url, runId, eventsPath, context.signal);
    // Vitest timeout must await teardown instead of leaving a late worker alive.
    onTestFinished(async () => {
      try {
        await pending;
      } catch (error) {
        if (!context.signal.aborted || error !== context.signal.reason) throw error;
      }
    });
    await pending;
  }, 180_000);
});

async function scenario(
  databaseUrl: string,
  round: string,
  eventFile: string,
  signal: AbortSignal,
) {
  const resolvedEventFile = resolve(eventFile);
  const eventRelative = relative(resolve("docs/audit-remediation"), resolvedEventFile);
  if (
    eventRelative.startsWith("..") ||
    isAbsolute(eventRelative) ||
    realpathSync(dirname(resolvedEventFile)) !== dirname(resolvedEventFile)
  )
    throw new Error(
      "Event file must be inside the verified workspace audit directory, without symlink redirection.",
    );
  // Exclusive allocation prevents retries from replacing a previous round's IDs.
  const eventFd = openSync(resolvedEventFile, "wx");
  const teamId = randomUUID(),
    templateId = randomUUID();
  const userIds = Array.from({ length: 3 }, () => randomUUID());
  const [adminId, staffId, otherAdminId] = userIds;
  const companies = Array.from({ length: 500 }, () => randomUUID());
  const actor = (userId: string, role: "Admin" | "Staff"): AuthenticatedActor => ({
    userId,
    authUserId: `${round}:${userId}`,
    role,
    teamId,
    active: true,
  });
  const admin = actor(adminId, "Admin"),
    staff = actor(staffId, "Staff"),
    otherAdmin = actor(otherAdminId, "Admin");
  const raw = createSqlClient(databaseUrl, { max: 4 });
  const sql = guardSqlTestLifetime(raw, () => signal);
  let reader: ReturnType<typeof createSqlClient> | undefined;
  const record = (phase: string, details: object) =>
    appendFileSync(eventFd, JSON.stringify({ runId: round, phase, ...details }) + "\n");
  record("planned-ids", { teamId, templateId, userIds, companies });
  try {
    const prerequisite =
      await sql`select p.id from sla_policies p join business_calendars c on c.id=p.business_calendar_id where p.work_type='annual_return_case' and p.active and c.active and p.effective_from<=now() limit 1`;
    if (!prerequisite.length)
      throw new Error(
        "The verified disposable target requires an active annual_return_case SLA/calendar fixture; no company fixtures written.",
      );
    await sql.begin(async (tx) => {
      await tx`insert into teams(id,name) values(${teamId},${round + ":500"})`;
      for (const identity of [admin, staff, otherAdmin]) {
        await tx`insert into users(id,name,email,role,team_id,active) values(${identity.userId!},'Synthetic 500-row reviewer',${identity.userId + "@example.test"},${identity.role},${teamId},true)`;
        await tx`insert into staff_profiles(user_id,auth_user_id,role,team_id,active) values(${identity.userId!},${identity.authUserId},${identity.role},${teamId},true)`;
      }
      await tx`insert into checklist_templates(id,name,service_type,documents) values(${templateId},${round + ":500"},'Annual Return — Private Ltd',${tx.json([{ label: "NAR1", required: true, daysBeforeDue: 7 }])})`;
      await tx`insert into companies ${tx(
        companies.map((id, i) => ({
          id,
          company_name: `Synthetic 500-row company ${i + 1}`,
          cr_number: id,
          br_number: id,
          incorporation_date: "2020-01-01",
          annual_return_basis_date: "2026-01-01",
          registered_office: "Synthetic office",
          company_secretary: "Synthetic secretary",
          status: "active",
          assigned_owner_id: staffId,
          assigned_team_id: teamId,
          data_origin: "client",
        })),
      )}`;
      await tx`insert into company_external_references ${tx(
        companies.map((id, i) => ({
          source_system: "nar-monthly-workbook",
          external_client_id: `${round}:${i}`,
          company_id: id,
          mapped_by: adminId,
        })),
      )}`;
    });
    const stage: StageBatchInput = {
      sourceFileName: `${round}-generated-500.xlsx`,
      sourceSha256: createHash("sha256").update(round).digest("hex"),
      sourceSizeBytes: 500,
      parserVersion: "generated-normalized-500-v1",
      returnYear: 2025,
      createdBy: adminId,
      authUserId: admin.authUserId,
      read: {
        sheetName: "8.2025",
        headerRowNumber: 2,
        columns: {
          clientId: "B",
          companyName: "C",
          incorporation: "D",
          invoice: "E",
          paymentReceived: "F",
          arDue: "G",
          brDue: "H",
        },
        skippedRowNumbers: [],
        issues: [],
        rows: companies.map((_, i) => ({
          rowNumber: i + 3,
          externalClientId: `${round}:${i}`,
          companyName: `Synthetic 500-row company ${i + 1}`,
          incorporation: { kind: "dayMonth", day: 1, month: 1, raw: "01/01", ambiguous: false },
          invoice: { kind: "value", raw: "SHARED-REFERENCE-500" },
          paymentReceived: {
            kind: "text",
            iso: "2025-03-01",
            raw: "1/3/2025 (credit note)",
            ambiguous: false,
          },
          arDue: { kind: "text", iso: "2025-02-15", raw: "15/2/2025", ambiguous: false },
          brDue: { kind: "absent" },
          raw: {
            F: {
              ref: `F${i + 3}`,
              type: "s",
              text: "1/3/2025 (credit note)",
              dateFormatted: false,
              fromFormula: false,
            },
          },
          issues: [],
        })),
      },
    };
    const imports = createNarImportRepository({ sql });
    const { batch } = await imports.stageBatch(stage);
    const rows = await imports.listRows(batch.id),
      rowIds = rows.map((r) => r.id);
    record("staged-ids", { batchId: batch.id, rowIds });
    expect(rows).toHaveLength(500);
    expect(batch).toMatchObject({
      rowCount: 500,
      returnYear: 2025,
      sourceSha256: stage.sourceSha256,
      parserVersion: stage.parserVersion,
    });
    expect((await imports.stageBatch(stage)).batch.id).toBe(batch.id);
    expect(
      await sql`select id from annual_return_cases where company_id=any(${companies}::uuid[])`,
    ).toHaveLength(0);

    const fullInputs: Record<string, NarRowInputs> = Object.fromEntries(
      rowIds.map((id) => [
        id,
        {
          templateId,
          ownerId: staffId,
          feeAmount: 1200,
          invoiceNumber: "SHARED-REFERENCE-500",
          madeUpDate: "2025-01-01",
          acknowledgeDueDifference: true,
          acknowledgeSourceIssues: true,
        },
      ]),
    );
    const firstInputs = Object.fromEntries(
      rowIds.map((id, i) => {
        const input = { ...fullInputs[id] };
        if (i < 20) delete input.feeAmount;
        return [id, input];
      }),
    );
    const repo = createNarApplyRepository({ sql });
    const preview = await repo.preview(admin, { batchId: batch.id, rowIds, inputs: firstInputs });
    expect(preview).toMatchObject({ selected: 500, eligibleCount: 480 });
    expect(preview.rows.filter((r) => r.requiredInputs.includes("feeAmount"))).toHaveLength(20);
    const command = { previewId: preview.previewId, idempotencyKey: `${round}:initial` };
    // Spoofed caller role must not override persisted Staff identity.
    await expect(repo.execute({ ...staff, role: "Admin" }, command)).rejects.toThrow(
      /current verified Admin/,
    );
    const [job, sameJob] = await Promise.all([
      repo.execute(admin, command),
      repo.execute(admin, command),
    ]);
    expect(sameJob).toEqual(job);
    await expect(repo.getJob(otherAdmin, job.jobId)).rejects.toThrow(/own NAR job/);
    await expect(repo.cancel(staff, job.jobId)).rejects.toThrow(/current verified Admin/);
    record("initial-job", { previewId: preview.previewId, jobId: job.jobId });
    await expect(
      runNarApplyChunk({
        repository: repo,
        actor: admin,
        jobId: job.jobId,
        limit: 100,
        afterCommit: (processed) => {
          if (processed === 37)
            throw new Error("Synthetic acknowledgement loss after 37 committed rows");
        },
      }),
    ).rejects.toThrow(/after 37 committed rows/);

    // Independent connection/repository re-open; this is DB persistence, not a
    // native-auth HTTP/browser reload or a provider/network-failure simulation.
    reader = createSqlClient(databaseUrl, { max: 2 });
    const readSql = guardSqlTestLifetime(reader, () => signal);
    const reopened = createNarApplyRepository({ sql: readSql });
    const interrupted = await reopened.getJob(admin, job.jobId);
    expect(interrupted.counts).toEqual({
      pending: 443,
      applied: 37,
      conflict: 0,
      failed: 20,
      cancelled: 0,
    });
    expect(
      interrupted.rows
        .filter((r) => r.state === "applied")
        .every((r) => r.attempts === 1 && r.case_id),
    ).toBe(true);
    expect(await reopened.cancel(admin, job.jobId)).toEqual({ cancelled: 443 });
    expect(await reopened.cancel(admin, job.jobId)).toEqual({ cancelled: 0 });
    expect(await runNarApplyChunk({ repository: repo, actor: admin, jobId: job.jobId })).toEqual({
      processed: 0,
    });
    const cancelled = await reopened.getJob(admin, job.jobId);
    expect(cancelled.state).toBe("cancelled");
    expect(cancelled.counts).toEqual({
      pending: 0,
      applied: 37,
      conflict: 0,
      failed: 20,
      cancelled: 443,
    });
    expect((await imports.getBatch(batch.id))?.status).toBe("pending_review");
    record("cancelled", { jobId: job.jobId, counts: cancelled.counts });

    const remaining = cancelled.rows.filter((r) => r.state !== "applied").map((r) => r.row_id);
    expect(remaining).toHaveLength(463);
    const reviewed = await reopened.preview(admin, {
      batchId: batch.id,
      rowIds: remaining,
      inputs: fullInputs,
    });
    expect(reviewed).toMatchObject({ selected: 463, eligibleCount: 463 });
    await expect(
      reopened.execute(admin, { ...command, previewId: reviewed.previewId }),
    ).rejects.toThrow(/idempotency|key|payload/i);
    const resume = { previewId: reviewed.previewId, idempotencyKey: `${round}:reviewed-resume` };
    const [resumed, duplicateResume] = await Promise.all([
      repo.execute(admin, resume),
      reopened.execute(admin, resume),
    ]);
    expect(duplicateResume).toEqual(resumed);
    record("resumed-job", { previewId: reviewed.previewId, jobId: resumed.jobId, remaining });
    const processed: number[] = [];
    for (let i = 0; i < 5; i++)
      processed.push(
        (
          await runNarApplyChunk({
            repository: reopened,
            actor: admin,
            jobId: resumed.jobId,
            limit: 100,
          })
        ).processed,
      );
    expect(processed).toEqual([100, 100, 100, 100, 63]);
    expect(
      await runNarApplyChunk({ repository: repo, actor: admin, jobId: resumed.jobId }),
    ).toEqual({ processed: 0 });
    expect(await reopened.getJob(admin, resumed.jobId)).toMatchObject({
      state: "completed",
      selected: 463,
      unselected: 37,
      counts: { pending: 0, applied: 463, conflict: 0, failed: 0, cancelled: 0 },
    });
    expect((await reopened.getJob(admin, job.jobId)).counts).toEqual(cancelled.counts);
    expect(await createNarImportRepository({ sql: readSql }).getBatch(batch.id)).toMatchObject({
      rowCount: 500,
      status: "applied",
    });

    const facts =
      await readSql`select a.id,a.company_id,a.filing_due_date::text due,a.import_origin,p.id payment_id,p.invoice_number,p.status,p.amount,p.paid_at,w.id work_id from annual_return_cases a join payments p on p.case_id=a.id join work_items w on w.annual_return_case_id=a.id where a.company_id=any(${companies}::uuid[])`;
    expect(facts).toHaveLength(500);
    for (const column of ["id", "company_id", "payment_id", "work_id"])
      expect(new Set(facts.map((r) => r[column])).size).toBe(500);
    expect(new Set(facts.map((r) => r.company_id))).toEqual(new Set(companies));
    expect(
      facts.every(
        (r) =>
          r.due === "2025-02-15" &&
          r.import_origin === "historical" &&
          r.invoice_number === "SHARED-REFERENCE-500" &&
          r.amount === 1200 &&
          r.status === "Payment pending" &&
          r.paid_at === null,
      ),
    ).toBe(true);
    const journal =
      await readSql`select id,row_id,case_id,job_id,command from nar_apply_journal where batch_id=${batch.id}`;
    expect(journal).toHaveLength(500);
    expect(new Set(journal.map((r) => r.row_id))).toEqual(new Set(rowIds));
    expect(new Set(journal.map((r) => r.case_id))).toEqual(new Set(facts.map((r) => r.id)));
    expect(journal.every((r) => r.command === "create")).toBe(true);
    const finalRows = await createNarImportRepository({ sql: readSql }).listRows(batch.id);
    for (const row of finalRows) {
      expect(row.appliedCaseId).toBeTruthy();
      expect(row.raw).toEqual(stage.read.rows.find((r) => r.rowNumber === row.rowNumber)!.raw);
    }
    record("readback", {
      batchId: batch.id,
      counts: { cases: facts.length, journal: journal.length },
      processed,
      facts,
      journal,
    });
  } finally {
    try {
      await reader?.end();
      // Cleanup deliberately uses the unguarded client after a body timeout.
      // Every predicate is bound to this run's generated exact parent IDs.
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
          await tx`select 'payment' kind,id from payments where company_id=any(${companies}::uuid[]) union all select 'work',id from work_items where company_id=any(${companies}::uuid[]) union all select 'checklist',id from annual_return_checklist_items where case_id=any(${caseIds}::uuid[]) union all select 'timeline',id from timeline_events where company_id=any(${companies}::uuid[]) union all select 'audit',id from annual_return_audit_events where case_id=any(${caseIds}::uuid[]) union all select 'outbox',id from notification_outbox where company_id=any(${companies}::uuid[])`;
        record("cleanup-ids", { caseIds, batchIds, jobIds, descendants });
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
        await raw.end();
      } finally {
        closeSync(eventFd);
      }
    }
  }
}
