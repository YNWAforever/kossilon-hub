import "dotenv/config";
import { describe, expect, it } from "vitest";
import { createSqlClient } from "@/server/db/client";
import { createCorporateChangeRequestRepository } from "./repository";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("T28 corporate change lifecycle", () => {
  it("t28_scenario_1 applies an address change only through completion and replays once", async () => {
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
            'T28 Address Ltd',${"T28-CR-" + crypto.randomUUID()},
            ${"T28-BR-" + crypto.randomUUID()},'2020-01-01',
            '2027-01-01','Old Address','Test Secretary',
            'active',${owner.id},${team.id}
          ) returning id
        `;
          const repository = createCorporateChangeRequestRepository(undefined, { sql: tx });
          const request = await repository.createRequest({
            changeType: "address_change",
            companyId: company.id,
            quotedFee: 1000,
            newRegisteredOffice: "New Address",
            actorId: owner.id,
          });
          await expect(
            repository.transitionStatus({
              requestId: request.id,
              toStatus: "Ready to file",
              actorId: owner.id,
            }),
          ).rejects.toThrow();
          await expect(
            repository.transitionStatus({
              requestId: request.id,
              toStatus: "unknown" as never,
              actorId: owner.id,
            }),
          ).rejects.toThrow();
          for (const toStatus of [
            "Documents pending",
            "Ready to file",
            "Filed with Registrar",
          ] as const) {
            await repository.transitionStatus({
              requestId: request.id,
              toStatus,
              actorId: owner.id,
            });
          }
          const [before] = await tx<{ registered_office: string }[]>`
          select registered_office from companies where id=${company.id}
        `;
          expect(before.registered_office).toBe("Old Address");
          await expect(
            repository.transitionStatus({
              requestId: request.id,
              toStatus: "Completed",
              actorId: owner.id,
            }),
          ).rejects.toThrow(/completion service/);
          const completed = await repository.completeRequest({
            requestId: request.id,
            actorId: owner.id,
          });
          const replay = await repository.completeRequest({
            requestId: request.id,
            actorId: owner.id,
          });
          expect(completed.status).toBe("Completed");
          expect(replay.id).toBe(completed.id);
          const [after] = await tx<{ registered_office: string }[]>`
          select registered_office from companies where id=${company.id}
        `;
          expect(after.registered_office).toBe("New Address");
          throw new Error("rollback T28 corporate change fixture");
        }),
      ).rejects.toThrow("rollback T28 corporate change fixture");
    } finally {
      await sql.end();
    }
  });

  it("t28_scenario_2 cancellation leaves the canonical name unchanged", async () => {
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
            'Original Name',${"T28-CR-" + crypto.randomUUID()},
            ${"T28-BR-" + crypto.randomUUID()},'2020-01-01',
            '2027-01-01','Old Address','Test Secretary',
            'active',${owner.id},${team.id}
          ) returning id
        `;
          const repository = createCorporateChangeRequestRepository(undefined, { sql: tx });
          const request = await repository.createRequest({
            changeType: "name_change",
            companyId: company.id,
            quotedFee: 1000,
            newNameEn: "Never Applied",
            newNameZh: null,
            actorId: owner.id,
          });
          const cancelled = await repository.cancelRequest({
            requestId: request.id,
            actorId: owner.id,
          });
          expect(cancelled.status).toBe("Cancelled");
          const [companyAfter] = await tx<{ company_name: string }[]>`
          select company_name from companies where id=${company.id}
        `;
          expect(companyAfter.company_name).toBe("Original Name");
          throw new Error("rollback T28 cancellation fixture");
        }),
      ).rejects.toThrow("rollback T28 cancellation fixture");
    } finally {
      await sql.end();
    }
  });

  it("t28_scenario_2 preserves a filing party snapshot after a name change and director exit", async () => {
    const sql = createSqlClient(databaseUrl!, { max: 1 });
    try {
      await expect(
        sql.begin(async (tx) => {
          const [owner] = await tx<{ id: string }[]>`select id from users where active limit 1`;
          const [team] = await tx<{ id: string }[]>`select id from teams where active limit 1`;
          const [template] = await tx<{ id: string }[]>`
          select published_version_id as id from checklist_templates
          where published_version_id is not null limit 1
        `;
          const [company] = await tx<{ id: string }[]>`
          insert into companies (
            company_name,cr_number,br_number,incorporation_date,
            annual_return_basis_date,registered_office,company_secretary,
            status,assigned_owner_id,assigned_team_id
          ) values (
            'Historical Company',${"T28-CR-" + crypto.randomUUID()},
            ${"T28-BR-" + crypto.randomUUID()},'2020-01-01',
            '2027-01-01','Old Address','Test Secretary',
            'active',${owner.id},${team.id}
          ) returning id
        `;
          const [officer] = await tx<{ id: string }[]>`
          insert into officers (company_id,officer_type,name,appointment_date)
          values (${company.id},'director','Old Director','2020-01-01') returning id
        `;
          const [filing] = await tx<{ id: string }[]>`
          insert into annual_return_cases (
            company_id,return_year,made_up_date,filing_due_date,current_status,
            owner_id,template_version_id
          ) values (
            ${company.id},2027,'2027-01-01','2027-02-12','Upcoming',
            ${owner.id},${template.id}
          ) returning id
        `;
          const [party] = await tx<{ id: string; display_name: string }[]>`
          insert into case_parties (case_id,officer_id,party_type,display_name)
          select ${filing.id},id,officer_type,name from officers where id=${officer.id}
          returning id,display_name
        `;
          expect(party.display_name).toBe("Old Director");
          const repository = createCorporateChangeRequestRepository(undefined, { sql: tx });
          const nameRequest = await repository.createRequest({
            changeType: "name_change",
            companyId: company.id,
            quotedFee: 1000,
            newNameEn: "Current Company",
            newNameZh: null,
            actorId: owner.id,
          });
          const resignRequest = await repository.createRequest({
            changeType: "officer_change",
            companyId: company.id,
            quotedFee: 1000,
            officerAction: "resign",
            officerId: officer.id,
            newOfficerType: null,
            newOfficerName: null,
            newOfficerIdentificationType: null,
            newOfficerIdentificationNumber: null,
            newOfficerAddress: null,
            effectiveDate: "2026-09-01",
            actorId: owner.id,
          });
          for (const requestId of [nameRequest.id, resignRequest.id]) {
            for (const toStatus of [
              "Documents pending",
              "Ready to file",
              "Filed with Registrar",
            ] as const) {
              await repository.transitionStatus({ requestId, toStatus, actorId: owner.id });
            }
            await repository.completeRequest({ requestId, actorId: owner.id });
          }
          const [after] = await tx<
            {
              company_name: string;
              display_name: string;
              cessation_date: string;
            }[]
          >`
          select c.company_name,p.display_name,o.cessation_date::text
          from companies c join case_parties p on p.case_id=${filing.id}
          join officers o on o.id=p.officer_id where c.id=${company.id}
        `;
          expect(after).toEqual({
            company_name: "Current Company",
            display_name: "Old Director",
            cessation_date: "2026-09-01",
          });
          throw new Error("rollback T28 snapshot fixture");
        }),
      ).rejects.toThrow("rollback T28 snapshot fixture");
    } finally {
      await sql.end();
    }
  });

  it("t28_scenario_1 rejects a legacy cross-company share transfer at completion", async () => {
    const sql = createSqlClient(databaseUrl!, { max: 1 });
    try {
      await expect(
        sql.begin(async (tx) => {
          const [owner] = await tx<{ id: string }[]>`select id from users where active limit 1`;
          const [team] = await tx<{ id: string }[]>`select id from teams where active limit 1`;
          const companies: string[] = [];
          const holdings: string[] = [];
          for (let index = 0; index < 2; index += 1) {
            const [company] = await tx<{ id: string }[]>`
            insert into companies (
              company_name,cr_number,br_number,incorporation_date,
              annual_return_basis_date,registered_office,company_secretary,
              status,assigned_owner_id,assigned_team_id
            ) values (
              ${"T28 Transfer " + index},${"T28-CR-" + crypto.randomUUID()},
              ${"T28-BR-" + crypto.randomUUID()},'2020-01-01',
              '2027-01-01','Old Address','Test Secretary',
              'active',${owner.id},${team.id}
            ) returning id
          `;
            companies.push(company.id);
            const [holding] = await tx<{ id: string }[]>`
            insert into shareholdings (
              company_id,shareholder_name,share_class,number_of_shares,allotment_date
            ) values (${company.id},${"Holder " + index},'Ordinary',100,'2020-01-01')
            returning id
          `;
            holdings.push(holding.id);
          }
          const repository = createCorporateChangeRequestRepository(undefined, { sql: tx });
          const request = await repository.createRequest({
            changeType: "share_transfer",
            companyId: companies[0],
            quotedFee: 1000,
            transferorShareholdingId: holdings[0],
            sharesTransferred: 10,
            consideration: 100,
            stampDutyAmount: 0,
            transfereeShareholdingId: null,
            transfereeNewShareholderName: "New Holder",
            transfereeNewShareholderAddress: null,
            actorId: owner.id,
          });
          await tx`
          update corporate_change_requests
          set transferor_shareholding_id=${holdings[1]} where id=${request.id}
        `;
          for (const toStatus of [
            "Documents pending",
            "Ready to file",
            "Filed with Registrar",
          ] as const) {
            await repository.transitionStatus({
              requestId: request.id,
              toStatus,
              actorId: owner.id,
            });
          }
          await expect(
            repository.completeRequest({
              requestId: request.id,
              actorId: owner.id,
            }),
          ).rejects.toThrow(/shareholding.*company|company.*shareholding/i);
          const counts = await tx<{ number_of_shares: number }[]>`
          select number_of_shares from shareholdings
          where id in (${holdings[0]},${holdings[1]}) order by id
        `;
          expect(counts.map((row) => row.number_of_shares)).toEqual([100, 100]);
          throw new Error("rollback T28 legacy transfer fixture");
        }),
      ).rejects.toThrow("rollback T28 legacy transfer fixture");
    } finally {
      await sql.end();
    }
  });
});
