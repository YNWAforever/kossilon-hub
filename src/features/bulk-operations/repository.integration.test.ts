import { afterAll, describe, expect, it } from "vitest";
import { createSqlClient } from "@/server/db/client";
import type { AuthenticatedActor } from "@/features/auth/types";
import { createBulkOperationsRepository } from "./repository";
import { runBulkAssignmentChunk, runScheduledBulkAssignments } from "./worker";
import { applyAssignment } from "./assignment-adapter";
import { ensureWorkItemForEvent } from "@/features/work-items/repository";
import { createAnnualReturnRepository } from "@/features/annual-return/repository";
const url = process.env.TEST_DATABASE_URL,
  sql = url ? createSqlClient(url, { max: 4 }) : null;
afterAll(async () => {
  await sql?.end();
});
const team = "10000000-0000-0000-0000-000000000001",
  other = "10000000-0000-0000-0000-000000000002";
async function fixture(
  n: number,
  run: (f: {
    actor: AuthenticatedActor;
    assigneeId: string;
    caseIds: string[];
    companyId: string;
    foreignCompanyId: string;
  }) => Promise<void>,
  partial = false,
) {
  const actorId = crypto.randomUUID(),
    assigneeId = crypto.randomUUID(),
    ownerId = crypto.randomUUID(),
    companyId = crypto.randomUUID(),
    foreignCompanyId = crypto.randomUUID();
  const actor: AuthenticatedActor = {
    userId: actorId,
    authUserId: `synthetic-bulk-${actorId}`,
    role: "Manager",
    teamId: team,
    active: true,
  };
  const caseIds = Array.from({ length: n }, () => crypto.randomUUID());
  const companyIds = [
    companyId,
    ...Array.from({ length: Math.ceil(n / 70) - 1 }, () => crypto.randomUUID()),
  ];
  await sql!.begin(async (tx) => {
    for (const [id, role] of [
      [actorId, "Manager"],
      [assigneeId, "Staff"],
      [ownerId, "Staff"],
    ] as const) {
      await tx`insert into users(id,name,email,role,team_id,active) values(${id},'Synthetic bulk staff',${id + "@example.test"},${role},${team},true)`;
      await tx`insert into staff_profiles(user_id,auth_user_id,role,team_id,active) values(${id},${id === actorId ? actor.authUserId : `synthetic-bulk-${id}`},${role},${team},true)`;
    }
    for (const id of [...companyIds, foreignCompanyId])
      await tx`insert into companies(id,company_name,cr_number,br_number,incorporation_date,annual_return_basis_date,registered_office,company_secretary,status,assigned_owner_id,assigned_team_id) values(${id},${id !== foreignCompanyId ? "Synthetic scoped bulk company" : "Private foreign company"},${id},${id},'2020-01-01','2026-01-01','Test','Test','active',${ownerId},${id === foreignCompanyId ? other : team})`;
    const rows = caseIds.map((id, i) => ({
      id,
      company_id: partial && i >= 95 ? foreignCompanyId : companyIds[Math.floor(i / 70)],
      return_year: 2026 + (i % 70),
      made_up_date: "2026-10-01",
      filing_due_date: "2026-11-12",
      current_status: partial && i >= 90 && i < 95 ? "Completed" : "Upcoming",
      risk_level: "green",
      owner_id: ownerId,
      locked_at: partial && i >= 90 && i < 95 ? new Date() : null,
      completed_at: partial && i >= 90 && i < 95 ? new Date() : null,
    }));
    await tx`insert into annual_return_cases ${tx(rows)}`;
  });
  try {
    await run({ actor, assigneeId, caseIds, companyId, foreignCompanyId });
  } finally {
    await sql!.begin(async (tx) => {
      const own = [actorId, assigneeId, ownerId];
      await tx`delete from assignment_events where work_item_id in(select id from work_items where annual_return_case_id=any(${caseIds}::uuid[]))`;
      await tx`delete from work_items where annual_return_case_id=any(${caseIds}::uuid[])`;
      await tx`delete from staff_skills where staff_profile_id in(select id from staff_profiles where user_id=any(${own}::uuid[]))`;
      await tx`delete from bulk_operation_job_items where job_id in(select id from bulk_operation_jobs where actor_user_id=${actorId})`;
      await tx`delete from bulk_operation_jobs where actor_user_id=${actorId}`;
      await tx`delete from bulk_operation_previews where actor_user_id=${actorId}`;
      await tx`delete from bulk_selection_snapshots where actor_user_id=${actorId}`;
      await tx`delete from annual_return_audit_events where case_id=any(${caseIds}::uuid[])`;
      await tx`delete from timeline_events where case_id=any(${caseIds}::uuid[])`;
      await tx`delete from annual_return_cases where id=any(${caseIds}::uuid[])`;
      await tx`delete from companies where id=any(${[...companyIds, foreignCompanyId]}::uuid[])`;
      await tx`delete from staff_profiles where user_id=any(${own}::uuid[])`;
      await tx`delete from users where id=any(${own}::uuid[])`;
    });
  }
}
describe.skipIf(!url)("actual PostgreSQL resumable bulk assignments", () => {
  it("rechecks single-case permission after an observed concurrent profile team move", async () =>
    fixture(1, async (f) => {
      const changing = createSqlClient(url!, { max: 1 }),
        assigning = createSqlClient(url!, { max: 1 });
      let release!: () => void;
      const hold = new Promise<void>((r) => {
        release = r;
      });
      let ready!: () => void;
      const changed = new Promise<void>((r) => {
        ready = r;
      });
      const [a] = await changing`select pg_backend_pid() pid`,
        [b] = await assigning`select pg_backend_pid() pid`;
      expect(a.pid).not.toBe(b.pid);
      const mutation = changing.begin(async (tx) => {
        await tx`update users set role='Staff',team_id=${other} where id=${f.actor.userId!}`;
        await tx`update staff_profiles set role='Staff',team_id=${other} where user_id=${f.actor.userId!}`;
        ready();
        await hold;
      });
      await Promise.race([changed, mutation]);
      const assignment = createAnnualReturnRepository({ sql: assigning }).assignOwner({
        caseId: f.caseIds[0],
        actorId: f.actor.userId!,
        ownerId: f.assigneeId,
      });
      const settled = Promise.allSettled([mutation, assignment]);
      let waited = false;
      try {
        for (let n = 0; n < 100; n++) {
          const [state] =
            await sql!`select wait_event_type from pg_stat_activity where pid=${b.pid}`;
          if (state?.wait_event_type === "Lock") {
            waited = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 20));
        }
      } finally {
        release();
      }
      try {
        const results = await settled;
        expect(waited).toBe(true);
        expect(results[1]).toMatchObject({
          status: "rejected",
          reason: expect.objectContaining({
            message: expect.stringMatching(/Only assigned staff/),
          }),
        });
        const [audit] =
          await sql!`select count(*)::int n from annual_return_audit_events where case_id=${f.caseIds[0]}`;
        expect(audit.n).toBe(0);
      } finally {
        release();
        await settled;
        await Promise.all([changing.end(), assigning.end()]);
      }
    }));
  it("queue snapshot excludes archived statuses while result reads retain completed work", async () =>
    fixture(1, async (f) => {
      await sql!.begin(async (tx) => {
        for (const status of ["open", "in_progress", "blocked", "completed", "cancelled"]) {
          const w = await ensureWorkItemForEvent(tx, {
            companyId: f.companyId,
            caseType: "annual_return",
            annualReturnCaseId: f.caseIds[0],
            sourceEventKey: crypto.randomUUID(),
            sourceEventType: "test",
            workType: "annual_return_case",
            title: "Queue scope test",
            teamId: team,
          });
          await tx`update work_items set status=${status},completed_at=case when ${status}='completed' then now() else null end where id=${w.id}`;
        }
      });
      const repo = createBulkOperationsRepository({ sql: sql! });
      expect(
        (
          await repo.createSnapshot(f.actor, {
            resource: "work_item",
            filters: { q: "Queue scope test", view: "team", activeOnly: true },
          })
        ).count,
      ).toBe(3);
      const [closed] =
        await sql!`select id from work_items where annual_return_case_id=${f.caseIds[0]} and status='completed'`;
      const p = await repo.preview(f.actor, {
        resource: "work_item",
        selection: { mode: "explicit_ids", ids: [closed.id] },
        assignment: { target: "owner", assigneeId: f.assigneeId },
      });
      const j = await repo.execute(f.actor, {
        previewId: p.previewId,
        idempotencyKey: crypto.randomUUID(),
      });
      expect((await repo.getJob(f.actor, { jobId: j.jobId })).items[0]).toMatchObject({
        resourceId: closed.id,
        state: "locked",
      });
    }));
  it("recovers an older actionable job after twenty newer approvals through cursor history", async () =>
    fixture(1, async (f) => {
      const repo = createBulkOperationsRepository({ sql: sql! });
      const p = await repo.preview(f.actor, {
        resource: "annual_return_case",
        selection: { mode: "explicit_ids", ids: f.caseIds },
        assignment: { target: "owner", assigneeId: f.assigneeId },
      });
      const oldest = await repo.execute(f.actor, {
        previewId: p.previewId,
        idempotencyKey: crypto.randomUUID(),
      });
      for (let i = 0; i < 20; i++)
        await repo.execute(f.actor, {
          previewId: p.previewId,
          idempotencyKey: crypto.randomUUID(),
        });
      const page = await repo.listJobs(f.actor, {});
      expect(page.jobs).toHaveLength(20);
      expect(page.nextCursor).toBeTruthy();
      const older = await repo.listJobs(f.actor, { cursor: page.nextCursor! });
      expect(older.jobs.map((j) => j.jobId)).toEqual([oldest.jobId]);
      await runBulkAssignmentChunk({
        repository: repo,
        actor: f.actor,
        jobId: older.jobs[0].jobId,
      });
      expect((await repo.getJob(f.actor, { jobId: oldest.jobId })).counts.succeeded).toBe(1);
    }));
  it("single and bulk case assignment preserve separation for every active child work item", async () =>
    fixture(1, async (f) => {
      await sql!.begin(async (tx) => {
        await ensureWorkItemForEvent(tx, {
          companyId: f.companyId,
          caseType: "annual_return",
          annualReturnCaseId: f.caseIds[0],
          sourceEventKey: crypto.randomUUID(),
          sourceEventType: "test",
          workType: "annual_return_case",
          title: "Child task",
          reviewerId: f.assigneeId,
          teamId: team,
        });
      });
      const repo = createBulkOperationsRepository({ sql: sql! });
      const p = await repo.preview(f.actor, {
        resource: "annual_return_case",
        selection: { mode: "explicit_ids", ids: f.caseIds },
        assignment: { target: "owner", assigneeId: f.assigneeId },
      });
      expect(p.reasons.failed).toBe(1);
      await expect(
        createAnnualReturnRepository({ sql: sql! }).assignOwner({
          caseId: f.caseIds[0],
          ownerId: f.assigneeId,
          actorId: f.actor.userId!,
        }),
      ).rejects.toThrow(/Owner and reviewer/);
      const [audit] =
        await sql!`select count(*)::int n from assignment_events where work_item_id in(select id from work_items where annual_return_case_id=${f.caseIds[0]})`;
      expect(audit.n).toBe(0);
    }));
  it("work-item reviewer batches reuse single assignment eligibility, version and attributed audit", async () =>
    fixture(1, async (f) => {
      const item = await sql!.begin(async (tx) => {
        await tx`insert into staff_skills(staff_profile_id,skill_key,proficiency) select id,'annual_returns',5 from staff_profiles where user_id=${f.assigneeId}`;
        return ensureWorkItemForEvent(tx, {
          companyId: f.companyId,
          caseType: "annual_return",
          annualReturnCaseId: f.caseIds[0],
          sourceEventKey: crypto.randomUUID(),
          sourceEventType: "test",
          workType: "annual_return_case",
          requiredSkillKey: "annual_returns",
          title: "Reviewer task",
          teamId: team,
        });
      });
      const repo = createBulkOperationsRepository({ sql: sql! });
      const snapshot = await repo.createSnapshot(f.actor, {
        resource: "work_item",
        filters: { q: "Synthetic scoped bulk company", workStatus: "open", view: "team" },
      });
      expect(snapshot.count).toBe(1);
      const p = await repo.preview(f.actor, {
        resource: "work_item",
        selection: { mode: "filtered_snapshot", snapshotId: snapshot.snapshotId, excludedIds: [] },
        assignment: { target: "reviewer", assigneeId: f.assigneeId },
      });
      expect(p.eligibleCount).toBe(1);
      const j = await repo.execute(f.actor, {
        previewId: p.previewId,
        idempotencyKey: crypto.randomUUID(),
      });
      await runBulkAssignmentChunk({ repository: repo, actor: f.actor, jobId: j.jobId });
      const [work] = await sql!`select reviewer_id,version from work_items where id=${item.id}`;
      expect(work).toMatchObject({ reviewer_id: f.assigneeId, version: item.version + 1 });
      const [audit] =
        await sql!`select count(*)::int n from assignment_events where work_item_id=${item.id} and assigned_by_id=${f.actor.userId!} and recommendation_factors->>'assignmentTarget'='reviewer'`;
      expect(audit.n).toBe(1);
    }));
  it("background chunks reuse durable per-item checks and refuse a revoked actor", async () =>
    fixture(3, async (f) => {
      const repo = createBulkOperationsRepository({ sql: sql! });
      const p = await repo.preview(f.actor, {
        resource: "annual_return_case",
        selection: { mode: "explicit_ids", ids: f.caseIds },
        assignment: { target: "owner", assigneeId: f.assigneeId },
      });
      const j = await repo.execute(f.actor, {
        previewId: p.previewId,
        idempotencyKey: crypto.randomUUID(),
      });
      expect(await runScheduledBulkAssignments({ repository: repo, chunkSize: 1 })).toEqual({
        jobs: 1,
        processed: 1,
      });
      await sql!`update staff_profiles set active=false where user_id=${f.actor.userId!}`;
      expect(await runScheduledBulkAssignments({ repository: repo })).toEqual({
        jobs: 1,
        processed: 2,
      });
      const counts =
        await sql!`select state,count(*)::int n from bulk_operation_job_items where job_id=${j.jobId} group by state`;
      expect(Object.fromEntries(counts.map((r) => [r.state, r.n]))).toEqual({
        succeeded: 1,
        forbidden: 2,
      });
      const [audit] =
        await sql!`select count(*)::int n from annual_return_audit_events where case_id=any(${f.caseIds}::uuid[])`;
      expect(audit.n).toBe(1);
      expect(await runScheduledBulkAssignments({ repository: repo })).toEqual({
        jobs: 0,
        processed: 0,
      });
    }));
  it("cancelling a finished job preserves its completed state and reports zero cancelled", async () =>
    fixture(1, async (f) => {
      const repo = createBulkOperationsRepository({ sql: sql! });
      const p = await repo.preview(f.actor, {
        resource: "annual_return_case",
        selection: { mode: "explicit_ids", ids: f.caseIds },
        assignment: { target: "owner", assigneeId: f.assigneeId },
      });
      const j = await repo.execute(f.actor, {
        previewId: p.previewId,
        idempotencyKey: crypto.randomUUID(),
      });
      await runBulkAssignmentChunk({ repository: repo, actor: f.actor, jobId: j.jobId });
      expect(await repo.cancel(f.actor, j.jobId)).toEqual({ cancelledCount: 0 });
      expect((await repo.getJob(f.actor, { jobId: j.jobId })).state).toBe("completed");
    }));
  it("rechecks a Manager's changed team after preview, with zero case writes", async () =>
    fixture(5, async (f) => {
      const repo = createBulkOperationsRepository({ sql: sql! });
      const p = await repo.preview(f.actor, {
        resource: "annual_return_case",
        selection: { mode: "explicit_ids", ids: f.caseIds },
        assignment: { target: "owner", assigneeId: f.assigneeId },
      });
      const j = await repo.execute(f.actor, {
        previewId: p.previewId,
        idempotencyKey: crypto.randomUUID(),
      });
      await sql!.begin(async (tx) => {
        await tx`update users set team_id=${other} where id=${f.actor.userId!}`;
        await tx`update staff_profiles set team_id=${other} where user_id=${f.actor.userId!}`;
      });
      await runBulkAssignmentChunk({ repository: repo, actor: f.actor, jobId: j.jobId });
      const r = await repo.getJob(f.actor, { jobId: j.jobId });
      expect(r.counts.forbidden).toBe(5);
      expect(r.items.every((i) => i.resourceId === null && i.resourceLabel === null)).toBe(true);
      const [a] =
        await sql!`select count(*)::int n from annual_return_audit_events where case_id=any(${f.caseIds}::uuid[])`;
      expect(a.n).toBe(0);
    }));
  it("fences an expired lease and allows only one claimant to write", async () =>
    fixture(2, async (f) => {
      const repo = createBulkOperationsRepository({ sql: sql! });
      const p = await repo.preview(f.actor, {
        resource: "annual_return_case",
        selection: { mode: "explicit_ids", ids: f.caseIds },
        assignment: { target: "owner", assigneeId: f.assigneeId },
      });
      const j = await repo.execute(f.actor, {
        previewId: p.previewId,
        idempotencyKey: crypto.randomUUID(),
      });
      const first = await repo.claim(f.actor, j.jobId);
      expect(first).toBeTruthy();
      expect(await repo.claim(f.actor, j.jobId)).toBeNull();
      await sql!`update bulk_operation_jobs set lease_until=now()-interval '1 second' where id=${j.jobId}`;
      const second = await repo.claim(f.actor, j.jobId);
      expect(second!.token).not.toBe(first!.token);
      await expect(repo.processNext(first!)).rejects.toThrow(/lease lost/);
      expect(await repo.processNext(second!)).toBe(true);
      expect(await repo.processNext(second!)).toBe(true);
      await repo.finishChunk(second!);
      const r = await repo.getJob(f.actor, { jobId: j.jobId });
      expect(r.counts.succeeded).toBe(2);
      expect(r.items.every((i) => i.attempts === 1)).toBe(true);
    }));
  it("retries only an actual PostgreSQL rolled-back transaction and retains attempt history", async () =>
    fixture(2, async (f) => {
      let fault = true;
      const repo = createBulkOperationsRepository({
        sql: sql!,
        assign: async (tx, actor, command) => {
          if (fault) {
            fault = false;
            await tx.unsafe(
              "do $$ begin raise exception using errcode='40001',message='Synthetic local serialization failure'; end $$;",
            );
          }
          await applyAssignment(tx, actor, command);
        },
      });
      const p = await repo.preview(f.actor, {
        resource: "annual_return_case",
        selection: { mode: "explicit_ids", ids: f.caseIds },
        assignment: { target: "owner", assigneeId: f.assigneeId },
      });
      const j = await repo.execute(f.actor, {
        previewId: p.previewId,
        idempotencyKey: crypto.randomUUID(),
      });
      await runBulkAssignmentChunk({ repository: repo, actor: f.actor, jobId: j.jobId });
      const failed = await repo.getJob(f.actor, { jobId: j.jobId });
      expect(failed.counts).toMatchObject({ failed: 1, succeeded: 1 });
      expect(failed.items.find((i) => i.state === "failed")?.retryable).toBe(true);
      expect(await repo.retryFailed(f.actor, j.jobId)).toEqual({ retryCount: 1 });
      await runBulkAssignmentChunk({ repository: repo, actor: f.actor, jobId: j.jobId });
      const r = await repo.getJob(f.actor, { jobId: j.jobId });
      expect(r.counts.succeeded).toBe(2);
      expect(r.items.map((i) => i.attempts).sort()).toEqual([1, 2]);
      const [history] =
        await sql!`select jsonb_array_length(result->'history') n from bulk_operation_job_items where job_id=${j.jobId} and attempts=2`;
      expect(history.n).toBe(3); // two attempts and the explicit retry action
      expect(failed.retryableFailedCount).toBe(1);
    }));
  it("never retries unknown SQL outcomes without explicit reconciliation", async () =>
    fixture(2, async (f) => {
      let fault = true;
      const repo = createBulkOperationsRepository({
        sql: sql!,
        assign: async (tx, actor, command) => {
          await applyAssignment(tx, actor, command);
          if (fault) {
            fault = false;
            throw Object.assign(new Error("Synthetic local transport interruption"), {
              code: "ECONNRESET",
            });
          }
        },
      });
      const p = await repo.preview(f.actor, {
        resource: "annual_return_case",
        selection: { mode: "explicit_ids", ids: f.caseIds },
        assignment: { target: "owner", assigneeId: f.assigneeId },
      });
      const j = await repo.execute(f.actor, {
        previewId: p.previewId,
        idempotencyKey: crypto.randomUUID(),
      });
      await runBulkAssignmentChunk({ repository: repo, actor: f.actor, jobId: j.jobId });
      expect((await repo.getJob(f.actor, { jobId: j.jobId })).counts).toMatchObject({
        unknown: 1,
        succeeded: 1,
      });
      expect(await repo.retryFailed(f.actor, j.jobId)).toEqual({ retryCount: 0 });
      expect(
        (await runBulkAssignmentChunk({ repository: repo, actor: f.actor, jobId: j.jobId }))
          .processed,
      ).toBe(0);
      expect(await repo.reconcileUnknown(f.actor, j.jobId)).toEqual({ reconciledCount: 1 });
      await runBulkAssignmentChunk({ repository: repo, actor: f.actor, jobId: j.jobId });
      expect((await repo.getJob(f.actor, { jobId: j.jobId })).counts.succeeded).toBe(2);
      const [a] =
        await sql!`select count(*)::int n from annual_return_audit_events where case_id=any(${f.caseIds}::uuid[])`;
      expect(a.n).toBe(2);
    }));
  it(
    "100 items:90 succeed,5 locked,5 forbidden; own idempotency, zero unauthorized writes and no success replay",
    async () =>
      fixture(
        100,
        async (f) => {
          const repo = createBulkOperationsRepository({ sql: sql! });
          const input = {
            resource: "annual_return_case" as const,
            selection: { mode: "explicit_ids" as const, ids: f.caseIds },
            assignment: { target: "owner" as const, assigneeId: f.assigneeId },
          };
          const preview = await repo.preview(f.actor, input);
          expect(preview).toMatchObject({
            count: 100,
            eligibleCount: 90,
            reasons: { locked: 5, forbidden: 5 },
          });
          expect(JSON.stringify(preview)).not.toContain("Private foreign company");
          const execute = { previewId: preview.previewId, idempotencyKey: crypto.randomUUID() };
          const job = await repo.execute(f.actor, execute);
          expect(await repo.execute(f.actor, execute)).toMatchObject({ jobId: job.jobId });
          await runBulkAssignmentChunk({ repository: repo, actor: f.actor, jobId: job.jobId });
          await runBulkAssignmentChunk({ repository: repo, actor: f.actor, jobId: job.jobId });
          const result = await repo.getJob(f.actor, { jobId: job.jobId, limit: 100 });
          expect(result).toMatchObject({
            state: "partial",
            total: 100,
            counts: { succeeded: 90, locked: 5, forbidden: 5 },
          });
          expect(
            result.items.filter((i) => i.state === "forbidden").every((i) => i.resourceId === null),
          ).toBe(true);
          const [count] =
            await sql!`select count(*)::int n from annual_return_cases where id=any(${f.caseIds}::uuid[]) and owner_id=${f.assigneeId}`;
          expect(count.n).toBe(90);
          const [audit] =
            await sql!`select count(*)::int n from annual_return_audit_events where case_id=any(${f.caseIds}::uuid[]) and action='assign_owner'`;
          expect(audit.n).toBe(90);
          const otherPreview = await repo.preview(f.actor, {
            ...input,
            assignment: { target: "reviewer", assigneeId: f.assigneeId },
          });
          await expect(
            repo.execute(f.actor, { ...execute, previewId: otherPreview.previewId }),
          ).rejects.toThrow(/idempotency|payload/i);
        },
        true,
      ),
    30000,
  );
  it("captures1240 filtered IDs independently of page50, honors exclusions and freezes the snapshot", async () =>
    fixture(1240, async (f) => {
      const repo = createBulkOperationsRepository({ sql: sql! });
      const snapshot = await repo.createSnapshot(f.actor, {
        resource: "annual_return_case",
        filters: { q: "Synthetic scoped bulk company" },
      });
      expect(snapshot.count).toBe(1240);
      await sql!`update annual_return_cases set current_status='Payment pending' where id=${f.caseIds[0]}`;
      const preview = await repo.preview(f.actor, {
        resource: "annual_return_case",
        selection: {
          mode: "filtered_snapshot",
          snapshotId: snapshot.snapshotId,
          excludedIds: f.caseIds.slice(0, 2),
        },
        assignment: { target: "owner", assigneeId: f.assigneeId },
      });
      expect(preview.count).toBe(1238);
      await expect(
        repo.preview(
          { ...f.actor, authUserId: "unverified-id" },
          {
            resource: "annual_return_case",
            selection: {
              mode: "filtered_snapshot",
              snapshotId: snapshot.snapshotId,
              excludedIds: [],
            },
            assignment: { target: "owner", assigneeId: f.assigneeId },
          },
        ),
      ).rejects.toThrow(/Forbidden/);
    }));
  it("crash after item commit resumes persisted progress; current permission/version conflicts do not write", async () =>
    fixture(5, async (f) => {
      const repo = createBulkOperationsRepository({ sql: sql! });
      const preview = await repo.preview(f.actor, {
        resource: "annual_return_case",
        selection: { mode: "explicit_ids", ids: f.caseIds },
        assignment: { target: "owner", assigneeId: f.assigneeId },
      });
      const job = await repo.execute(f.actor, {
        previewId: preview.previewId,
        idempotencyKey: crypto.randomUUID(),
      });
      await expect(
        runBulkAssignmentChunk({
          repository: repo,
          actor: f.actor,
          jobId: job.jobId,
          afterCommit: () => {
            throw new Error("Synthetic process crash after commit");
          },
        }),
      ).rejects.toThrow(/after commit/);
      const stopped = await repo.getJob(f.actor, { jobId: job.jobId });
      expect(stopped.counts.succeeded).toBe(1);
      const pending = stopped.items.filter((i) => i.state === "pending");
      await sql!`update annual_return_cases set current_status='Payment pending' where id=${pending[0].resourceId!}`;
      await sql!`update bulk_operation_jobs set lease_until=now()-interval '1 second' where id=${job.jobId}`;
      await runBulkAssignmentChunk({
        repository: createBulkOperationsRepository({ sql: sql! }),
        actor: f.actor,
        jobId: job.jobId,
      });
      const result = await repo.getJob(f.actor, { jobId: job.jobId });
      expect(result.counts).toMatchObject({ succeeded: 4, conflict: 1 });
      await repo.retryFailed(f.actor, job.jobId);
      expect((await repo.getJob(f.actor, { jobId: job.jobId })).counts.conflict).toBe(1);
      const [audit] =
        await sql!`select count(*)::int n from annual_return_audit_events where case_id=any(${f.caseIds}::uuid[])`;
      expect(audit.n).toBe(4);
    }));
  it("cancel retains successful items and a Manager losing scope gets no item data or writes", async () =>
    fixture(5, async (f) => {
      const repo = createBulkOperationsRepository({ sql: sql! });
      const p = await repo.preview(f.actor, {
        resource: "annual_return_case",
        selection: { mode: "explicit_ids", ids: f.caseIds },
        assignment: { target: "owner", assigneeId: f.assigneeId },
      });
      const j = await repo.execute(f.actor, {
        previewId: p.previewId,
        idempotencyKey: crypto.randomUUID(),
      });
      await runBulkAssignmentChunk({
        repository: repo,
        actor: f.actor,
        jobId: j.jobId,
        chunkSize: 1,
      });
      await repo.cancel(f.actor, j.jobId);
      expect((await repo.getJob(f.actor, { jobId: j.jobId })).counts).toMatchObject({
        succeeded: 1,
        cancelled: 4,
      });
      await sql!`update companies set assigned_team_id=${other} where id=${f.companyId}`;
      const hidden = await repo.getJob(f.actor, { jobId: j.jobId });
      expect(hidden.items.every((i) => i.resourceId === null)).toBe(true);
    }));
});
