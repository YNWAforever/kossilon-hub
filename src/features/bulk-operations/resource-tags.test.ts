import { describe, expect, it } from "vitest";
import { createSqlClient } from "@/server/db/client";
import { createBulkOperationRepository } from "./repository";
import type { AuthenticatedActor } from "@/features/auth/types";
import { applyOneResourceTagForActor, previewResourceTagsForActor } from "./resource-tags";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("T22 resource tag domain on disposable PostgreSQL", () => {
  it("refuses cross-team and stale tag writes while a permitted client tag is audited once", async () => {
    const db = createSqlClient(databaseUrl!, { max: 2 });
    const rollback = new Error("T22 tag fixture rollback");
    try {
      await expect(
        db.begin(async (tx) => {
          const teamA = crypto.randomUUID();
          const teamB = crypto.randomUUID();
          const managerId = crypto.randomUUID();
          const ownedId = crypto.randomUUID();
          const foreignId = crypto.randomUUID();
          const actor: AuthenticatedActor = {
            authUserId: `t22-tag-${managerId}`,
            userId: managerId,
            role: "Manager",
            teamId: teamA,
            active: true,
          };
          await tx`insert into teams(id,name) values
          (${teamA},${`T22 Tag A ${teamA}`}),(${teamB},${`T22 Tag B ${teamB}`})`;
          await tx`insert into users(id,name,email,role,team_id,active)
          values (${managerId},'T22 Tag Manager',${`${managerId}@example.invalid`},
          'Manager',${teamA},true)`;
          await tx`insert into staff_profiles(user_id,auth_user_id,role,team_id,active)
          values (${managerId},${actor.authUserId},'Manager',${teamA},true)`;
          for (const [id, teamId] of [
            [ownedId, teamA],
            [foreignId, teamB],
          ] as const) {
            await tx`insert into companies(id,company_name,cr_number,br_number,
            incorporation_date,annual_return_basis_date,registered_office,
            company_secretary,assigned_owner_id,assigned_team_id,data_origin)
            values (${id},${`T22 Tag ${id}`},${`CR-${id}`},${`BR-${id}`},
            '2020-01-01','2026-01-01','Test address','Test secretary',
            ${managerId},${teamId},'client')`;
          }
          const preview = await previewResourceTagsForActor(
            actor,
            { resource: "clients", ids: [ownedId, foreignId], tag: "urgent", mode: "add" },
            { sql: tx },
          );
          expect(preview.map((item) => [item.state, item.reasonCode])).toEqual([
            ["eligible", null],
            ["forbidden", "RESOURCE_OUT_OF_SCOPE"],
          ]);
          expect(preview[1]?.revision).toBeNull();
          await expect(
            applyOneResourceTagForActor(
              actor,
              {
                resource: "clients",
                resourceId: foreignId,
                tag: "urgent",
                mode: "add",
                expectedRevision: 1,
              },
              { sql: tx },
            ),
          ).rejects.toThrow(/forbidden|scope/i);
          const applied = await applyOneResourceTagForActor(
            actor,
            {
              resource: "clients",
              resourceId: ownedId,
              tag: "urgent",
              mode: "add",
              expectedRevision: 1,
            },
            { sql: tx },
          );
          expect(applied.revision).toBe(2);
          expect(applied.auditRef).toBeTruthy();
          await expect(
            applyOneResourceTagForActor(
              actor,
              {
                resource: "clients",
                resourceId: ownedId,
                tag: "urgent",
                mode: "add",
                expectedRevision: 1,
              },
              { sql: tx },
            ),
          ).rejects.toThrow(/revision changed/i);
          const [saved] = await tx<{ tag_revision: number }[]>`
          select tag_revision from companies where id=${ownedId}`;
          expect(saved.tag_revision).toBe(2);
          const [count] = await tx<{ count: number }[]>`
          select count(*)::int count from resource_tag_events
          where resource_type='clients' and resource_id=${ownedId}`;
          expect(count.count).toBe(1);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    } finally {
      await db.end();
    }
  }, 60_000);

  it("durably tags client, case and work item with per-item scope and idempotent approval", async () => {
    const db = createSqlClient(databaseUrl!, { max: 2 });
    const rollback = new Error("T22 durable tag rollback");
    try {
      await expect(
        db.begin(async (tx) => {
          const [manager] = await tx<
            {
              auth_user_id: string;
              user_id: string;
              team_id: string;
            }[]
          >`select sp.auth_user_id,sp.user_id,sp.team_id from staff_profiles sp
          join users u on u.id=sp.user_id and u.active
          where sp.role='Manager' and sp.active and sp.team_id=
            '10000000-0000-0000-0000-000000000001' limit 1`;
          const actor: AuthenticatedActor = {
            authUserId: manager.auth_user_id,
            userId: manager.user_id,
            role: "Manager",
            teamId: manager.team_id,
            active: true,
          };
          const companyId = crypto.randomUUID();
          const foreignId = crypto.randomUUID();
          const caseId = crypto.randomUUID();
          const [work] = await tx<{ id: string }[]>`
          select id from work_items where team_id=${manager.team_id} limit 1`;
          for (const [id, teamId] of [
            [companyId, manager.team_id],
            [foreignId, "10000000-0000-0000-0000-000000000002"],
          ] as const) {
            await tx`insert into companies(id,company_name,cr_number,br_number,
            incorporation_date,annual_return_basis_date,registered_office,
            company_secretary,assigned_owner_id,assigned_team_id,data_origin)
            values (${id},${`T22 durable tag ${id}`},${`CR-${id}`},${`BR-${id}`},
              '2020-01-01','2026-01-01','Test address','Test secretary',
              ${manager.user_id},${teamId},'client')`;
          }
          await tx`insert into annual_return_cases(id,company_id,return_year,made_up_date,
          filing_due_date,current_status,owner_id)
          values (${caseId},${companyId},2026,'2026-01-01','2026-02-11',
            'Upcoming',${manager.user_id})`;
          const repo = createBulkOperationRepository({ sql: tx });
          for (const [resource, ids] of [
            ["clients", [companyId, foreignId]],
            ["annual-return-cases", [caseId]],
            ["work-items", [work.id]],
          ] as const) {
            const preview = await repo.preview(actor, {
              action: "tag",
              selection: { kind: "ids", resource, ids: [...ids] },
              parameters: { tag: "priority", mode: "add" },
            });
            expect(preview.eligibleCount).toBe(1);
            if (resource === "clients")
              expect(
                preview.itemsPreview.find((item) => item.resourceId === foreignId),
              ).toMatchObject({
                state: "forbidden",
                reasonCode: "RESOURCE_OUT_OF_SCOPE",
                revision: null,
              });
            const key = crypto.randomUUID();
            const operation = await repo.commit(actor, {
              previewId: preview.id,
              previewHash: preview.previewHash,
              idempotencyKey: key,
            });
            expect(
              (
                await repo.commit(actor, {
                  previewId: preview.id,
                  previewHash: preview.previewHash,
                  idempotencyKey: key,
                })
              ).id,
            ).toBe(operation.id);
            if (resource === "annual-return-cases") {
              const interrupted = await repo.runBatch(operation.id, {
                limit: 1,
                afterDomainWrite: () => {
                  throw new Error("simulate interrupted tag write");
                },
              });
              expect(interrupted.counts.failed).toBe(1);
              const [beforeRetry] = await tx<{ revision: number; tags: number }[]>`
              select a.tag_revision revision,
                (select count(*)::int from annual_return_case_tags t where t.case_id=a.id) tags
              from annual_return_cases a where a.id=${caseId}`;
              expect(beforeRetry).toEqual({ revision: 1, tags: 0 });
            }
            await repo.runBatch(operation.id, { limit: 2 });
            const view = await repo.get(actor, operation.id);
            expect(view.counts.succeeded).toBe(1);
            expect(view.items.find((item) => item.state === "succeeded")).toMatchObject({
              revisionBefore: 1,
              revisionAfter: 2,
            });
            expect(view.items.find((item) => item.state === "succeeded")?.auditRef).toBeTruthy();
            const repeat = await repo.preview(actor, {
              action: "tag",
              selection: { kind: "ids", resource, ids: [...ids].slice(0, 1) },
              parameters: { tag: "priority", mode: "add" },
            });
            expect(repeat.itemsPreview[0]?.state).toBe("skipped");
          }
          const [events] = await tx<{ count: number }[]>`
          select count(*)::int count from resource_tag_events
          where tag='priority' and actor_id=${manager.user_id}`;
          expect(events.count).toBe(3);
          throw rollback;
        }),
      ).rejects.toBe(rollback);
    } finally {
      await db.end();
    }
  }, 60_000);
});
