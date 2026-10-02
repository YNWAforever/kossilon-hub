import { afterAll, describe, expect, it } from "vitest";
import { createSqlClient } from "@/server/db/client";
import type { AuthenticatedActor } from "@/features/auth/types";
import { createBulkOperationsRepository } from "./repository";
import { runBulkAssignmentChunk } from "./worker";
import { MAINTENANCE_ACTIONS } from "./actions";
import { applyClientMaintenance } from "@/features/clients/maintenance";
import { ensureWorkItemForEvent } from "@/features/work-items/repository";

const url = process.env.TEST_DATABASE_URL;
const sql = url ? createSqlClient(url, { max: 3 }) : null;
afterAll(async () => {
  await sql?.end();
});
const team = "10000000-0000-0000-0000-000000000001";
const other = "10000000-0000-0000-0000-000000000002";
async function fixture(
  run: (f: { actor: AuthenticatedActor; ids: string[]; companies: string[] }) => Promise<void>,
) {
  const actorId = crypto.randomUUID();
  const actor: AuthenticatedActor = {
    userId: actorId,
    authUserId: `synthetic-actions-${actorId}`,
    role: "Manager",
    teamId: team,
    active: true,
  };
  const ids = Array.from({ length: 100 }, () => crypto.randomUUID());
  const companies = ids.map(() => crypto.randomUUID());
  await sql!.begin(async (tx) => {
    await tx`insert into users(id,name,email,role,team_id) values(${actorId},'Synthetic action manager',${actorId + "@example.test"},'Manager',${team})`;
    await tx`insert into staff_profiles(user_id,auth_user_id,role,team_id) values(${actorId},${actor.authUserId},'Manager',${team})`;
    await tx`insert into companies ${tx(companies.map((id, i) => ({ id, company_name: "Synthetic daily batch " + i, cr_number: id, br_number: id, incorporation_date: "2020-01-01", annual_return_basis_date: "2026-10-01", registered_office: "Test", company_secretary: "Test", status: "active", assigned_owner_id: actorId, assigned_team_id: i >= 70 && i < 80 ? other : team, data_origin: i >= 50 && i < 60 ? "fixture" : "client" })))}`;
    await tx`insert into annual_return_cases ${tx(ids.map((id, i) => ({ id, company_id: companies[i], return_year: 2026, made_up_date: "2026-10-01", filing_due_date: "2026-11-12", current_status: i >= 60 && i < 70 ? "Completed" : "Upcoming", risk_level: "green", owner_id: actorId, locked_at: i >= 80 && i < 90 ? new Date() : null, completed_at: i >= 60 && i < 70 ? new Date() : null })))}`;
    await tx`insert into annual_return_checklist_items ${tx(ids.slice(0, 95).map((id, i) => ({ case_id: id, item_label: "Synthetic missing evidence", required: true, status: (i >= 35 && i < 50) || (i >= 90 && i < 95) ? "Received" : "Missing", due_date: "2026-11-12" })))}`;
    await tx`insert into reminder_logs ${tx(ids.filter((_, i) => i < 25 || i >= 35).map((id) => ({ case_id: id, template_label: "Synthetic historic recipient only", recipient_name: "Synthetic recipient", recipient_phone: "+85255551234", draft_body: "Local fixture; never dispatched", recorded_sent_at: new Date(), staff_actor_id: actorId, note: "Synthetic local-only fixture" })))}`;
  });
  try {
    await run({ actor, ids, companies });
  } finally {
    await sql!.begin(async (tx) => {
      await tx`delete from bulk_operation_job_items where job_id in(select id from bulk_operation_jobs where actor_user_id=${actorId})`;
      await tx`delete from bulk_operation_jobs where actor_user_id=${actorId}`;
      await tx`delete from bulk_operation_previews where actor_user_id=${actorId}`;
      await tx`delete from bulk_selection_snapshots where actor_user_id=${actorId}`;
      await tx`delete from assignment_events where work_item_id in(select id from work_items where company_id=any(${companies}::uuid[]))`;
      await tx`delete from work_items where company_id=any(${companies}::uuid[])`;
      await tx`delete from timeline_events where company_id=any(${companies}::uuid[])`;
      await tx`delete from annual_return_audit_events where case_id=any(${ids}::uuid[])`;
      await tx`delete from annual_return_cases where id=any(${ids}::uuid[])`;
      await tx`delete from companies where id=any(${companies}::uuid[])`;
      await tx`delete from staff_profiles where user_id=${actorId}`;
      await tx`delete from users where id=${actorId}`;
    });
  }
}
describe.skipIf(!url)("actual PostgreSQL daily maintenance actions", () => {
  it("an Admin team move refuses active cases whose existing owners would become inconsistent", async () =>
    fixture(async (f) => {
      const owner = crypto.randomUUID();
      await sql!.begin(async (tx) => {
        await tx`update users set role='Admin' where id=${f.actor.userId!}`;
        await tx`update staff_profiles set role='Admin' where user_id=${f.actor.userId!}`;
        await tx`insert into users(id,name,email,role,team_id) values(${owner},'Synthetic target team owner',${owner + "@example.test"},'Staff',${other})`;
        await tx`insert into staff_profiles(user_id,auth_user_id,role,team_id) values(${owner},${"synthetic-target-" + owner},'Staff',${other})`;
      });
      try {
        const p = await createBulkOperationsRepository({ sql: sql! }).previewAction(
          { ...f.actor, role: "Admin" },
          {
            resource: "client_company",
            selection: { mode: "explicit_ids", ids: [f.companies[0]] },
            action: { kind: "client_maintenance", ownerId: owner, teamId: other },
          },
        );
        expect(p).toMatchObject({ eligibleCount: 0, reasons: { locked: 1 } });
      } finally {
        await sql!.begin(async (tx) => {
          await tx`delete from staff_profiles where user_id=${owner}`;
          await tx`delete from users where id=${owner}`;
        });
      }
    }));
  it("document assignment reuses linked case and child work audit, then a replacement invalidates the old preview", async () =>
    fixture(async (f) => {
      const assignee = crypto.randomUUID(),
        doc = crypto.randomUUID(),
        version = crypto.randomUUID();
      await sql!.begin(async (tx) => {
        await tx`insert into users(id,name,email,role,team_id) values(${assignee},'Synthetic document assignee',${assignee + "@example.test"},'Staff',${team})`;
        await tx`insert into staff_profiles(user_id,auth_user_id,role,team_id) values(${assignee},${"synthetic-doc-" + assignee},'Staff',${team})`;
        await tx`insert into documents(id,company_id,case_id,file_type,file_name,storage_url,upload_source) values(${doc},${f.companies[0]},${f.ids[0]},'registry','Synthetic doc assignment.pdf','private/synthetic-assignment','staff')`;
        await tx`insert into document_versions(id,document_id,version_number,file_name,storage_url) values(${version},${doc},1,'Synthetic doc assignment.pdf','private/synthetic-assignment')`;
        await ensureWorkItemForEvent(tx, {
          companyId: f.companies[0],
          caseType: "annual_return",
          annualReturnCaseId: f.ids[0],
          sourceEventKey: "synthetic-" + doc,
          sourceEventType: "test",
          workType: "annual_return_case",
          title: "Synthetic document work",
          teamId: team,
        });
      });
      try {
        const repo = createBulkOperationsRepository({ sql: sql! });
        const input = {
          resource: "document" as const,
          selection: { mode: "explicit_ids" as const, ids: [doc] },
          action: {
            kind: "document_assignment" as const,
            target: "owner" as const,
            assigneeId: assignee,
          },
        };
        const p = await repo.previewAction(f.actor, input);
        expect(p.eligibleCount).toBe(1);
        const j = await repo.execute(f.actor, {
          previewId: p.previewId,
          idempotencyKey: crypto.randomUUID(),
        });
        await runBulkAssignmentChunk({ repository: repo, actor: f.actor, jobId: j.jobId });
        const [arc] = await sql!`select owner_id from annual_return_cases where id=${f.ids[0]}`;
        expect(arc.owner_id).toBe(assignee);
        const [audit] =
          await sql!`select count(*)::int n from assignment_events where work_item_id in(select id from work_items where annual_return_case_id=${f.ids[0]}) and assigned_by_id=${f.actor.userId!}`;
        expect(audit.n).toBe(1);
        const old = await repo.previewAction(f.actor, input);
        await sql!`update documents set file_name='Replacement changed metadata.pdf' where id=${doc}`;
        const stale = await repo.execute(f.actor, {
          previewId: old.previewId,
          idempotencyKey: crypto.randomUUID(),
        });
        await runBulkAssignmentChunk({ repository: repo, actor: f.actor, jobId: stale.jobId });
        expect((await repo.getJob(f.actor, { jobId: stale.jobId })).counts.conflict).toBe(1);
      } finally {
        await sql!.begin(async (tx) => {
          await tx`delete from assignment_events where work_item_id in(select id from work_items where annual_return_case_id=${f.ids[0]})`;
          await tx`delete from work_items where annual_return_case_id=${f.ids[0]}`;
          await tx`update annual_return_cases set owner_id=${f.actor.userId!} where id=${f.ids[0]}`;
          await tx`delete from documents where id=${doc}`;
          await tx`delete from staff_profiles where user_id=${assignee}`;
          await tx`delete from users where id=${assignee}`;
        });
      }
    }));
  it("draft crash resumes durable output; retries only rolled-back SQL failures and refuses unknown outcomes", async () =>
    fixture(async (f) => {
      const repo = createBulkOperationsRepository({ sql: sql! });
      const original = MAINTENANCE_ACTIONS.follow_up_draft.apply;
      let fault: "rollback" | "unknown" | null = "rollback";
      MAINTENANCE_ACTIONS.follow_up_draft.apply = async (context, prepared) => {
        const error = fault;
        fault = null;
        if (error === "rollback")
          await context.db.unsafe(
            "do $$ begin raise exception using errcode='40001',message='Synthetic local maintenance serialization'; end $$;",
          );
        if (error === "unknown")
          throw Object.assign(new Error("Synthetic unknown SQL transport"), { code: "ECONNRESET" });
        return original(context, prepared);
      };
      try {
        const p = await repo.previewAction(f.actor, {
          resource: "annual_return_case",
          selection: { mode: "explicit_ids", ids: f.ids.slice(0, 3) },
          action: { kind: "follow_up_draft" },
        });
        const j = await repo.execute(f.actor, {
          previewId: p.previewId,
          idempotencyKey: crypto.randomUUID(),
        });
        await runBulkAssignmentChunk({ repository: repo, actor: f.actor, jobId: j.jobId });
        expect((await repo.getJob(f.actor, { jobId: j.jobId })).counts).toMatchObject({
          failed: 1,
          succeeded: 2,
        });
        expect(await repo.retryFailed(f.actor, j.jobId)).toEqual({ retryCount: 1 });
        await runBulkAssignmentChunk({ repository: repo, actor: f.actor, jobId: j.jobId });
        expect((await repo.getJob(f.actor, { jobId: j.jobId })).counts.succeeded).toBe(3);
        fault = "unknown";
        const p2 = await repo.previewAction(f.actor, {
          resource: "annual_return_case",
          selection: { mode: "explicit_ids", ids: f.ids.slice(3, 5) },
          action: { kind: "follow_up_draft" },
        });
        const j2 = await repo.execute(f.actor, {
          previewId: p2.previewId,
          idempotencyKey: crypto.randomUUID(),
        });
        await expect(
          runBulkAssignmentChunk({
            repository: repo,
            actor: f.actor,
            jobId: j2.jobId,
            afterCommit: () => {
              throw new Error("Synthetic after-commit crash");
            },
          }),
        ).rejects.toThrow("after-commit crash");
        await sql!`update bulk_operation_jobs set lease_until=now()-interval '1 second' where id=${j2.jobId}`;
        await runBulkAssignmentChunk({
          repository: createBulkOperationsRepository({ sql: sql! }),
          actor: f.actor,
          jobId: j2.jobId,
        });
        expect((await repo.getJob(f.actor, { jobId: j2.jobId })).counts).toMatchObject({
          unknown: 1,
          succeeded: 1,
        });
        expect(await repo.retryFailed(f.actor, j2.jobId)).toEqual({ retryCount: 0 });
        expect(await repo.reconcileUnknown(f.actor, j2.jobId)).toEqual({ reconciledCount: 0 });
      } finally {
        MAINTENANCE_ACTIONS.follow_up_draft.apply = original;
      }
    }));
  it("the registry declares permission/preview/current validation/apply and safe retry for all six actions", () => {
    expect(Object.keys(MAINTENANCE_ACTIONS)).toHaveLength(6);
    for (const action of Object.values(MAINTENANCE_ACTIONS)) {
      for (const name of ["permission", "preview", "validateCurrent", "apply"] as const)
        expect(typeof action[name]).toBe("function");
      expect(action.retryPolicy).toBe("rolled_back_transaction_only");
    }
  });
  it("changed template invalidates the saved follow-up draft without changing any receipt", async () =>
    fixture(async (f) => {
      const [original] =
        await sql!`select * from whatsapp_templates where template_name='annual_return_manual_reminder' and language_code='en'`;
      const id = original?.id ?? crypto.randomUUID();
      if (!original)
        await sql!`insert into whatsapp_templates(id,template_name,language_code,category,body) values(${id},'annual_return_manual_reminder','en','annual_return','Synthetic local template A')`;
      try {
        const repo = createBulkOperationsRepository({ sql: sql! });
        const p = await repo.previewAction(f.actor, {
          resource: "annual_return_case",
          selection: { mode: "explicit_ids", ids: [f.ids[0]] },
          action: { kind: "follow_up_draft" },
        });
        await sql!`update whatsapp_templates set body='Synthetic local changed template',updated_at=clock_timestamp() where id=${id}`;
        const j = await repo.execute(f.actor, {
          previewId: p.previewId,
          idempotencyKey: crypto.randomUUID(),
        });
        await runBulkAssignmentChunk({ repository: repo, actor: f.actor, jobId: j.jobId });
        expect((await repo.getJob(f.actor, { jobId: j.jobId })).counts.conflict).toBe(1);
      } finally {
        if (original)
          await sql!`update whatsapp_templates set body=${original.body},updated_at=${original.updated_at} where id=${id}`;
        else await sql!`delete from whatsapp_templates where id=${id}`;
      }
    }));
  it("return drafts need individual reasons and current UUID; metadata exports disclose unknown safety and never release bytes", async () =>
    fixture(async (f) => {
      const docs = [crypto.randomUUID(), crypto.randomUUID()],
        versions = docs.map(() => crypto.randomUUID());
      await sql!.begin(async (tx) => {
        for (let i = 0; i < docs.length; i++) {
          await tx`insert into documents(id,company_id,case_id,file_type,file_name,storage_url,upload_source,uploaded_by) values(${docs[i]},${f.companies[i]},${f.ids[i]},'registry','Synthetic unknown-safety.pdf',${"private/synthetic/" + docs[i]},'staff',${f.actor.userId!})`;
          await tx`insert into document_versions(id,document_id,version_number,file_name,storage_url,uploaded_by) values(${versions[i]},${docs[i]},1,'Synthetic unknown-safety.pdf',${"private/synthetic/" + docs[i]},${f.actor.userId!})`;
        }
      });
      try {
        const repo = createBulkOperationsRepository({ sql: sql! });
        const p = await repo.previewAction(f.actor, {
          resource: "document",
          selection: { mode: "explicit_ids", ids: docs },
          action: {
            kind: "document_return_draft",
            reasons: { [docs[0]]: "Please supply a readable registry copy" },
          },
        });
        expect(p).toMatchObject({ eligibleCount: 1, reasons: { failed: 1 } });
        const j = await repo.execute(f.actor, {
          previewId: p.previewId,
          idempotencyKey: crypto.randomUUID(),
        });
        await runBulkAssignmentChunk({ repository: repo, actor: f.actor, jobId: j.jobId });
        const result = await repo.getJob(f.actor, { jobId: j.jobId });
        expect(result.items.find((i) => i.state === "succeeded")?.output).toMatchObject({
          kind: "document_return_draft",
          expectedVersionId: versions[0],
          reason: "Please supply a readable registry copy",
          status: "draft",
          approvalRequired: true,
        });
        const [unchanged] =
          await sql!`select verification_status,reviewed_document_version_id from documents where id=${docs[0]}`;
        expect(unchanged).toMatchObject({
          verification_status: "pending",
          reviewed_document_version_id: null,
        });
        const exported = await repo.previewAction(f.actor, {
          resource: "document",
          selection: { mode: "explicit_ids", ids: docs },
          action: { kind: "document_list_export" },
        });
        const exportJob = await repo.execute(f.actor, {
          previewId: exported.previewId,
          idempotencyKey: crypto.randomUUID(),
        });
        await runBulkAssignmentChunk({ repository: repo, actor: f.actor, jobId: exportJob.jobId });
        const saved = await repo.getJob(f.actor, { jobId: exportJob.jobId });
        expect(saved.counts.succeeded).toBe(2);
        expect(
          saved.items.every(
            (i) => i.output?.storageChecked === false && i.output?.scanVerdictSource === null,
          ),
        ).toBe(true);
        expect(JSON.stringify(saved)).not.toContain("private/synthetic");
      } finally {
        await sql!`delete from documents where id=any(${docs}::uuid[])`;
      }
    }));
  it("single and bulk client maintenance share the current company write and reject an inconsistent owner/team", async () =>
    fixture(async (f) => {
      const repo = createBulkOperationsRepository({ sql: sql! });
      const p = await repo.previewAction(f.actor, {
        resource: "client_company",
        selection: { mode: "explicit_ids", ids: [f.companies[0]] },
        action: { kind: "client_maintenance", ownerId: f.actor.userId!, teamId: other },
      });
      expect(p.eligibleCount).toBe(0);
      const good = await repo.previewAction(f.actor, {
        resource: "client_company",
        selection: { mode: "explicit_ids", ids: [f.companies[0]] },
        action: { kind: "client_maintenance", ownerId: f.actor.userId!, teamId: team },
      });
      const j = await repo.execute(f.actor, {
        previewId: good.previewId,
        idempotencyKey: crypto.randomUUID(),
      });
      await runBulkAssignmentChunk({ repository: repo, actor: f.actor, jobId: j.jobId });
      expect((await repo.getJob(f.actor, { jobId: j.jobId })).counts.succeeded).toBe(1);
      const [r] =
        await sql!`select md5(to_jsonb(c)::text) version from companies c where id=${f.companies[1]}`;
      await sql!.begin((tx) =>
        applyClientMaintenance(
          tx,
          f.actor,
          f.companies[1],
          { ownerId: f.actor.userId!, teamId: team },
          r.version,
        ),
      );
      const [current] =
        await sql!`select assigned_team_id,assigned_owner_id,company_name from companies where id=${f.companies[1]}`;
      expect(current).toMatchObject({
        assigned_team_id: team,
        assigned_owner_id: f.actor.userId!,
        company_name: "Synthetic daily batch 1",
      });
    }));
  it("payment reconciliation list preserves pending status and paid_at; cancellation preserves completed output", async () =>
    fixture(async (f) => {
      await sql!`insert into payments(company_id,case_id,invoice_number,amount,due_date) values(${f.companies[0]},${f.ids[0]},'Synthetic local invoice',1200,'2026-11-12')`;
      const repo = createBulkOperationsRepository({ sql: sql! });
      const p = await repo.previewAction(f.actor, {
        resource: "annual_return_case",
        selection: { mode: "explicit_ids", ids: [f.ids[0]] },
        action: { kind: "payment_list_export" },
      });
      const j = await repo.execute(f.actor, {
        previewId: p.previewId,
        idempotencyKey: crypto.randomUUID(),
      });
      await runBulkAssignmentChunk({ repository: repo, actor: f.actor, jobId: j.jobId });
      expect((await repo.getJob(f.actor, { jobId: j.jobId })).items[0].output).toMatchObject({
        status: "Payment pending",
        paidAt: null,
        approvalPerformed: false,
      });
      const [pay] = await sql!`select status,paid_at from payments where case_id=${f.ids[0]}`;
      expect(pay).toMatchObject({ status: "Payment pending", paid_at: null });
      const drafts = await repo.previewAction(f.actor, {
        resource: "annual_return_case",
        selection: { mode: "explicit_ids", ids: f.ids.slice(0, 3) },
        action: { kind: "follow_up_draft" },
      });
      const draftJob = await repo.execute(f.actor, {
        previewId: drafts.previewId,
        idempotencyKey: crypto.randomUUID(),
      });
      await runBulkAssignmentChunk({
        repository: repo,
        actor: f.actor,
        jobId: draftJob.jobId,
        chunkSize: 1,
      });
      expect(await repo.cancel(f.actor, draftJob.jobId)).toEqual({ cancelledCount: 2 });
      const cancelled = await repo.getJob(f.actor, { jobId: draftJob.jobId });
      expect(cancelled.counts).toMatchObject({ succeeded: 1, cancelled: 2 });
      expect(cancelled.items.find((i) => i.state === "succeeded")?.output?.status).toBe("draft");
    }));
  it(
    "100 cases create only 25 genuine missing-evidence drafts; no outbox, sends or approvals",
    async () =>
      fixture(async (f) => {
        const repo = createBulkOperationsRepository({ sql: sql! });
        const preview = await repo.previewAction(f.actor, {
          resource: "annual_return_case",
          selection: { mode: "explicit_ids", ids: f.ids },
          action: { kind: "follow_up_draft" },
        });
        expect(preview).toMatchObject({ count: 100, eligibleCount: 25 });
        const input = { previewId: preview.previewId, idempotencyKey: crypto.randomUUID() };
        const job = await repo.execute(f.actor, input);
        expect(await repo.execute(f.actor, input)).toMatchObject({ jobId: job.jobId });
        await runBulkAssignmentChunk({
          repository: repo,
          actor: f.actor,
          jobId: job.jobId,
          chunkSize: 100,
        });
        const result = await repo.getJob(f.actor, { jobId: job.jobId, limit: 100 });
        expect(result.counts.succeeded).toBe(25);
        expect(
          result.items
            .filter((i) => i.state === "succeeded")
            .every((i) => i.output?.kind === "follow_up_draft" && i.output?.status === "draft"),
        ).toBe(true);
        const [messages] =
          await sql!`select count(*)::int n from whatsapp_messages where case_id=any(${f.ids}::uuid[])`;
        expect(messages.n).toBe(0);
        const [reminders] =
          await sql!`select count(*)::int n from reminder_logs where case_id=any(${f.ids}::uuid[])`;
        expect(reminders.n).toBe(90);
        expect(await repo.retryFailed(f.actor, job.jobId)).toEqual({ retryCount: 0 });
      }),
    30000,
  );
  it("changed checklist or template makes a saved draft preview conflict, without queueing", async () =>
    fixture(async (f) => {
      const repo = createBulkOperationsRepository({ sql: sql! });
      const p = await repo.previewAction(f.actor, {
        resource: "annual_return_case",
        selection: { mode: "explicit_ids", ids: f.ids.slice(0, 2) },
        action: { kind: "follow_up_draft" },
      });
      await sql!`update annual_return_checklist_items set item_label='Changed requirement',updated_at=clock_timestamp() where case_id=${f.ids[0]}`;
      const j = await repo.execute(f.actor, {
        previewId: p.previewId,
        idempotencyKey: crypto.randomUUID(),
      });
      await runBulkAssignmentChunk({ repository: repo, actor: f.actor, jobId: j.jobId });
      expect((await repo.getJob(f.actor, { jobId: j.jobId })).counts).toMatchObject({
        conflict: 1,
        succeeded: 1,
      });
    }));
  it("client maintenance rechecks owner/team consistency, version and current visibility", async () =>
    fixture(async (f) => {
      const repo = createBulkOperationsRepository({ sql: sql! });
      const p = await repo.previewAction(f.actor, {
        resource: "client_company",
        selection: { mode: "explicit_ids", ids: [f.companies[0], f.companies[70]] },
        action: { kind: "client_maintenance", ownerId: f.actor.userId!, teamId: team },
      });
      expect(p).toMatchObject({ eligibleCount: 1, reasons: { forbidden: 1 } });
      const j = await repo.execute(f.actor, {
        previewId: p.previewId,
        idempotencyKey: crypto.randomUUID(),
      });
      await sql!`update companies set assigned_team_id=${other},updated_at=clock_timestamp() where id=${f.companies[0]}`;
      await runBulkAssignmentChunk({ repository: repo, actor: f.actor, jobId: j.jobId });
      const result = await repo.getJob(f.actor, { jobId: j.jobId });
      expect(result.counts.forbidden).toBe(2);
      expect(result.items.every((i) => i.resourceId === null && i.output === null)).toBe(true);
    }));
});
