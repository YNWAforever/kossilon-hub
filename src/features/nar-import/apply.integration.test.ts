import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getCurrentTest } from "@vitest/runner";
import { afterAll, describe, expect, it, onTestFinished } from "vitest";
import { createSqlClient } from "@/server/db/client";
import { guardSqlTestLifetime } from "@/test/sql-test-lifetime";
import type { AuthenticatedActor } from "@/features/auth/types";
import { createNarImportRepository, type StageBatchInput } from "./repository";
import {
  applyNarRow,
  createNarApplyRepository,
  runNarApplyChunk,
  type NarRowInputs,
} from "./apply";
import { createNotificationOutboxRepository } from "@/features/notifications/outbox";
const url = process.env.TEST_DATABASE_URL;
const rawSql = url ? createSqlClient(url, { max: 4 }) : null;
let activeSignal: AbortSignal | undefined;
const sql = rawSql ? guardSqlTestLifetime(rawSql, () => activeSignal) : null;
afterAll(async () => {
  await rawSql?.end();
});

// Executed by fixture-timeout.integration.test.ts in a real failed child process.
// It must remain failed; the parent verifies cleanup, not an application PASS.
if (process.env.AUDIT_NAR_TIMEOUT_PROBE === "1" && url) {
  it(
    "controlled fixture timeout B07",
    async () =>
      fixture(1, async (f) => {
        const input = f.inputs[f.rowIds[0]];
        console.info(
          "B07_TIMEOUT_FIXTURE",
          JSON.stringify({
            companyId: f.companies[0],
            batchId: f.batchId,
            actorId: f.actor.userId,
            ownerId: input.ownerId,
            templateId: input.templateId,
          }),
        );
        await new Promise((resolve) => setTimeout(resolve, 5000));
        await sql!.unsafe("select 1");
      }),
    1000,
  );
}
const team = "10000000-0000-0000-0000-000000000001";
async function fixture(n: number, run: Parameters<typeof fixtureCore>[1]) {
  const context = getCurrentTest()?.context;
  if (!context) throw new Error("The NAR fixture requires a running Vitest test.");
  if (activeSignal) throw new Error("The shared NAR fixture must run sequentially.");
  // Capture now: runner context can disappear while a timed-out body unwinds.
  activeSignal = context.signal;
  const pending = fixtureCore(n, run).finally(() => {
    activeSignal = undefined;
  });
  onTestFinished(async () => {
    try {
      // Timeout rejects Vitest's race without cancelling/awaiting the original body.
      await pending;
    } catch (error) {
      // Keep the runner's timeout failure; surface independent teardown failures.
      if (!context.signal.aborted || error !== context.signal.reason) throw error;
    }
  });
  return pending;
}
async function fixtureCore(
  n: number,
  run: (f: {
    actor: AuthenticatedActor;
    companies: string[];
    batchId: string;
    rowIds: string[];
    inputs: Record<string, NarRowInputs>;
    stage: StageBatchInput;
  }) => Promise<void>,
) {
  const actorId = crypto.randomUUID(),
    ownerId = crypto.randomUUID(),
    templateId = crypto.randomUUID(),
    companies = Array.from({ length: n }, () => crypto.randomUUID()),
    tag = crypto.randomUUID();
  const actor: AuthenticatedActor = {
    userId: actorId,
    authUserId: `synthetic-nar-${actorId}`,
    role: "Admin",
    teamId: team,
    active: true,
  };
  await sql!.begin(async (tx) => {
    for (const [id, role] of [
      [actorId, "Admin"],
      [ownerId, "Staff"],
    ] as const) {
      await tx`insert into users(id,name,email,role,team_id,active) values(${id},'Synthetic NAR staff',${id + "@example.test"},${role},${team},true)`;
      await tx`insert into staff_profiles(user_id,auth_user_id,role,team_id,active) values(${id},${`synthetic-nar-${id}`},${role},${team},true)`;
    }
    await tx`insert into checklist_templates(id,name,service_type,documents) values(${templateId},${tag},'Annual Return — Private Ltd',${tx.json([{ label: "NAR1", required: true, daysBeforeDue: 7 }])})`;
    await tx`insert into companies ${tx(companies.map((id) => ({ id, company_name: "Synthetic NAR company", cr_number: id, br_number: id, incorporation_date: "2020-01-01", annual_return_basis_date: "2026-01-01", registered_office: "Test", company_secretary: "Test", status: "active", assigned_owner_id: ownerId, assigned_team_id: team, data_origin: "client" })))}`;
  });
  const stage: StageBatchInput = {
    sourceFileName: "synthetic-35-rows-65-format.xlsx",
    sourceSha256: tag.replaceAll("-", "").repeat(2),
    sourceSizeBytes: 100,
    parserVersion: "synthetic-contract-v1",
    returnYear: 2025,
    createdBy: actorId,
    authUserId: actor.authUserId,
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
        externalClientId: tag + "-" + i,
        companyName: "Synthetic NAR company",
        incorporation: { kind: "dayMonth", day: 1, month: 1, raw: "01/01", ambiguous: false },
        invoice: { kind: "value", raw: "DUPLICATE-INVOICE" },
        paymentReceived: {
          kind: "text",
          iso: "2025-03-01",
          raw: "1/3/2025 (credit note)",
          ambiguous: false,
        },
        arDue: { kind: "text", iso: "2025-02-15", raw: "15/2/2025", ambiguous: false },
        brDue: { kind: "absent" },
        raw: {
          G: {
            ref: `G${i + 3}`,
            type: "s",
            text: "15/2/2025",
            dateFormatted: false,
            fromFormula: false,
          },
        },
        issues: [],
      })),
    },
  };
  const repo = createNarImportRepository({ sql: sql! });
  let batchId = "";
  try {
    const staged = await repo.stageBatch(stage);
    batchId = staged.batch.id;
    // Multi-row fixture setup is not an application bulk write; actual mapping commands have dedicated tests below.
    await sql!`insert into company_external_references ${sql!(companies.map((id, i) => ({ source_system: "nar-monthly-workbook", external_client_id: tag + "-" + i, company_id: id, mapped_by: actorId })))}`;
    const rows = await repo.listRows(batchId);
    const inputs = Object.fromEntries(
      rows.map((r) => [
        r.id,
        {
          templateId,
          ownerId,
          feeAmount: 1200,
          invoiceNumber: "DUPLICATE-INVOICE",
          madeUpDate: "2025-01-01",
          acknowledgeDueDifference: true,
          acknowledgeSourceIssues: true,
        },
      ]),
    );
    await run({ actor, companies, batchId, rowIds: rows.map((r) => r.id), inputs, stage });
  } finally {
    // Teardown deliberately bypasses the expired test-body guard.
    await rawSql!.begin(async (tx) => {
      const cases =
        await tx`select id from annual_return_cases where company_id=any(${companies}::uuid[])`;
      const ids = cases.map((r) => r.id);
      await tx`delete from notification_outbox where company_id=any(${companies}::uuid[])`;
      await tx`delete from nar_apply_journal where batch_id in(select id from nar_import_batches where created_by=${actorId})`;
      await tx`delete from nar_apply_job_items where job_id in(select id from nar_apply_jobs where actor_user_id=${actorId})`;
      await tx`delete from nar_apply_jobs where actor_user_id=${actorId}`;
      await tx`delete from nar_apply_previews where actor_user_id=${actorId}`;
      const [catalog] = await tx`select to_regclass('public.nar_batch_review_events') relation`;
      if (catalog.relation)
        await tx`delete from nar_batch_review_events where batch_id in(select id from nar_import_batches where created_by=${actorId})`;
      await tx`delete from nar_import_batches where created_by=${actorId}`;
      await tx`delete from nar_mapping_events where actor_user_id=${actorId}`;
      await tx`delete from assignment_events where work_item_id in(select id from work_items where company_id=any(${companies}::uuid[]))`;
      await tx`delete from work_items where company_id=any(${companies}::uuid[])`;
      await tx`delete from annual_return_audit_events where case_id=any(${ids}::uuid[])`;
      await tx`delete from timeline_events where company_id=any(${companies}::uuid[])`;
      await tx`delete from annual_return_cases where id=any(${ids}::uuid[])`;
      await tx`delete from companies where id=any(${companies}::uuid[])`;
      await tx`delete from checklist_templates where id=${templateId}`;
      await tx`delete from staff_access_events where actor_user_id=${actorId}`;
      await tx`delete from staff_profiles where user_id=any(${[actorId, ownerId]}::uuid[])`;
      await tx`delete from users where id=any(${[actorId, ownerId]}::uuid[])`;
    });
  }
}
describe.skipIf(!url)("actual PostgreSQL reviewed NAR apply", () => {
  it("persists chosen year and reuses exact bytes without allowing a different year", async () =>
    fixture(1, async (f) => {
      const repo = createNarImportRepository({ sql: sql! });
      expect((await repo.getBatch(f.batchId))?.returnYear).toBe(2025);
      expect((await repo.stageBatch(f.stage)).reused).toBe(true);
      await expect(repo.stageBatch({ ...f.stage, returnYear: 2026 })).rejects.toThrow(/year|年度/i);
    }));
  it("requires real mapping, fee and made-up date; source payment date is observation only", async () =>
    fixture(2, async (f) => {
      const repo = createNarApplyRepository({ sql: sql! });
      const p = await repo.preview(f.actor, { batchId: f.batchId, rowIds: f.rowIds, inputs: {} });
      expect(
        p.rows.every(
          (r) => r.requiredInputs.includes("feeAmount") && r.requiredInputs.includes("madeUpDate"),
        ),
      ).toBe(true);
      expect(
        (
          await sql!`select count(*)::int n from annual_return_cases where company_id=any(${f.companies}::uuid[])`
        )[0].n,
      ).toBe(0);
    }));
  it("applies only selected rows, keeps raw/parser, duplicate invoice is not identity, never marks paid", async () =>
    fixture(35, async (f) => {
      const repo = createNarApplyRepository({ sql: sql! });
      const p = await repo.preview(f.actor, {
        batchId: f.batchId,
        rowIds: f.rowIds.slice(0, 2),
        inputs: f.inputs,
      });
      expect(p.eligibleCount).toBe(2);
      const command = { previewId: p.previewId, idempotencyKey: crypto.randomUUID() };
      const job = await repo.execute(f.actor, command);
      expect(await repo.execute(f.actor, command)).toEqual(job);
      await runNarApplyChunk({ repository: repo, actor: f.actor, jobId: job.jobId });
      await runNarApplyChunk({ repository: repo, actor: f.actor, jobId: job.jobId });
      const r = await repo.getJob(f.actor, job.jobId);
      expect(r.counts.applied).toBe(2);
      expect(r.selected).toBe(2);
      expect(r.unselected).toBe(33);
      const cases =
        await sql!`select a.filing_due_date::text due,a.import_origin,p.status,p.amount,p.paid_at from annual_return_cases a join payments p on p.case_id=a.id where a.company_id=any(${f.companies}::uuid[])`;
      expect(cases).toHaveLength(2);
      expect(
        cases.every(
          (c) =>
            c.due === "2025-02-15" &&
            c.import_origin === "historical" &&
            c.status === "Payment pending" &&
            c.paid_at === null,
        ),
      ).toBe(true);
      expect((await createNarImportRepository({ sql: sql! }).getBatch(f.batchId))?.status).toBe(
        "pending_review",
      );
      expect(
        (await sql!`select count(*)::int n from nar_apply_journal where batch_id=${f.batchId}`)[0]
          .n,
      ).toBe(2);
      const row = (await createNarImportRepository({ sql: sql! }).listRows(f.batchId))[0];
      expect(row.raw).toEqual({
        G: { ref: "G3", type: "s", text: "15/2/2025", dateFormatted: false, fromFormula: false },
      });
    }));
  it("crash after commit resumes without duplicate cases, work, payment or journals", async () =>
    fixture(3, async (f) => {
      const repo = createNarApplyRepository({ sql: sql! });
      const p = await repo.preview(f.actor, {
        batchId: f.batchId,
        rowIds: f.rowIds,
        inputs: f.inputs,
      });
      const j = await repo.execute(f.actor, {
        previewId: p.previewId,
        idempotencyKey: crypto.randomUUID(),
      });
      await expect(
        runNarApplyChunk({
          repository: repo,
          actor: f.actor,
          jobId: j.jobId,
          afterCommit: () => {
            throw new Error("synthetic process crash");
          },
        }),
      ).rejects.toThrow(/crash/);
      expect((await repo.getJob(f.actor, j.jobId)).counts).toMatchObject({
        applied: 1,
        pending: 2,
      });
      await runNarApplyChunk({
        repository: createNarApplyRepository({ sql: sql! }),
        actor: f.actor,
        jobId: j.jobId,
      });
      expect((await repo.getJob(f.actor, j.jobId)).counts.applied).toBe(3);
      expect(
        (await sql!`select count(*)::int n from nar_apply_journal where batch_id=${f.batchId}`)[0]
          .n,
      ).toBe(3);
    }));
  it("concurrent independent workers on the same job apply each row exactly once", async () =>
    fixture(3, async (f) => {
      const a = createSqlClient(url!, { max: 1 }),
        b = createSqlClient(url!, { max: 1 });
      try {
        expect((await a`select pg_backend_pid() pid`)[0].pid).not.toBe(
          (await b`select pg_backend_pid() pid`)[0].pid,
        );
        const repo = createNarApplyRepository({ sql: sql! });
        const p = await repo.preview(f.actor, {
          batchId: f.batchId,
          rowIds: f.rowIds,
          inputs: f.inputs,
        });
        const j = await repo.execute(f.actor, {
          previewId: p.previewId,
          idempotencyKey: crypto.randomUUID(),
        });
        await Promise.all(
          [a, b].map((client) =>
            runNarApplyChunk({
              repository: createNarApplyRepository({ sql: client }),
              actor: f.actor,
              jobId: j.jobId,
            }),
          ),
        );
        expect((await repo.getJob(f.actor, j.jobId)).counts.applied).toBe(3);
        expect(
          (
            await sql!`select count(*)::int n from work_items where company_id=any(${f.companies}::uuid[])`
          )[0].n,
        ).toBe(3);
      } finally {
        await a.end();
        await b.end();
      }
    }));
  it("changed mapping or case after preview is conflict, with no domain write", async () =>
    fixture(1, async (f) => {
      const repo = createNarApplyRepository({ sql: sql! });
      const p = await repo.preview(f.actor, {
        batchId: f.batchId,
        rowIds: f.rowIds,
        inputs: f.inputs,
      });
      const j = await repo.execute(f.actor, {
        previewId: p.previewId,
        idempotencyKey: crypto.randomUUID(),
      });
      await sql!`update companies set company_name='Changed since approval' where id=${f.companies[0]}`;
      await runNarApplyChunk({ repository: repo, actor: f.actor, jobId: j.jobId });
      expect((await repo.getJob(f.actor, j.jobId)).counts.conflict).toBe(1);
      expect(
        (
          await sql!`select count(*)::int n from annual_return_cases where company_id=${f.companies[0]}`
        )[0].n,
      ).toBe(0);
    }));
  it("current Admin revocation and foreign job identity cannot write or read results", async () =>
    fixture(1, async (f) => {
      const repo = createNarApplyRepository({ sql: sql! });
      const p = await repo.preview(f.actor, {
        batchId: f.batchId,
        rowIds: f.rowIds,
        inputs: f.inputs,
      });
      const j = await repo.execute(f.actor, {
        previewId: p.previewId,
        idempotencyKey: crypto.randomUUID(),
      });
      await expect(repo.getJob({ ...f.actor, authUserId: "foreign" }, j.jobId)).rejects.toThrow(
        /Forbidden/,
      );
      await sql!`update staff_profiles set active=false where user_id=${f.actor.userId!}`;
      await expect(
        runNarApplyChunk({ repository: repo, actor: f.actor, jobId: j.jobId }),
      ).rejects.toThrow(/Forbidden/);
      expect(
        (
          await sql!`select count(*)::int n from annual_return_cases where company_id=${f.companies[0]}`
        )[0].n,
      ).toBe(0);
    }));
  it("historical cases inside client companies fail claim and dispatch-marker gates", async () =>
    fixture(1, async (f) => {
      const repo = createNarApplyRepository({ sql: sql! });
      const p = await repo.preview(f.actor, {
        batchId: f.batchId,
        rowIds: f.rowIds,
        inputs: f.inputs,
      });
      const j = await repo.execute(f.actor, {
        previewId: p.previewId,
        idempotencyKey: crypto.randomUUID(),
      });
      await runNarApplyChunk({ repository: repo, actor: f.actor, jobId: j.jobId });
      const [w] = await sql!`select id from work_items where company_id=${f.companies[0]}`;
      const outbox = createNotificationOutboxRepository({ sql: sql! });
      const now = new Date().toISOString();
      const queued = await outbox.enqueue({
        companyId: f.companies[0],
        workItemId: w.id,
        channel: "email",
        notificationType: "synthetic-nar",
        idempotencyKey: crypto.randomUUID(),
        recipient: "test@example.test",
        payload: { test: true },
      });
      await sql!`update notification_outbox set next_attempt_at=now()-interval '1 minute' where id=${queued.id}`;
      let claimed: string[] = [];
      try {
        await sql!.begin(async (tx) => {
          claimed = (await createNotificationOutboxRepository({ sql: tx }).claimDue(now, 500)).map(
            (r) => r.id,
          );
          throw new Error("owned rollback");
        });
      } catch (e) {
        if (!(e instanceof Error) || e.message !== "owned rollback") throw e;
      }
      expect(claimed).not.toContain(queued.id);
      await sql!`update notification_outbox set status='processing',attempt_count=1 where id=${queued.id}`;
      expect(await outbox.markDispatchStarted(queued.id, { attemptCount: 1 })).toBe(false);
      expect((await outbox.cancelFixtureOriginNotifications(now)).cancelled).toBeGreaterThanOrEqual(
        1,
      );
    }));
  it("cross-batch same-company/year workers preserve one case and report the other conflict", async () =>
    fixture(1, async (f) => {
      const second = await createNarImportRepository({ sql: sql! }).stageBatch({
        ...f.stage,
        sourceSha256: crypto.randomUUID().replaceAll("-", "").repeat(2),
      });
      const [r] = await createNarImportRepository({ sql: sql! }).listRows(second.batch.id);
      const repo = createNarApplyRepository({ sql: sql! });
      const previews = await Promise.all([
        repo.preview(f.actor, { batchId: f.batchId, rowIds: f.rowIds, inputs: f.inputs }),
        repo.preview(f.actor, {
          batchId: second.batch.id,
          rowIds: [r.id],
          inputs: { [r.id]: f.inputs[f.rowIds[0]] },
        }),
      ]);
      const jobs = await Promise.all(
        previews.map((p) =>
          repo.execute(f.actor, { previewId: p.previewId, idempotencyKey: crypto.randomUUID() }),
        ),
      );
      const a = createSqlClient(url!, { max: 1 }),
        b = createSqlClient(url!, { max: 1 });
      try {
        await Promise.all(
          jobs.map((j, i) =>
            runNarApplyChunk({
              repository: createNarApplyRepository({ sql: i === 0 ? a : b }),
              actor: f.actor,
              jobId: j.jobId,
            }),
          ),
        );
      } finally {
        await a.end();
        await b.end();
      }
      const results = await Promise.all(jobs.map((j) => repo.getJob(f.actor, j.jobId)));
      expect(results.reduce((n, r) => n + r.counts.applied, 0)).toBe(1);
      expect(results.reduce((n, r) => n + r.counts.conflict, 0)).toBe(1);
      expect(
        (
          await sql!`select count(*)::int n from annual_return_cases where company_id=${f.companies[0]} and return_year=2025`
        )[0].n,
      ).toBe(1);
    }));
  it("Nil/credit/blank observations stay raw; year disagreement needs explicit acknowledgement", async () =>
    fixture(1, async (f) => {
      await sql!`update nar_import_batches set sheet_name='8.2026' where id=${f.batchId}`;
      await sql!`update nar_import_rows set parsed=jsonb_set(parsed,'{invoice}',${sql!.json({ kind: "nil", raw: "(Nil)" })}::jsonb) where id=${f.rowIds[0]}`;
      const repo = createNarApplyRepository({ sql: sql! });
      const inputs = { ...f.inputs[f.rowIds[0]], invoiceNumber: undefined };
      const p = await repo.preview(f.actor, {
        batchId: f.batchId,
        rowIds: f.rowIds,
        inputs: { [f.rowIds[0]]: inputs },
      });
      expect(p.rows[0].requiredInputs).toEqual(
        expect.arrayContaining(["invoiceNumber", "acknowledgeYearDifference"]),
      );
      expect(
        (await sql!`select count(*)::int n from payments where company_id=${f.companies[0]}`)[0].n,
      ).toBe(0);
    }));
  it("fixture companies are excluded from ordinary mapping catalogue", async () =>
    fixture(1, async (f) => {
      await sql!`update companies set data_origin='fixture' where id=${f.companies[0]}`;
      const options = await createNarApplyRepository({ sql: sql! }).listOptions(f.actor);
      expect(options.companies.map((c) => c.id)).not.toContain(f.companies[0]);
    }));
  it("confirmed SQL rollback is per-row failed, continues other rows and never auto-retries failed work", async () =>
    fixture(2, async (f) => {
      let fault = true;
      const repo = createNarApplyRepository({
        sql: sql!,
        applyRow: async (tx, actor, c, item) => {
          const id = await applyNarRow(tx, actor, c, item);
          if (fault) {
            fault = false;
            await tx.unsafe(
              "do $$ begin raise exception using errcode='23514',message='Synthetic local row failure'; end $$;",
            );
          }
          return id;
        },
      });
      const p = await repo.preview(f.actor, {
        batchId: f.batchId,
        rowIds: f.rowIds,
        inputs: f.inputs,
      });
      const j = await repo.execute(f.actor, {
        previewId: p.previewId,
        idempotencyKey: crypto.randomUUID(),
      });
      await runNarApplyChunk({ repository: repo, actor: f.actor, jobId: j.jobId });
      expect((await repo.getJob(f.actor, j.jobId)).counts).toMatchObject({
        applied: 1,
        failed: 1,
        pending: 0,
      });
      await runNarApplyChunk({ repository: repo, actor: f.actor, jobId: j.jobId });
      expect(
        (
          await sql!`select count(*)::int n from annual_return_cases where company_id=any(${f.companies}::uuid[])`
        )[0].n,
      ).toBe(1);
    }));
  it("compensation is read-only and flags a changed case; cancellation preserves applied rows", async () =>
    fixture(2, async (f) => {
      const repo = createNarApplyRepository({ sql: sql! });
      const p = await repo.preview(f.actor, {
        batchId: f.batchId,
        rowIds: f.rowIds,
        inputs: f.inputs,
      });
      const j = await repo.execute(f.actor, {
        previewId: p.previewId,
        idempotencyKey: crypto.randomUUID(),
      });
      await runNarApplyChunk({ repository: repo, actor: f.actor, jobId: j.jobId, limit: 1 });
      expect(await repo.cancel(f.actor, j.jobId)).toEqual({ cancelled: 1 });
      const before = await repo.compensationPreview(f.actor, j.jobId);
      expect(before[0]).toMatchObject({ writes: 0, currentMatches: true });
      const [saved] =
        await sql!`select after_value->'payments' payments from nar_apply_journal where job_id=${j.jobId}`;
      expect(saved.payments).toHaveLength(1);
      await sql!`update work_items set title='Subsequent staff work' where annual_return_case_id=${before[0].caseId}`;
      expect((await repo.compensationPreview(f.actor, j.jobId))[0].currentMatches).toBe(false);

      await sql!`update annual_return_cases set current_status='Payment pending' where id=${before[0].caseId}`;
      expect((await repo.compensationPreview(f.actor, j.jobId))[0].currentMatches).toBe(false);
      expect((await repo.getJob(f.actor, j.jobId)).counts).toMatchObject({
        applied: 1,
        cancelled: 1,
      });
    }));

  it("old unattributed mapping requires current explicit confirmation even when company stays the same", async () =>
    fixture(1, async (f) => {
      await sql!`update company_external_references set mapped_by=null where company_id=${f.companies[0]}`;
      const repo = createNarApplyRepository({ sql: sql! });
      expect(
        (await repo.preview(f.actor, { batchId: f.batchId, rowIds: f.rowIds, inputs: f.inputs }))
          .rows[0].requiredInputs,
      ).toContain("confirmedCompanyMapping");
      await createNarImportRepository({ sql: sql! }).mapExternalReference({
        externalClientId: f.stage.read.rows[0].externalClientId,
        companyId: f.companies[0],
        expectedCompanyId: f.companies[0],
        mappedBy: f.actor.userId!,
        authUserId: f.actor.authUserId,
      });
      expect(
        (await repo.preview(f.actor, { batchId: f.batchId, rowIds: f.rowIds, inputs: f.inputs }))
          .rows[0].requiredInputs,
      ).not.toContain("confirmedCompanyMapping");
    }));
  it("twenty-one durable jobs remain reachable through precise history cursors", async () =>
    fixture(1, async (f) => {
      const repo = createNarApplyRepository({ sql: sql! }),
        p = await repo.preview(f.actor, { batchId: f.batchId, rowIds: f.rowIds, inputs: f.inputs });
      let oldest = "";
      for (let n = 0; n < 21; n++) {
        const j = await repo.execute(f.actor, {
          previewId: p.previewId,
          idempotencyKey: crypto.randomUUID(),
        });
        if (n === 0) oldest = j.jobId;
      }
      const first = await repo.listJobs(f.actor, f.batchId);
      expect(first.items).toHaveLength(20);
      expect(first.nextCursor).toBeTruthy();
      const second = await repo.listJobs(f.actor, f.batchId, { cursor: first.nextCursor! });
      expect(second.items.map((j) => j.id)).toEqual([oldest]);
      await runNarApplyChunk({ repository: repo, actor: f.actor, jobId: oldest });
      expect((await repo.getJob(f.actor, oldest)).counts.applied).toBe(1);
    }));
  it("existing invoice/fee changes are explicit conflicts; due-date-only apply preserves payment facts", async () =>
    fixture(1, async (f) => {
      const repo = createNarApplyRepository({ sql: sql! });
      const p = await repo.preview(f.actor, {
          batchId: f.batchId,
          rowIds: f.rowIds,
          inputs: f.inputs,
        }),
        j = await repo.execute(f.actor, {
          previewId: p.previewId,
          idempotencyKey: crypto.randomUUID(),
        });
      await runNarApplyChunk({ repository: repo, actor: f.actor, jobId: j.jobId });
      const staged = await createNarImportRepository({ sql: sql! }).stageBatch({
        ...f.stage,
        sourceSha256: crypto.randomUUID().replaceAll("-", "").repeat(2),
        read: {
          ...f.stage.read,
          rows: f.stage.read.rows.map((r) => ({
            ...r,
            arDue: { kind: "text", iso: "2025-02-16", raw: "16/2/2025", ambiguous: false },
          })),
        },
      });
      const [row] = await createNarImportRepository({ sql: sql! }).listRows(staged.batch.id);
      const wrong = await repo.preview(f.actor, {
        batchId: staged.batch.id,
        rowIds: [row.id],
        inputs: {
          [row.id]: {
            feeAmount: 1300,
            invoiceNumber: "New invoice",
            acknowledgeDueDifference: true,
            acknowledgeSourceIssues: true,
          },
        },
      });
      expect(wrong.rows[0].conflicts).toContain(
        "existing_invoice_or_fee_change_requires_separate_review",
      );
      const clean = await repo.preview(f.actor, {
        batchId: staged.batch.id,
        rowIds: [row.id],
        inputs: { [row.id]: { acknowledgeDueDifference: true, acknowledgeSourceIssues: true } },
      });
      expect(clean.eligibleCount).toBe(1);
      expect(clean.rows[0].candidate.feeAmount).toBe(1200);
      expect(clean.rows[0].diff).toEqual([
        { field: "filingDueDate", before: "2025-02-15", after: "2025-02-16" },
      ]);
      const job = await repo.execute(f.actor, {
        previewId: clean.previewId,
        idempotencyKey: crypto.randomUUID(),
      });
      await runNarApplyChunk({ repository: repo, actor: f.actor, jobId: job.jobId });
      expect((await repo.getJob(f.actor, job.jobId)).counts.applied).toBe(1);
      const [payment] =
        await sql!`select amount,status,invoice_number,paid_at,due_date::text due from payments where company_id=${f.companies[0]}`;
      expect(payment).toMatchObject({
        amount: 1200,
        status: "Payment pending",
        invoice_number: "DUPLICATE-INVOICE",
        paid_at: null,
        due: "2025-02-16",
      });
    }));
  it("a party added after preview conflicts without overwriting staff work", async () =>
    fixture(1, async (f) => {
      const repo = createNarApplyRepository({ sql: sql! });
      const initial = await repo.preview(f.actor, {
        batchId: f.batchId,
        rowIds: f.rowIds,
        inputs: f.inputs,
      });
      const first = await repo.execute(f.actor, {
        previewId: initial.previewId,
        idempotencyKey: crypto.randomUUID(),
      });
      await runNarApplyChunk({ repository: repo, actor: f.actor, jobId: first.jobId });
      const staging = createNarImportRepository({ sql: sql! });
      const changed = await staging.stageBatch({
        ...f.stage,
        sourceSha256: crypto.randomUUID().replaceAll("-", "").repeat(2),
        read: {
          ...f.stage.read,
          rows: f.stage.read.rows.map((r) => ({
            ...r,
            arDue: { kind: "text" as const, iso: "2025-02-16", raw: "16/2/2025", ambiguous: false },
          })),
        },
      });
      const [row] = await staging.listRows(changed.batch.id);
      const input = {
        batchId: changed.batch.id,
        rowIds: [row.id],
        inputs: { [row.id]: { acknowledgeDueDifference: true, acknowledgeSourceIssues: true } },
      };
      const reviewed = await repo.preview(f.actor, input);
      expect(reviewed.eligibleCount).toBe(1);
      const job = await repo.execute(f.actor, {
        previewId: reviewed.previewId,
        idempotencyKey: crypto.randomUUID(),
      });
      const [case_] =
        await sql!`select id from annual_return_cases where company_id=${f.companies[0]}`;
      await sql!`insert into case_parties(case_id,party_type,display_name,confirmed_by,confirmed_at) values(${case_.id},'director','Synthetic confirmed director',${f.actor.userId},now())`;
      await runNarApplyChunk({ repository: repo, actor: f.actor, jobId: job.jobId });
      expect((await repo.getJob(f.actor, job.jobId)).counts).toMatchObject({
        applied: 0,
        conflict: 1,
      });
      const current = await repo.preview(f.actor, input);
      expect(current.rows[0].conflicts).toContain("staff_progress_conflict");
      expect(
        (
          await sql!`select filing_due_date::text due from annual_return_cases where id=${case_.id}`
        )[0].due,
      ).toBe("2025-02-15");
    }));
  // A new 100-transaction stress scenario; the existing suite's 30s default remains unchanged.
  // Its measured duration is recorded separately, and does not establish a production latency SLO.
  it(
    "finalizes exactly 100 applied rows without a 101st processing call",
    async () =>
      fixture(100, async (f) => {
        const repo = createNarApplyRepository({ sql: sql! }),
          p = await repo.preview(f.actor, {
            batchId: f.batchId,
            rowIds: f.rowIds,
            inputs: f.inputs,
          }),
          j = await repo.execute(f.actor, {
            previewId: p.previewId,
            idempotencyKey: crypto.randomUUID(),
          });
        expect(
          await runNarApplyChunk({ repository: repo, actor: f.actor, jobId: j.jobId, limit: 100 }),
        ).toEqual({ processed: 100 });
        expect(await repo.getJob(f.actor, j.jobId)).toMatchObject({
          state: "completed",
          counts: { applied: 100, pending: 0 },
        });
      }),
    120_000,
  );
  it("finalizes a mixed-result last chunk as partial without processing another row", async () =>
    fixture(3, async (f) => {
      const inputs = {
        ...f.inputs,
        [f.rowIds[0]]: { ...f.inputs[f.rowIds[0]], feeAmount: undefined },
      };
      const repo = createNarApplyRepository({ sql: sql! }),
        p = await repo.preview(f.actor, { batchId: f.batchId, rowIds: f.rowIds, inputs }),
        j = await repo.execute(f.actor, {
          previewId: p.previewId,
          idempotencyKey: crypto.randomUUID(),
        });
      expect(
        await runNarApplyChunk({ repository: repo, actor: f.actor, jobId: j.jobId, limit: 2 }),
      ).toEqual({ processed: 2 });
      expect(await repo.getJob(f.actor, j.jobId)).toMatchObject({
        state: "partial",
        counts: { applied: 2, failed: 1, pending: 0 },
      });
    }));
  it("a revised source invoice with no typed override is visible and conflicts while keeping payment facts", async () =>
    fixture(1, async (f) => {
      const repo = createNarApplyRepository({ sql: sql! }),
        p = await repo.preview(f.actor, { batchId: f.batchId, rowIds: f.rowIds, inputs: f.inputs }),
        j = await repo.execute(f.actor, {
          previewId: p.previewId,
          idempotencyKey: crypto.randomUUID(),
        });
      await runNarApplyChunk({ repository: repo, actor: f.actor, jobId: j.jobId });
      const staging = createNarImportRepository({ sql: sql! }),
        changed = await staging.stageBatch({
          ...f.stage,
          sourceSha256: crypto.randomUUID().replaceAll("-", "").repeat(2),
          read: {
            ...f.stage.read,
            rows: f.stage.read.rows.map((r) => ({
              ...r,
              invoice: { kind: "value" as const, raw: "REVISED-INV-B" },
            })),
          },
        });
      const [row] = await staging.listRows(changed.batch.id),
        reviewed = await repo.preview(f.actor, {
          batchId: changed.batch.id,
          rowIds: [row.id],
          inputs: { [row.id]: { acknowledgeDueDifference: true, acknowledgeSourceIssues: true } },
        });
      expect(reviewed.rows[0].conflicts).toContain(
        "source_invoice_change_requires_separate_review",
      );
      expect(reviewed.rows[0].sourceInvoiceDifference).toEqual({
        source: "REVISED-INV-B",
        existing: "DUPLICATE-INVOICE",
      });
      expect(
        (await sql!`select invoice_number from payments where company_id=${f.companies[0]}`)[0]
          .invoice_number,
      ).toBe("DUPLICATE-INVOICE");
    }));
  it("legacy unknown year needs attributed current-version Admin confirmation, not filename inference", async () =>
    fixture(1, async (f) => {
      await sql!`update nar_import_batches set return_year=null where id=${f.batchId}`;
      const staging = createNarImportRepository({ sql: sql! }),
        batch = await staging.getBatch(f.batchId),
        repo = createNarApplyRepository({ sql: sql! });
      expect(batch?.returnYear).toBeNull();
      const input = {
        batchId: f.batchId,
        expectedVersion: batch!.revision!,
        returnYear: 2025,
        reason: "Synthetic owner explicitly reviewed source year",
      };
      await expect(repo.confirmYear({ ...f.actor, authUserId: "foreign" }, input)).rejects.toThrow(
        /Forbidden/,
      );
      expect(await repo.confirmYear(f.actor, input)).toMatchObject({ confirmed: true });
      expect(await repo.confirmYear(f.actor, input)).toMatchObject({ confirmed: true });
      expect((await staging.getBatch(f.batchId))?.returnYear).toBe(2025);
      expect(
        (
          await sql!`select count(*)::int n from nar_batch_review_events where batch_id=${f.batchId}`
        )[0].n,
      ).toBe(1);
    }));
  it("an actually killed child process resumes durable rows without replaying a committed case", async () =>
    fixture(3, async (f) => {
      const repo = createNarApplyRepository({ sql: sql! }),
        p = await repo.preview(f.actor, { batchId: f.batchId, rowIds: f.rowIds, inputs: f.inputs }),
        j = await repo.execute(f.actor, {
          previewId: p.previewId,
          idempotencyKey: crypto.randomUUID(),
        });
      const child = spawn(
        "bun",
        [fileURLToPath(new URL("../../test/nar-apply-crash-child.ts", import.meta.url))],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            NAR_CRASH_JOB_ID: j.jobId,
            NAR_CRASH_ACTOR_JSON: JSON.stringify(f.actor),
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stderr = "",
        out = "";
      child.stderr.on("data", (data) => {
        stderr += String(data);
      });
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("Owned child did not reach commit checkpoint")),
            15000,
          );
          child.stdout.on("data", (data) => {
            out += String(data);
            if (out.includes("NAR_ITEM_COMMITTED")) {
              clearTimeout(timer);
              resolve();
            }
          });
          child.once("error", (error) => {
            clearTimeout(timer);
            reject(error);
          });
          child.once("exit", () => {
            clearTimeout(timer);
            if (!out.includes("NAR_ITEM_COMMITTED"))
              reject(new Error("Owned child exited before checkpoint: " + stderr.slice(0, 1000)));
          });
        });
        expect(child.pid).toBeGreaterThan(0);
        expect(child.kill("SIGKILL")).toBe(true);
        await exited;
        expect((await repo.getJob(f.actor, j.jobId)).counts).toMatchObject({
          applied: 1,
          pending: 2,
        });
        await runNarApplyChunk({
          repository: createNarApplyRepository({ sql: sql! }),
          actor: f.actor,
          jobId: j.jobId,
        });
        expect((await repo.getJob(f.actor, j.jobId)).counts.applied).toBe(3);
        expect(
          (await sql!`select count(*)::int n from nar_apply_journal where batch_id=${f.batchId}`)[0]
            .n,
        ).toBe(3);
      } finally {
        if (child.exitCode === null && !child.killed) {
          child.kill("SIGKILL");
          await exited;
        }
      }
    }));
});
