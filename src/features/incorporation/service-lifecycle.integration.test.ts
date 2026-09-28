import "dotenv/config";
import { describe, expect, it, vi } from "vitest";
import { createSqlClient } from "@/server/db/client";
import { createIncorporationRepository } from "./repository";
import { createCorporateChangeRequestRepository } from "@/features/corporate-changes/repository";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("T28 service lifecycle", () => {
  it("t28_scenario_1 rejects completion bypass and replays incorporation once", async () => {
    const sql = createSqlClient(databaseUrl!, { max: 1 });
    try {
      await expect(
        sql.begin(async (tx) => {
          const repository = createIncorporationRepository({ sql: tx });
          const [owner] = await tx<{ id: string }[]>`select id from users where active limit 1`;
          const [team] = await tx<{ id: string }[]>`select id from teams where active limit 1`;
          const created = await repository.createCase({
            proposedCompanyNameEn: "T28 Incorporation " + crypto.randomUUID(),
            proposedCompanyNameZh: null,
            proposedRegisteredOffice: "1 Test Street, Hong Kong",
            proposedCompanySecretary: "Test Secretary",
            registeredCapital: 10000,
            businessNature: "Trading",
            ownerId: owner.id,
            teamId: team.id,
            targetCompletionDate: "2026-12-01",
            actorId: owner.id,
          });
          await expect(
            repository.updateCaseStatus({
              caseId: created.id,
              status: "Ready to file",
              actorId: owner.id,
            }),
          ).rejects.toThrow();
          await expect(
            repository.updateCaseStatus({
              caseId: created.id,
              status: "unknown" as never,
              actorId: owner.id,
            }),
          ).rejects.toThrow();
          for (const status of [
            "Documents pending",
            "Ready to file",
            "Filed with Registrar",
          ] as const) {
            await repository.updateCaseStatus({ caseId: created.id, status, actorId: owner.id });
          }
          await expect(
            repository.updateCaseStatus({
              caseId: created.id,
              status: "Completed",
              actorId: owner.id,
            }),
          ).rejects.toThrow(/completion service/);
          const input = {
            caseId: created.id,
            crNumber: "T28-CR-" + crypto.randomUUID(),
            brNumber: "T28-BR-" + crypto.randomUUID(),
            incorporationDate: "2026-09-01",
            actorId: owner.id,
          };
          const completed = await repository.completeCase(input);
          const replay = await repository.completeCase(input);
          expect(replay.companyId).toBe(completed.companyId);
          const [count] = await tx<{ total: number }[]>`
          select count(*)::int as total from companies where id=${completed.companyId}
        `;
          expect(count.total).toBe(1);
          throw new Error("rollback T28 incorporation fixture");
        }),
      ).rejects.toThrow("rollback T28 incorporation fixture");
    } finally {
      await sql.end();
    }
  });

  it("t28_scenario_1 refuses a shareholding from another company", async () => {
    const sql = createSqlClient(databaseUrl!, { max: 1 });
    try {
      await expect(
        sql.begin(async (tx) => {
          const [owner] = await tx<{ id: string }[]>`select id from users where active limit 1`;
          const [team] = await tx<{ id: string }[]>`select id from teams where active limit 1`;
          const companyIds: string[] = [];
          for (let index = 0; index < 2; index += 1) {
            const [company] = await tx<{ id: string }[]>`
            insert into companies (
              company_name,cr_number,br_number,incorporation_date,
              annual_return_basis_date,registered_office,company_secretary,
              status,assigned_owner_id,assigned_team_id
            ) values (
              ${"T28 Company " + index},${"T28-CR-" + crypto.randomUUID()},
              ${"T28-BR-" + crypto.randomUUID()},'2020-01-01',
              '2027-01-01','1 Test Street','Test Secretary',
              'active',${owner.id},${team.id}
            ) returning id
          `;
            companyIds.push(company.id);
          }
          const [foreignHolding] = await tx<{ id: string }[]>`
          insert into shareholdings (
            company_id,shareholder_name,share_class,number_of_shares,allotment_date
          ) values (${companyIds[1]},'Foreign Holder','Ordinary',100,'2020-01-01')
          returning id
        `;
          const repository = createCorporateChangeRequestRepository(undefined, { sql: tx });
          await expect(
            repository.createRequest({
              changeType: "share_transfer",
              companyId: companyIds[0],
              quotedFee: 1000,
              transferorShareholdingId: foreignHolding.id,
              sharesTransferred: 10,
              consideration: 100,
              stampDutyAmount: 0,
              transfereeShareholdingId: null,
              transfereeNewShareholderName: "New Holder",
              transfereeNewShareholderAddress: null,
              actorId: owner.id,
            }),
          ).rejects.toThrow(/shareholding.*company|company.*shareholding/i);
          throw new Error("rollback T28 cross-company fixture");
        }),
      ).rejects.toThrow("rollback T28 cross-company fixture");
    } finally {
      await sql.end();
    }
  });

  it("t28_scenario_3 deduplicates subscription drafts per renewal and never queues an automatic send", async () => {
    const sql = createSqlClient(databaseUrl!, { max: 1 });
    try {
      await expect(
        sql.begin(async (tx) => {
          const [owner] = await tx<{ id: string }[]>`select id from users where active limit 1`;
          const [team] = await tx<{ id: string }[]>`select id from teams where active limit 1`;
          const [company] = await tx<{ id: string }[]>`
          insert into companies (
            company_name,cr_number,br_number,incorporation_date,
            annual_return_basis_date,registered_office,company_secretary,
            status,assigned_owner_id,assigned_team_id
          ) values (
            'T28 Subscription Ltd',${"T28-CR-" + crypto.randomUUID()},
            ${"T28-BR-" + crypto.randomUUID()},'2020-01-01',
            '2027-01-01','Test Address','Test Secretary',
            'active',${owner.id},${team.id}
          ) returning id
        `;
          await tx`
          insert into company_contacts (company_id,name,role,email,phone,is_primary)
          values (${company.id},'Test Contact','Director','test@example.invalid',null,true)
        `;
          const { createServiceSubscriptionRepository } =
            await import("@/features/service-subscriptions/repository");
          const repository = createServiceSubscriptionRepository({ sql: tx });
          const subscription = await repository.addSubscription({
            companyId: company.id,
            serviceType: "secretary",
            fee: 2800,
            renewalDate: "2026-09-12",
            actorId: owner.id,
          });
          await repository.evaluateReminders("2026-08-13");
          await repository.evaluateReminders("2026-08-13");
          let rows = await tx<{ status: string }[]>`
          select status from notification_outbox
          where payload->>'subscriptionId'=${subscription.id} order by created_at
        `;
          expect(rows).toEqual([{ status: "draft" }]);
          await repository.renewSubscription({
            subscriptionId: subscription.id,
            companyId: company.id,
            actorId: owner.id,
          });
          await repository.evaluateReminders("2027-08-13");
          rows = await tx<{ status: string }[]>`
          select status from notification_outbox
          where payload->>'subscriptionId'=${subscription.id} order by created_at
        `;
          expect(rows).toHaveLength(2);
          expect(rows[0].status).toBe("cancelled");
          expect(rows[1].status).toBe("draft");
          const milestones = await tx<{ renewal_date: string }[]>`
          select renewal_date::text from service_subscription_reminder_events
          where subscription_id=${subscription.id} order by renewal_date
        `;
          expect(milestones.map((row) => row.renewal_date)).toEqual(["2026-09-12", "2027-09-12"]);
          throw new Error("rollback T28 subscription fixture");
        }),
      ).rejects.toThrow("rollback T28 subscription fixture");
    } finally {
      await sql.end();
    }
  });

  it("t28_scenario_3 can draft after a missing primary contact is repaired", async () => {
    const sql = createSqlClient(databaseUrl!, { max: 1 });
    try {
      await expect(
        sql.begin(async (tx) => {
          const [owner] = await tx<{ id: string }[]>`select id from users where active limit 1`;
          const [team] = await tx<{ id: string }[]>`select id from teams where active limit 1`;
          const [company] = await tx<{ id: string }[]>`
            insert into companies (
              company_name,cr_number,br_number,incorporation_date,
              annual_return_basis_date,registered_office,company_secretary,
              status,assigned_owner_id,assigned_team_id
            ) values (
              'T28 Contact Recovery',${"T28-CR-" + crypto.randomUUID()},
              ${"T28-BR-" + crypto.randomUUID()},'2020-01-01',
              '2027-01-01','Test Address','Test Secretary',
              'active',${owner.id},${team.id}
            ) returning id
          `;
          const { createServiceSubscriptionRepository } =
            await import("@/features/service-subscriptions/repository");
          const repository = createServiceSubscriptionRepository({ sql: tx });
          const subscription = await repository.addSubscription({
            companyId: company.id,
            serviceType: "secretary",
            fee: 2800,
            renewalDate: "2026-09-12",
            actorId: owner.id,
          });
          await repository.evaluateReminders("2026-08-13");
          await tx`
            insert into company_contacts (company_id,name,role,email,phone,is_primary)
            values (${company.id},'Restored Contact','Director','restored@example.invalid',null,true)
          `;
          await repository.evaluateReminders("2026-08-13");
          const drafts = await tx<{ status: string }[]>`
            select status from notification_outbox
            where payload->>'subscriptionId'=${subscription.id}
          `;
          expect(drafts).toEqual([{ status: "draft" }]);
          throw new Error("rollback T28 contact recovery fixture");
        }),
      ).rejects.toThrow("rollback T28 contact recovery fixture");
    } finally {
      await sql.end();
    }
  });
  it("t28_scenario_3 requires a current Manager or Admin to approve a draft once", async () => {
    const sql = createSqlClient(databaseUrl!, { max: 1 });
    try {
      await expect(
        sql.begin(async (tx) => {
          const [admin] = await tx<{ id: string }[]>`
          select id from users where role='Admin' and active limit 1
        `;
          const [staff] = await tx<{ id: string }[]>`
          select id from users where role='Staff' and active limit 1
        `;
          const [team] = await tx<{ id: string }[]>`select id from teams where active limit 1`;
          const [company] = await tx<{ id: string }[]>`
          insert into companies (
            company_name,cr_number,br_number,incorporation_date,
            annual_return_basis_date,registered_office,company_secretary,
            status,assigned_owner_id,assigned_team_id
          ) values (
            'T28 Approval Ltd',${"T28-CR-" + crypto.randomUUID()},
            ${"T28-BR-" + crypto.randomUUID()},'2020-01-01',
            '2027-01-01','Test Address','Test Secretary',
            'active',${admin.id},${team.id}
          ) returning id
        `;
          await tx`
          insert into company_contacts (company_id,name,role,email,phone,is_primary)
          values (${company.id},'Test Contact','Director','test@example.invalid',null,true)
        `;
          const { createServiceSubscriptionRepository } =
            await import("@/features/service-subscriptions/repository");
          const repository = createServiceSubscriptionRepository({ sql: tx });
          const subscription = await repository.addSubscription({
            companyId: company.id,
            serviceType: "secretary",
            fee: 2800,
            renewalDate: "2026-09-12",
            actorId: admin.id,
          });
          await repository.evaluateReminders("2026-08-13");
          const [draft] = await tx<{ id: string; status: string }[]>`
          select id,status from notification_outbox
          where payload->>'subscriptionId'=${subscription.id}
        `;
          expect(draft.status).toBe("draft");
          expect((await repository.listReminderDrafts(company.id)).map((row) => row.id)).toEqual([
            draft.id,
          ]);
          await expect(
            repository.approveReminderDraft({
              companyId: company.id,
              draftId: draft.id,
              actorId: staff.id,
            }),
          ).rejects.toThrow(/Manager|Admin/);
          await tx`
            update company_contacts set email='changed@example.invalid'
            where company_id=${company.id} and is_primary=true
          `;
          await expect(
            repository.approveReminderDraft({
              companyId: company.id,
              draftId: draft.id,
              actorId: admin.id,
            }),
          ).rejects.toThrow(/recipient changed/);
          await tx`
            update company_contacts set email='test@example.invalid'
            where company_id=${company.id} and is_primary=true
          `;
          const approval = await repository.approveReminderDraft({
            companyId: company.id,
            draftId: draft.id,
            actorId: admin.id,
          });
          expect(approval.state).toBe("approved");
          const replay = await repository.approveReminderDraft({
            companyId: company.id,
            draftId: draft.id,
            actorId: admin.id,
          });
          expect(replay.state).toBe("already_approved");
          const [after] = await tx<
            { status: string; approved_by: string; attempt_count: number }[]
          >`
          select status,approved_by,attempt_count from notification_outbox where id=${draft.id}
        `;
          expect(after).toEqual({ status: "pending", approved_by: admin.id, attempt_count: 0 });
          throw new Error("rollback T28 approval fixture");
        }),
      ).rejects.toThrow("rollback T28 approval fixture");
    } finally {
      await sql.end();
    }
  });

  it("t28_scenario_3 confines Client reads to active memberships and denies staff management", async () => {
    const { assertClientCompanyAccess, assertStaffAccess } =
      await import("@/features/auth/authorization");
    const { listClientPortalCasesForActor } =
      await import("@/features/annual-return/client-portal-server-fns");
    const actor = {
      authUserId: "client-auth",
      userId: null,
      role: "Client" as const,
      teamId: null,
      active: true as const,
    };
    const ownCompanyId = "aa000000-0000-4000-8000-000000000001";
    const otherCompanyId = "bb000000-0000-4000-8000-000000000002";
    expect(
      assertClientCompanyAccess(actor, ownCompanyId, [{ companyId: ownCompanyId, active: true }]),
    ).toBe(actor);
    expect(() =>
      assertClientCompanyAccess(actor, otherCompanyId, [{ companyId: ownCompanyId, active: true }]),
    ).toThrow(/membership/);
    expect(() => assertStaffAccess(actor)).toThrow(/staff access/);
    const listCases = vi.fn(async () => [
      {
        id: crypto.randomUUID(),
        companyId: otherCompanyId,
      },
    ]);
    const visible = await listClientPortalCasesForActor({
      listCompanyIds: async () => [ownCompanyId],
      repository: { listCases },
    } as never);
    expect(visible).toEqual([]);
    expect(listCases).toHaveBeenCalledWith({ companyIds: [ownCompanyId] });
  });

  it("t28_scenario_1 scopes incorporation case lists to the staff team", async () => {
    const sql = createSqlClient(databaseUrl!, { max: 1 });
    try {
      await expect(
        sql.begin(async (tx) => {
          const [owner] = await tx<{ id: string }[]>`select id from users where active limit 1`;
          const [team] = await tx<{ id: string }[]>`select id from teams where active limit 1`;
          const [otherTeam] = await tx<{ id: string }[]>`
          insert into teams (name,active)
          values (${"T28 Other " + crypto.randomUUID()},true) returning id
        `;
          const repository = createIncorporationRepository({ sql: tx });
          const create = (teamId: string) =>
            repository.createCase({
              proposedCompanyNameEn: "T28 Scoped " + crypto.randomUUID(),
              proposedCompanyNameZh: null,
              proposedRegisteredOffice: "1 Test Street, Hong Kong",
              proposedCompanySecretary: "Test Secretary",
              registeredCapital: 10000,
              businessNature: "Trading",
              ownerId: owner.id,
              teamId,
              targetCompletionDate: "2026-12-01",
              actorId: owner.id,
            });
          const own = await create(team.id);
          const foreign = await create(otherTeam.id);
          const scoped = await repository.listCases(team.id);
          expect(scoped.some((row) => row.id === own.id)).toBe(true);
          expect(scoped.some((row) => row.id === foreign.id)).toBe(false);
          throw new Error("rollback T28 scoped intake fixture");
        }),
      ).rejects.toThrow("rollback T28 scoped intake fixture");
    } finally {
      await sql.end();
    }
  });
});
