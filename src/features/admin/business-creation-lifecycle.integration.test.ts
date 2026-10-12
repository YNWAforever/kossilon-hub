import "dotenv/config";
import { it, expect } from "vitest";
import type postgres from "postgres";
import { createSqlClient, type SqlClient } from "@/server/db/client";
import { businessCaseFixture } from "@/test/business-case-fixture";
import { createClientRepository } from "@/features/clients/repository";
import { createAdminRepository } from "./repository";
import { createIncorporationRepository } from "@/features/incorporation/repository";
import { createCorporateChangeRequestRepository } from "@/features/corporate-changes/repository";
const url = process.env.TEST_DATABASE_URL;
function readBarrier(sql: SqlClient, userId: string, onRead: () => void, gate: Promise<void>) {
  let seen = false;
  const wrap = <T extends SqlClient | postgres.TransactionSql>(db: T): T =>
    new Proxy(db, {
      get(target, key, receiver) {
        if (key === "begin" && "begin" in target)
          return <R>(fn: (tx: postgres.TransactionSql) => Promise<R>) =>
            (target as SqlClient).begin((tx) => fn(wrap(tx)));
        return Reflect.get(target, key, receiver);
      },
      apply(target, thisArg, args) {
        const query = Reflect.apply(target, thisArg, args);
        const text = Array.isArray(args[0]) ? args[0].join(" ") : "";
        if (!seen && /from users/.test(text) && args.slice(1).includes(userId)) {
          seen = true;
          return Promise.resolve(query).then(async (rows) => {
            onRead();
            await gate;
            return rows;
          });
        }
        return query;
      },
    });
  return wrap(sql);
}
it.skipIf(!url).each(["incorporation", "corporate_change_request", "client_company"] as const)(
  "review: %s creation holds current staff authorization until commit",
  async (kind) => {
    const sql = createSqlClient(url!, { max: 3 }),
      disabling = createSqlClient(url!, { max: 1 });
    const f = await businessCaseFixture(sql, 1),
      adminId = crypto.randomUUID(),
      staffId = crypto.randomUUID(),
      authUserId = "review-admin-" + adminId;
    await sql`insert into users(id,name,email,role,team_id) values(${adminId},'Owned lifecycle Admin',${adminId + "@fixture.invalid"},'Admin',${f.team}),(${staffId},'Owned lifecycle staff',${staffId + "@fixture.invalid"},'Staff',${f.team})`;
    await sql`insert into staff_profiles(user_id,auth_user_id,role,team_id) values(${adminId},${authUserId},'Admin',${f.team}),(${staffId},${"review-staff-" + staffId},'Staff',${f.team})`;
    let release!: () => void, observed!: () => void;
    const gate = new Promise<void>((r) => (release = r)),
      ready = new Promise<void>((r) => (observed = r)),
      barrier = readBarrier(sql, staffId, observed, gate);
    let createdCompanyId: string | undefined;
    let creating: Promise<unknown> | undefined, disable: Promise<unknown> | undefined;
    try {
      const [pid] = await disabling`select pg_backend_pid() pid`;
      creating =
        kind === "incorporation"
          ? createIncorporationRepository({ sql: barrier }).createCase({
              proposedCompanyNameEn: f.tag + " lifecycle",
              proposedCompanyNameZh: null,
              proposedRegisteredOffice: "Owned",
              proposedCompanySecretary: "Owned",
              registeredCapital: 1000,
              businessNature: "Owned",
              ownerId: staffId,
              teamId: f.team,
              targetCompletionDate: "2026-10-30",
              actorId: adminId,
            })
          : kind === "client_company"
            ? createClientRepository({ sql: barrier })
                .createClient({
                  companyName: f.tag + " lifecycle",
                  crNumber: f.tag + " lifecycle",
                  brNumber: f.tag + " lifecycle",
                  incorporationDate: "2020-01-01",
                  annualReturnBasisDate: "2026-01-01",
                  registeredOffice: "Owned",
                  companySecretary: "Owned",
                  ownerId: staffId,
                  teamId: f.team,
                  contacts: [],
                  actorId: adminId,
                })
                .then((r) => {
                  createdCompanyId = r.id;
                  return r;
                })
            : createCorporateChangeRequestRepository(undefined, { sql: barrier }).createRequest({
                companyId: f.companies.a,
                changeType: "name_change",
                quotedFee: 1000,
                newNameEn: f.tag + " new",
                newNameZh: null,
                actorId: staffId,
              });
      const guarded = await Promise.race([ready.then(() => true), creating.then(() => false)]);
      if (!guarded) {
        expect(guarded, "creation must read current staff state inside the transaction").toBe(true);
        return;
      }
      disable = createAdminRepository({ sql: disabling })
        .updateStaff(
          { userId: adminId, authUserId, role: "Admin", teamId: f.team, active: true },
          { userId: staffId, expectedVersion: 1, role: "Staff", teamId: f.team, active: false },
        )
        .then(
          (r) => ({ saved: r }),
          (error) => ({ error }),
        );
      let locked = false;
      for (let n = 0; n < 50; n++) {
        const [state] =
          await sql`select wait_event_type from pg_stat_activity where pid=${pid.pid}`;
        if (state?.wait_event_type === "Lock") {
          locked = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      release();
      await creating;
      const outcome = (await disable) as { error?: Error };
      expect(locked, "disable must wait for the business creation identity lock").toBe(true);
      expect(outcome.error?.message).toMatch(/handover/i);
      const [staff] = await sql`select active from users where id=${staffId}`;
      expect(staff.active).toBe(true);
    } finally {
      release();
      await creating?.catch(() => {});
      await disable?.catch(() => {});
      const companyIds = [
        ...Object.values(f.companies),
        ...(createdCompanyId ? [createdCompanyId] : []),
      ];
      await sql.begin(async (tx) => {
        await tx`delete from assignment_events where work_item_id in(select id from work_items where company_id=any(${companyIds}::uuid[]))`;
        await tx`delete from work_items where company_id=any(${companyIds}::uuid[])`;
        await tx`delete from timeline_events where company_id=any(${companyIds}::uuid[])`;
        await tx`delete from corporate_change_requests where company_id=any(${companyIds}::uuid[])`;
        await tx`delete from incorporation_cases where team_id=any(${[f.team, f.foreignTeam]}::uuid[])`;
        await tx`delete from officers where company_id=any(${companyIds}::uuid[])`;
        await tx`delete from shareholdings where company_id=any(${companyIds}::uuid[])`;
        await tx`delete from significant_controllers where company_id=any(${companyIds}::uuid[])`;
        await tx`delete from scr_inspection_requests where company_id=any(${companyIds}::uuid[])`;
        await tx`delete from company_contacts where company_id=any(${companyIds}::uuid[])`;
        await tx`delete from companies where id=any(${companyIds}::uuid[])`;
        await tx`delete from staff_access_events where target_user_id=any(${[adminId, staffId]}::uuid[]) or actor_user_id=${adminId}`;
        await tx`delete from staff_profiles where user_id=any(${[adminId, staffId]}::uuid[])`;
        await tx`delete from users where id=any(${[adminId, staffId, f.owner, f.colleague, f.foreignOwner]}::uuid[])`;
        await tx`delete from teams where id=any(${[f.team, f.foreignTeam]}::uuid[])`;
      });
      await disabling.end();
      await sql.end();
    }
  },
  30000,
);
