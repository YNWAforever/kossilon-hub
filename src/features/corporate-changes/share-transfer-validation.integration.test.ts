// Real SQL only on this run's verified, empty, disposable tmpfs database.
// Session/actor injection is intentional: this does not exercise Auth, HTTP or RLS.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { appendFileSync, closeSync, openSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getCurrentTest } from "@vitest/runner";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { SqlClient } from "@/server/db/client";
import type { CorporateChangeRequestRepository } from "./repository";
import type { CorporateChangeRequestDetail } from "./types";

const RUN = "cosec-20261024-transfer-f7337fb9";
const ROOT = "C:\\Users\\laich\\Documents\\kossilon-hub\\cosec-20261023";
const DATABASE = "cosec_transfer_f7337fb9";
const USER = "cosec_runner";
const run = process.env.COSEC_UC166_RUN_ID;
const cases = [
  "service-rejections",
  "repository-rejections",
  "sql-constraints",
  "service-role-denials",
  "control-new-holder",
  "control-existing-holder",
  "control-db-int-boundary",
  "rollback-third-checklist-child",
  "rollback-work-item-child",
] as const;
type Case = (typeof cases)[number];
type ObservedRow = { id: string; data: Record<string, unknown>; rowVersion: string };
type CreateForActor = (
  actor: AuthenticatedActor,
  input: unknown,
  dependencies: { repository: CorporateChangeRequestRepository },
) => Promise<CorporateChangeRequestDetail>;
type Target = {
  containerId: string;
  uri: string;
  port: number;
  counts: Record<string, number>;
  configuration: Record<string, string>;
  identity: { systemId: string; database: string; user: string };
};
type Gate = {
  verifyOwnedTarget: () => Promise<Target>;
  verifyEmptyConfiguredTarget: () => Promise<Target>;
  publicTarget: (target: Target) => object;
  FOUNDATION: { user: string; calendar: string; policy: string };
};
let cleanupFailed = false;
function plannedIds() {
  const next = () => `f7337fb9-0166-4166-8166-${randomBytes(6).toString("hex")}`;
  return {
    company: next(),
    teams: [next(), next()],
    users: [next(), next(), next(), next(), next(), next()],
    holdings: [next(), next()],
    rawRequest: next(),
  };
}
type Ids = ReturnType<typeof plannedIds>;
function errorFacts(error: unknown) {
  const value = error as
    | {
        name?: string;
        message?: string;
        code?: string;
        detail?: string;
        constraint_name?: string;
        issues?: { path: PropertyKey[]; message: string }[];
      }
    | undefined;
  return {
    name: value?.name,
    message: value?.message,
    code: value?.code,
    detail: value?.detail,
    constraint: value?.constraint_name,
    issues: value?.issues?.map((issue) => ({ path: issue.path, message: issue.message })),
  };
}
function outcome<T>(action: Promise<T>) {
  return action.then(
    (value) => ({ value, error: undefined }),
    (error: unknown) => ({ value: undefined, error }),
  );
}
async function sqlIdentity(sql: SqlClient, target: Target) {
  const [row] = await sql`select current_database() database,current_user username,
    (select system_identifier::text from pg_control_system()) system_id,
    inet_server_addr()::text server_address,inet_server_port() server_port,pg_backend_pid() pid`;
  assert.equal(row.database, DATABASE);
  assert.equal(row.username, USER);
  assert.equal(row.system_id, target.identity.systemId);
  assert.equal(row.server_port, 5432);
  assert(row.server_address);
  return row;
}

// Full persisted rows + xmin catch timestamp churn and stock/register changes.
// IDs discovered through the exact planned parent are recorded before cleanup.
async function snapshot(sql: SqlClient, ids: Ids) {
  const requests = await sql<
    ObservedRow[]
  >`select r.id,to_jsonb(r) data,r.xmin::text as "rowVersion"
    from corporate_change_requests r where r.company_id=${ids.company} order by r.id`;
  const checklist = await sql<
    ObservedRow[]
  >`select c.id,to_jsonb(c) data,c.xmin::text as "rowVersion"
    from corporate_change_checklist_items c join corporate_change_requests r on r.id=c.request_id
    where r.company_id=${ids.company} order by c.id`;
  const workItems = await sql<
    ObservedRow[]
  >`select w.id,to_jsonb(w) data,w.xmin::text as "rowVersion"
    from work_items w where w.company_id=${ids.company} order by w.id`;
  const assignments = await sql<
    ObservedRow[]
  >`select e.id,to_jsonb(e) data,e.xmin::text as "rowVersion"
    from assignment_events e join work_items w on w.id=e.work_item_id where w.company_id=${ids.company} order by e.id`;
  const escalations = await sql<
    ObservedRow[]
  >`select e.id,to_jsonb(e) data,e.xmin::text as "rowVersion"
    from escalation_events e join work_items w on w.id=e.work_item_id where w.company_id=${ids.company} order by e.id`;
  const outbox = await sql<ObservedRow[]>`select n.id,to_jsonb(n) data,n.xmin::text as "rowVersion"
    from notification_outbox n where n.company_id=${ids.company} order by n.id`;
  const timeline = await sql<
    ObservedRow[]
  >`select e.id,to_jsonb(e) data,e.xmin::text as "rowVersion"
    from timeline_events e where e.company_id=${ids.company} order by e.id`;
  const holdings = await sql<
    ObservedRow[]
  >`select s.id,to_jsonb(s) data,s.xmin::text as "rowVersion"
    from shareholdings s where s.company_id=${ids.company} order by s.id`;
  const companies = await sql<
    ObservedRow[]
  >`select c.id,to_jsonb(c) data,c.xmin::text as "rowVersion"
    from companies c where c.id=${ids.company} order by c.id`;
  const users = await sql<ObservedRow[]>`select u.id,to_jsonb(u) data,u.xmin::text as "rowVersion"
    from users u where u.id=any(${ids.users}::uuid[]) order by u.id`;
  const teams = await sql<ObservedRow[]>`select t.id,to_jsonb(t) data,t.xmin::text as "rowVersion"
    from teams t where t.id=any(${ids.teams}::uuid[]) order by t.id`;
  return {
    requests: [...requests],
    checklist: [...checklist],
    workItems: [...workItems],
    assignments: [...assignments],
    escalations: [...escalations],
    outbox: [...outbox],
    timeline: [...timeline],
    holdings: [...holdings],
    companies: [...companies],
    users: [...users],
    teams: [...teams],
  };
}

describe.skipIf(!run)("UC166 injected actor / real SQL rejection and atomic create", () => {
  it.each(cases)(
    "%s",
    async (name) => {
      if (cleanupFailed)
        throw new Error("Earlier exact cleanup failed; stop all later fixture writes.");
      const attempt = process.env.COSEC_UC166_ATTEMPT;
      const directory = process.env.COSEC_UC166_EVENTS_DIR;
      const uri = process.env.TEST_DATABASE_URL;
      if (
        run !== RUN ||
        !attempt ||
        !/^[a-z0-9][a-z0-9-]{0,63}$/.test(attempt) ||
        !uri ||
        uri !== process.env.DATABASE_URL ||
        !directory ||
        process.env.COSEC_UC166_DB_NAME !== DATABASE ||
        !/^[a-f0-9]{64}$/.test(process.env.COSEC_UC166_TARGET_ID ?? "") ||
        !/^\d+$/.test(process.env.COSEC_UC166_SYSTEM_ID ?? "")
      )
        throw new Error("Exact parent-gated UC166 markers required.");
      assert.equal(realpathSync(process.cwd()).toLowerCase(), ROOT.toLowerCase());
      const folder = resolve(directory);
      assert.equal(folder, resolve(ROOT, "docs/audit-remediation", RUN, "db"));
      assert.equal(realpathSync(folder), folder);
      assert.equal(realpathSync(dirname(folder)), dirname(folder));
      const url = new URL(uri);
      assert.equal(url.protocol, "postgresql:");
      assert.equal(url.hostname, "127.0.0.1");
      assert.equal(url.username, USER);
      assert.equal(url.pathname, "/" + DATABASE);
      assert(url.port);
      assert(!url.search && !url.hash);
      const signal = getCurrentTest()?.context.signal;
      if (!signal) throw new Error("Active test lifetime required.");
      const pending = scenario(name, uri, folder, attempt, signal);
      onTestFinished(async () => {
        await pending.catch(() => undefined);
      });
      await pending;
    },
    60_000,
  );
});

async function scenario(
  name: Case,
  uri: string,
  folder: string,
  attempt: string,
  signal: AbortSignal,
) {
  const fd = openSync(resolve(folder, `UC166-${name}-${attempt}.jsonl`), "wx");
  const record = (phase: string, data: object) =>
    appendFileSync(
      fd,
      JSON.stringify({ run: RUN, attempt, scenario: name, phase, ...data }, (_key, value) =>
        typeof value === "number" && !Number.isFinite(value) ? String(value) : value,
      ) + "\n",
    );
  const ids = plannedIds();
  const failures: unknown[] = [];
  let writerRaw: SqlClient | undefined, observerRaw: SqlClient | undefined;
  let fixtureStarted = false;
  let gate: Gate | undefined, initial: Target | undefined;
  const external = vi.fn(() => {
    throw new Error("UC166 must not call external HTTP/provider transport.");
  });
  try {
    record("planned-ids", {
      ids,
      nativeAuth: false,
      nativeHttp: false,
      dbRls: false,
      injectedActor: true,
    });
    signal.throwIfAborted();
    // Only a side-effect-free Node helper is imported before the identity gate.
    // It independently checks Docker metadata, host TCP/container system ID,
    // every public business table, and the exact retained foundation IDs.
    const helperUrl = pathToFileURL(
      resolve(ROOT, "docs/audit-remediation", RUN, "isolated-db-runner.mjs"),
    ).href;
    gate = (await import(/* @vite-ignore */ helperUrl)) as Gate;
    initial = await gate.verifyEmptyConfiguredTarget();
    assert.equal(initial.containerId, process.env.COSEC_UC166_TARGET_ID);
    assert.equal(initial.identity.systemId, process.env.COSEC_UC166_SYSTEM_ID);
    assert.equal(uri, initial.uri);
    record("before-any-application-import-or-client", gate.publicTarget(initial));
    signal.throwIfAborted();
    vi.stubGlobal("fetch", external);
    const [
      { createSqlClient },
      { guardSqlTestLifetime },
      { createCorporateChangeRequestRepository },
      { createCorporateChangeRequestForActor },
      { createCorporateChangeRequestSchema },
    ] = await Promise.all([
      import("@/server/db/client"),
      import("@/test/sql-test-lifetime"),
      import("./repository"),
      import("./create"),
      import("./create-input"),
    ]);
    writerRaw = createSqlClient(uri, { max: 1, ssl: false });
    observerRaw = createSqlClient(uri, { max: 1, ssl: false });
    const writer = guardSqlTestLifetime(writerRaw, () => signal),
      observer = guardSqlTestLifetime(observerRaw, () => signal);
    const [a, b] = await Promise.all([
      sqlIdentity(writer, initial),
      sqlIdentity(observer, initial),
    ]);
    assert.notEqual(a.pid, b.pid);
    assert.equal(a.server_address, b.server_address);
    record("independent-physical-sessions", { writer: a, observer: b });
    const repository = createCorporateChangeRequestRepository(undefined, { sql: writer });
    const reader = createCorporateChangeRequestRepository(undefined, { sql: observer });
    const roles = ["Staff", "Staff", "Manager", "Admin", "Admin", "Staff"] as const;
    const actor = (index = 0): AuthenticatedActor => ({
      userId: ids.users[index],
      authUserId: RUN + ":" + ids.users[index],
      role: roles[index],
      teamId: index === 5 ? null : ids.teams[index === 1 || index === 2 ? 1 : 0],
      active: index !== 4,
    });
    const input = () => ({
      changeType: "share_transfer" as const,
      companyId: ids.company,
      quotedFee: 2500,
      transferorShareholdingId: ids.holdings[0],
      transfereeShareholdingId: null as string | null,
      transfereeNewShareholderName: "Synthetic UC166 new holder" as string | null,
      transfereeNewShareholderAddress: "Synthetic UC166 address",
      sharesTransferred: 10,
      consideration: 0,
      stampDutyAmount: 0,
    });
    type Input = ReturnType<typeof input>;
    const service = createCorporateChangeRequestForActor as CreateForActor;
    const create = (data: unknown = input(), who = actor(), repo = repository) =>
      service(who, data, { repository: repo });
    fixtureStarted = true;
    await writer.begin(async (tx) => {
      for (const id of ids.teams)
        await tx`insert into teams(id,name) values(${id},${RUN + ":" + id})`;
      for (const [index, id] of ids.users.entries()) {
        const who = actor(index);
        await tx`insert into users(id,name,email,role,team_id,active) values(${id},${"Synthetic UC166 " + index},${id + "@example.test"},${who.role},${who.teamId},${who.active})`;
      }
      await tx`insert into companies(id,company_name,cr_number,br_number,incorporation_date,annual_return_basis_date,
        registered_office,company_secretary,assigned_owner_id,assigned_team_id,data_origin)
        values(${ids.company},${RUN + ":" + ids.company},${ids.company},${ids.company},'2020-01-01','2026-01-01',
          'Synthetic UC166 office','Synthetic UC166 secretary',${ids.users[0]},${ids.teams[0]},'client')`;
      for (const [index, id] of ids.holdings.entries())
        await tx`insert into shareholdings(id,company_id,shareholder_name,share_class,number_of_shares,allotment_date)
        values(${id},${ids.company},${"Synthetic UC166 holder " + index},'Ordinary',${index === 0 ? 2147483647 : 100},'2020-01-01')`;
    });
    const baseline = await snapshot(observer, ids);
    record("fixture-baseline", baseline);
    assert.equal(baseline.requests.length, 0);
    assert.equal(baseline.checklist.length, 0);
    assert.equal(baseline.workItems.length, 0);
    assert.equal(baseline.timeline.length, 0);
    assert.equal(baseline.holdings.length, 2);
    const rejected = async (
      label: string,
      data: unknown,
      action: () => Promise<unknown>,
      fields: string[] = [],
    ) => {
      const result = await outcome(Promise.resolve().then(action));
      const facts = errorFacts(result.error),
        after = await snapshot(observer, ids);
      record("rejection-readback", {
        label,
        input: data,
        error: facts,
        returned: result.value ?? null,
        after,
      });
      expect.soft(result.error, label).toBeDefined();
      expect.soft(result.value, label).toBeUndefined();
      if (fields.length)
        expect
          .soft(
            facts.issues?.map((issue) => issue.path[0]),
            label,
          )
          .toEqual(expect.arrayContaining(fields));
      // Explicitly covers requests, all checklist children, work/event keys,
      // assignment/escalation events, timeline, outbox, and stock/register rows.
      expect.soft(after, label).toEqual(baseline);
      return facts;
    };

    if (name === "service-rejections" || name === "repository-rejections") {
      const bad: { label: string; patch: Partial<Input>; fields: string[] }[] = [
        ...[null, "", "   ", "\t\n"].map((value, i) => ({
          label: "missing-or-blank-transferee-" + i,
          patch: { transfereeNewShareholderName: value },
          fields: ["transfereeShareholdingId", "transfereeNewShareholderName"],
        })),
        {
          label: "dual-transferees",
          patch: { transfereeShareholdingId: ids.holdings[1] },
          fields: ["transfereeShareholdingId", "transfereeNewShareholderName"],
        },
        ...[
          0,
          -1,
          1.5,
          NaN,
          Infinity,
          -Infinity,
          2147483648,
          Number.MAX_SAFE_INTEGER,
          Number.MAX_SAFE_INTEGER + 1,
        ].map((value) => ({
          label: "invalid-quantity-" + String(value),
          patch: { sharesTransferred: value },
          fields: ["sharesTransferred"],
        })),
      ];
      for (const vector of bad) {
        const data = { ...input(), ...vector.patch };
        await rejected(
          vector.label,
          data,
          () =>
            name === "service-rejections"
              ? create(data)
              : repository.createRequest({ ...data, actorId: ids.users[0] }),
          vector.fields,
        );
      }
    } else if (name === "sql-constraints") {
      // Test the CURRENT, UNMODIFIED SQL constraints separately from service
      // validation. PostgreSQL text->integer input rejects fractional strings;
      // this is not a claim that the SQL schema rejects whitespace holder names.
      const vectors = [
        {
          label: "missing-xor",
          holder: null,
          newName: null,
          quantity: "10",
          code: "23514",
          constraint: "corporate_change_requests_type_fields_check",
        },
        {
          label: "dual-xor",
          holder: ids.holdings[1],
          newName: "Synthetic dual",
          quantity: "10",
          code: "23514",
          constraint: "corporate_change_requests_type_fields_check",
        },
        { label: "zero", holder: null, newName: "Synthetic new", quantity: "0", code: "23514" },
        {
          label: "negative",
          holder: null,
          newName: "Synthetic new",
          quantity: "-1",
          code: "23514",
        },
        {
          label: "fractional-wire-input",
          holder: null,
          newName: "Synthetic new",
          quantity: "1.5",
          code: "22P02",
        },
        {
          label: "nan-wire-input",
          holder: null,
          newName: "Synthetic new",
          quantity: "NaN",
          code: "22P02",
        },
        {
          label: "infinite-wire-input",
          holder: null,
          newName: "Synthetic new",
          quantity: "Infinity",
          code: "22P02",
        },
        {
          label: "out-of-db-int",
          holder: null,
          newName: "Synthetic new",
          quantity: "2147483648",
          code: "22003",
        },
      ];
      for (const vector of vectors) {
        const facts = await rejected(vector.label, vector, () =>
          writer.begin(async (tx) => {
            await tx`insert into corporate_change_requests(id,company_id,change_type,owner_id,quoted_fee,transferor_shareholding_id,
            transferee_shareholding_id,transferee_new_shareholder_name,shares_transferred,consideration,stamp_duty_amount)
            values(${ids.rawRequest},${ids.company},'share_transfer',${ids.users[0]},2500,${ids.holdings[0]},${vector.holder},${vector.newName},${vector.quantity}::integer,0,0)`;
          }),
        );
        expect.soft(facts.code, vector.label).toBe(vector.code);
        if (vector.constraint) expect.soft(facts.constraint, vector.label).toBe(vector.constraint);
      }
    } else if (name === "service-role-denials") {
      const denied: [string, AuthenticatedActor][] = [
        ["cross-team-staff", actor(1)],
        ["cross-team-manager", actor(2)],
        ["inactive-admin", actor(4)],
        ["teamless-staff", actor(5)],
        ["client", { ...actor(), role: "Client", userId: null, teamId: null }],
        ["staff-without-db-identity", { ...actor(), userId: null }],
      ];
      // getCompanyTeamId uses the injected REAL SQL repository. The authorization
      // assertion is neither mocked nor invoked directly by this test.
      expect(await repository.getCompanyTeamId(ids.company)).toBe(ids.teams[0]);
      for (const [label, who] of denied) {
        const facts = await rejected(label, { actor: who, input: input() }, () =>
          create(input(), who),
        );
        expect.soft(facts.message, label).toMatch(/^Forbidden:/);
      }
    } else if (name.startsWith("control-")) {
      const data = { ...input(), transfereeNewShareholderName: " \tSynthetic UC166 new holder\n " };
      if (name === "control-existing-holder") {
        data.transfereeShareholdingId = ids.holdings[1];
        data.transfereeNewShareholderName = " \t ";
      }
      if (name === "control-db-int-boundary") data.sharesTransferred = 2147483647;
      const parsed = createCorporateChangeRequestSchema.parse(data);
      const saved = await create(data),
        detail = await reader.getRequest(saved.id),
        after = await snapshot(observer, ids);
      record("successful-independent-readback", { savedId: saved.id, parsed, detail, after });
      expect(saved.id).toBe(detail.id);
      expect(after.requests).toHaveLength(1);
      expect(detail).toMatchObject({
        companyId: ids.company,
        changeType: "share_transfer",
        status: "Requested",
        ownerId: ids.users[0],
        sharesTransferred: data.sharesTransferred,
        transfereeShareholdingId: data.transfereeShareholdingId,
        transfereeNewShareholderName:
          name === "control-existing-holder" ? null : "Synthetic UC166 new holder",
      });
      expect(after.checklist).toHaveLength(5);
      expect(detail.checklistItems).toHaveLength(5);
      expect(detail.checklistItems.map((item) => item.itemLabel).sort()).toEqual(
        [
          "Bought & Sold Note",
          "Instrument of Transfer",
          "Transferee ID/address proof",
          "Stamp duty payment receipt",
          "Updated register of members",
        ].sort(),
      );
      for (const row of after.checklist)
        expect(row.data).toMatchObject({ request_id: saved.id, status: "Missing", required: true });
      expect(after.workItems).toHaveLength(1);
      expect(after.workItems[0].data).toMatchObject({
        company_id: ids.company,
        corporate_change_request_id: saved.id,
        case_type: "corporate_change_request",
        owner_id: ids.users[0],
        team_id: ids.teams[0],
        source_event_key: `corporate-change:${saved.id}:created`,
        source_event_type: "corporate_change_request_created",
        work_type: "corporate_change_request",
        status: "open",
        sla_policy_version_id: gate.FOUNDATION.policy,
      });
      expect(after.assignments).toEqual([]);
      expect(after.escalations).toEqual([]);
      expect(after.timeline).toEqual([]);
      expect(after.outbox).toEqual([]);
      expect(after.holdings).toEqual(baseline.holdings);
      expect(after.companies).toEqual(baseline.companies);
      expect(after.users).toEqual(baseline.users);
      expect(after.teams).toEqual(baseline.teams);
    } else {
      const workFailure = name === "rollback-work-item-child";
      const objectName = "uc166_fail_" + ids.company.replaceAll("-", "");
      const childTable = workFailure ? "work_items" : "corporate_change_checklist_items";
      const condition = workFailure
        ? `new.company_id = '${ids.company}'::uuid and new.owner_id = '${ids.users[0]}'::uuid`
        : `new.request_id in (select id from public.corporate_change_requests where company_id='${ids.company}'::uuid and owner_id='${ids.users[0]}'::uuid)`;
      const expectedChildren = workFailure ? 5 : 2;
      const result = await outcome(
        writer.begin(async (tx) => {
          await tx`select set_config('cosec.uc166.run',${RUN},true)`;
          // Identifiers and literals below are internally generated/validated UUIDs
          // and constants. No user data or external SQL is interpolated.
          assert.match(ids.company, /^f7337fb9-0166-4166-8166-[a-f0-9]{12}$/);
          assert.match(ids.users[0], /^f7337fb9-0166-4166-8166-[a-f0-9]{12}$/);
          await tx.unsafe(`create function public.${objectName}() returns trigger language plpgsql set search_path=pg_catalog,public as $uc166$
          declare parent_id uuid; children integer;
          begin
            if current_database()='${DATABASE}' and current_setting('cosec.uc166.run',true)='${RUN}' and ${condition} then
              select id into parent_id from public.corporate_change_requests where company_id='${ids.company}'::uuid and owner_id='${ids.users[0]}'::uuid;
              select count(*) into children from public.corporate_change_checklist_items where request_id=parent_id;
              if children=${expectedChildren} then
                raise exception using errcode='P0166', message='UC166 forced ${childTable} child failure',
                  detail=json_build_object('run','${RUN}','companyId','${ids.company}','requestId',parent_id,'checklistChildrenBeforeFailure',children)::text;
              end if;
            end if;
            return new;
          end $uc166$`);
          await tx.unsafe(
            `create trigger ${objectName} before insert on public.${childTable} for each row execute function public.${objectName}()`,
          );
          const transactional = createCorporateChangeRequestRepository(undefined, { sql: tx });
          return create(input(), actor(), transactional);
        }),
      );
      const facts = errorFacts(result.error),
        after = await snapshot(observer, ids);
      record("forced-child-failure-and-observer-readback", {
        childTable,
        expectedChildren,
        error: facts,
        returned: result.value ?? null,
        after,
      });
      expect(facts.code).toBe("P0166");
      expect(facts.message).toBe(`UC166 forced ${childTable} child failure`);
      const detail = JSON.parse(facts.detail ?? "null") as {
        requestId: string;
        checklistChildrenBeforeFailure: number;
      };
      expect(detail).toMatchObject({
        run: RUN,
        companyId: ids.company,
        checklistChildrenBeforeFailure: expectedChildren,
      });
      expect(detail.requestId).toMatch(/^[a-f0-9-]{36}$/);
      expect(after).toEqual(baseline);
      const objects =
        await observer`select 'function' kind from pg_proc where pronamespace='public'::regnamespace and proname=${objectName}
        union all select 'trigger' kind from pg_trigger where tgname=${objectName}`;
      expect(objects).toHaveLength(0);
      record("transactional-trigger-also-rolled-back", { objectName, objects });
    }
    expect(external).not.toHaveBeenCalled();
    record("scenario-body-finished", { externalHttpCalls: external.mock.calls.length });
  } catch (error) {
    failures.push(error);
    record("scenario-failure", { error: errorFacts(error) });
  } finally {
    try {
      if (fixtureStarted && writerRaw && observerRaw && gate && initial) {
        // Fresh full metadata + published TCP/server control identity before any
        // cleanup. Raw clients are used only after the test body has drained.
        const current = await gate.verifyOwnedTarget();
        assert.equal(current.containerId, initial.containerId);
        assert.equal(current.uri, initial.uri);
        assert.equal(current.identity.systemId, initial.identity.systemId);
        assert.deepEqual(
          current.configuration,
          initial.configuration,
          "Migration configuration changed",
        );
        record("precleanup-target-regate", gate.publicTarget(current));
        await sqlIdentity(writerRaw, current);
        await sqlIdentity(observerRaw, current);
        const tree = await snapshot(observerRaw, ids);
        record(
          "exact-child-first-cleanup-ids",
          Object.fromEntries(
            Object.entries(tree).map(([table, rows]) => [table, rows.map((row) => row.id)]),
          ),
        );
        const cleanupSql = writerRaw;
        await cleanupSql.begin(async (tx) => {
          // Only exact IDs observed through our exact parent IDs; no broad
          // delete, truncate, trigger bypass or application seed cleanup.
          const remove = async (table: string, rows: ObservedRow[]) => {
            const owned = rows.map((row) => row.id).sort();
            const removed = await tx<
              { id: string }[]
            >`delete from public.${tx(table)} where id=any(${owned}::uuid[]) returning id`;
            assert.deepEqual(removed.map((row) => row.id).sort(), owned);
          };
          await remove("notification_outbox", tree.outbox);
          await remove("assignment_events", tree.assignments);
          await remove("escalation_events", tree.escalations);
          await remove("corporate_change_checklist_items", tree.checklist);
          await remove("work_items", tree.workItems);
          await remove("timeline_events", tree.timeline);
          await remove("corporate_change_requests", tree.requests);
          await remove("shareholdings", tree.holdings);
          await remove("companies", tree.companies);
          await remove("users", tree.users);
          await remove("teams", tree.teams);
        });
        const after = await snapshot(observerRaw, ids);
        record("independent-zero-owned-row-readback", after);
        for (const rows of Object.values(after)) assert.equal(rows.length, 0);
        const clean = await gate.verifyEmptyConfiguredTarget();
        assert.deepEqual(clean.counts, initial.counts);
        assert.deepEqual(clean.configuration, initial.configuration);
        record("all-public-business-counts-restored", gate.publicTarget(clean));
      }
    } catch (error) {
      cleanupFailed = true;
      failures.push(error);
      record("cleanup-failure-preserved-no-retry", { error: errorFacts(error), ids });
    } finally {
      vi.unstubAllGlobals();
      const closed = await Promise.allSettled([writerRaw?.end(), observerRaw?.end()]);
      for (const result of closed)
        if (result.status === "rejected") {
          cleanupFailed = true;
          failures.push(result.reason);
          record("client-close-failure", { error: errorFacts(result.reason) });
        }
      closeSync(fd);
    }
  }
  if (failures.length)
    throw new AggregateError(
      failures,
      `UC166 ${name} failed; immutable attempt evidence retained.`,
    );
}
