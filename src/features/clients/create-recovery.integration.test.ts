import { randomInt, randomUUID } from "node:crypto";
import { appendFileSync, closeSync, openSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { getCurrentTest } from "@vitest/runner";
import { describe, expect, it, onTestFinished } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import { createSqlClient } from "@/server/db/client";
import { guardSqlTestLifetime } from "@/test/sql-test-lifetime";
import { createClientRepository } from "./repository";
import { createClientForActor, createClientSchema } from "./server-fns";
import type { CreateClientInput } from "./types";

const url = process.env.TEST_DATABASE_URL;
const run = process.env.KOSSILON_CLIENT_CREATE_RUN_ID;
const attempt = process.env.KOSSILON_CLIENT_CREATE_ATTEMPT;
const directory = process.env.KOSSILON_CLIENT_CREATE_EVENTS_DIR;
let cleanupFailed = false;
const scenarios = [
  "UC135-companyName",
  "UC135-registeredOffice",
  "UC135-companySecretary",
  "UC135-correction",
  "UC135-rollback",
  "UC136-crNumber",
  "UC136-brNumber",
  "UC136-race-crNumber",
  "UC136-race-brNumber",
  "UC137-certificate",
] as const;
type Scenario = (typeof scenarios)[number];
async function outcome<T>(action: Promise<T>) {
  return action.then(
    (value) => ({ value, error: undefined }),
    (error: unknown) => ({ value: undefined, error }),
  );
}
function errorFacts(error: unknown) {
  const value = error as
    | {
        name?: string;
        message?: string;
        field?: string;
        code?: string;
        issues?: { path: PropertyKey[]; message: string }[];
      }
    | undefined;
  return {
    name: value?.name,
    message: value?.message,
    field: value?.field,
    code: value?.code,
    issues: value?.issues?.map((i) => ({ path: i.path, message: i.message })),
  };
}
describe.skipIf(!url || !run)(
  "UC135–137 client validation, duplicate refusal and normalized readback",
  () => {
    it.each(scenarios)(
      "%s",
      async (name) => {
        if (cleanupFailed) throw new Error("Earlier precise cleanup failed; stop fixture writes.");
        if (
          !url ||
          !run ||
          !/^cosec-20261023-clients-[a-f0-9]{8}$/.test(run) ||
          !attempt ||
          !/^[a-z0-9-]+$/.test(attempt) ||
          !directory ||
          !/^[a-f0-9]{64}$/.test(process.env.KOSSILON_CLIENT_CREATE_TARGET_ID ?? "")
        )
          throw new Error("Fresh verified client target required.");
        const target = new URL(url);
        expect(target.hostname).toBe("127.0.0.1");
        expect(target.pathname).toBe("/" + process.env.KOSSILON_CLIENT_CREATE_DB_NAME);
        const folder = resolve(directory),
          local = relative(resolve("docs/audit-remediation", run), folder);
        if (
          isAbsolute(local) ||
          local.startsWith("..") ||
          realpathSync(folder) !== folder ||
          realpathSync(dirname(folder)) !== dirname(folder)
        )
          throw new Error("Redirected artifact path.");
        const context = getCurrentTest()?.context;
        if (!context) throw new Error("Running test lifetime required.");
        const pending = scenario(
          url,
          run,
          name,
          resolve(folder, `${name}-${attempt}.jsonl`),
          context.signal,
        );
        onTestFinished(async () => {
          await pending.catch(() => undefined);
        });
        await pending;
      },
      45_000,
    );
  },
);

async function scenario(
  databaseUrl: string,
  tag: string,
  name: Scenario,
  path: string,
  signal: AbortSignal,
) {
  const fd = openSync(path, "wx");
  const record = (phase: string, values: object) =>
    appendFileSync(fd, JSON.stringify({ runId: tag, scenario: name, phase, ...values }) + "\n");
  const ids = {
    teams: [randomUUID(), randomUUID()],
    users: Array.from({ length: 4 }, () => randomUUID()),
  };
  const baseCr = String(randomInt(10000000, 80000000)),
    baseBr = String(randomInt(10000000, 80000000));
  record("planned-ids", {
    ids,
    identifiers: { baseCr, baseBr },
    synthetic: true,
    nativeAuth: false,
  });
  const raw = createSqlClient(databaseUrl, { ssl: false, max: 1 });
  const firstRaw = createSqlClient(databaseUrl, { ssl: false, max: 1 });
  const secondRaw = createSqlClient(databaseUrl, { ssl: false, max: 1 });
  const sql = guardSqlTestLifetime(raw, () => signal),
    first = guardSqlTestLifetime(firstRaw, () => signal),
    second = guardSqlTestLifetime(secondRaw, () => signal);
  const repository = createClientRepository({ sql });
  const observer = createClientRepository({ sql: second });
  const actor = (index = 0): AuthenticatedActor => ({
    userId: ids.users[index],
    authUserId: `${tag}:${ids.users[index]}`,
    role: index === 1 ? "Staff" : "Admin",
    teamId: ids.teams[index === 1 ? 1 : 0],
    active: index !== 2,
  });
  const input = (suffix = 0): Omit<CreateClientInput, "actorId"> => ({
    companyName: `${tag}:${name}:${suffix}`,
    crNumber: String(Number(baseCr) + suffix),
    brNumber: String(Number(baseBr) + suffix) + "-000",
    incorporationDate: "2020-01-01",
    annualReturnBasisDate: "2026-01-01",
    registeredOffice: "Synthetic UC135–137 office",
    companySecretary: "Synthetic secretary",
    ownerId: ids.users[0],
    teamId: ids.teams[0],
    contacts: [
      {
        name: "Synthetic contact",
        role: "Primary contact",
        email: `${ids.users[0]}@example.test`,
        phone: null,
        isPrimary: true,
      },
    ],
  });
  const create = (data = input()) => createClientForActor(actor(), data, repository);
  let competitor:
    | ReturnType<typeof outcome<Awaited<ReturnType<typeof createClientForActor>>>>
    | undefined;
  const readback = async (phase: string) => {
    const companies =
      await sql`select id,company_name,cr_number,br_number,registered_office,company_secretary,status,assigned_owner_id,assigned_team_id,created_at::text,updated_at::text from companies where assigned_owner_id=${ids.users[0]} order by id`;
    const companyIds = companies.map((c) => c.id);
    const contacts =
      await sql`select id,company_id,name,role,email,phone,is_primary from company_contacts where company_id=any(${companyIds}::uuid[]) order by id`;
    const officers =
      await sql`select id,company_id,officer_type,name,appointment_date::text from officers where company_id=any(${companyIds}::uuid[]) order by id`;
    const timeline =
      await sql`select id,company_id,case_id,event_type,actor_type,actor_id,description,created_at::text from timeline_events where company_id=any(${companyIds}::uuid[]) order by id`;
    const snapshot = {
      companies: [...companies],
      contacts: [...contacts],
      officers: [...officers],
      timeline: [...timeline],
    };
    record(phase, snapshot);
    return snapshot;
  };
  const assertCreated = async (id: string, data = input()) => {
    const detail = await observer.getClient(id);
    expect(detail).toMatchObject({
      id,
      companyName: data.companyName,
      crNumber: data.crNumber,
      brNumber: data.brNumber,
      ownerId: ids.users[0],
      teamId: ids.teams[0],
      registeredOffice: data.registeredOffice,
      companySecretary: data.companySecretary,
      status: "active",
    });
    expect(detail!.contacts).toHaveLength(1);
    expect(detail!.officers).toHaveLength(1);
    expect(detail!.officers[0]).toMatchObject({
      officerType: "secretary",
      name: data.companySecretary,
      appointmentDate: "2020-01-01",
    });
    expect(detail!.timeline).toHaveLength(1);
    expect(detail!.timeline[0]).toMatchObject({ eventType: "client_created", actorType: "user" });
    record("independent-detail-readback", { detail });
    return detail;
  };
  try {
    await sql.begin(async (tx) => {
      for (const team of ids.teams)
        await tx`insert into teams(id,name) values(${team},${tag + ":" + team})`;
      for (const [i, id] of ids.users.entries())
        await tx`insert into users(id,name,email,role,team_id,active) values(${id},${"Synthetic creator " + i},${id + "@example.test"},${i === 1 ? "Staff" : "Admin"},${ids.teams[i === 1 ? 1 : 0]},${i !== 2})`;
    });
    expect((await readback("before")).companies).toHaveLength(0);
    if (["UC135-companyName", "UC135-registeredOffice", "UC135-companySecretary"].includes(name)) {
      const field = name.slice("UC135-".length);
      const bad = await outcome(create({ ...input(), [field]: " \t " }));
      record("invalid-result", {
        field,
        error: errorFacts(bad.error),
        createdId: bad.value?.id ?? null,
      });
      const after = await readback("invalid-readback");
      expect(bad.error).toBeDefined();
      expect(errorFacts(bad.error).issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: [field] })]),
      );
      expect(after.companies).toHaveLength(0);
      const saved = await create();
      record("created", { id: saved.id });
      await assertCreated(saved.id);
    } else if (name === "UC135-correction") {
      const invalid = [
        { companyName: "" },
        { crNumber: "12" },
        { brNumber: "abc" },
        { incorporationDate: "" },
        { annualReturnBasisDate: "" },
        { registeredOffice: "" },
        { ownerId: "" },
        { teamId: "" },
      ];
      for (const patch of invalid) {
        const result = await outcome(create({ ...input(), ...patch }));
        record("invalid-result", { patch, error: errorFacts(result.error) });
        expect(result.error).toBeDefined();
        expect((await readback("invalid-readback")).companies).toHaveLength(0);
      }
      for (const denied of [
        actor(1),
        actor(2),
        { ...actor(), role: "Client" as const },
        { ...actor(), userId: null },
      ]) {
        const result = await outcome(createClientForActor(denied, input(), repository));
        record("role-denied", { actor: denied, error: errorFacts(result.error) });
        expect(errorFacts(result.error).message).toMatch(/^Forbidden:/);
      }
      // Supplying a stale active actor cannot bypass the persisted active row.
      const stale = await outcome(
        createClientForActor({ ...actor(2), active: true }, input(), repository),
      );
      record("persisted-inactive-denied", { error: errorFacts(stale.error) });
      expect(errorFacts(stale.error).message).toBe("Client actor not found or inactive.");
      expect((await readback("denied-readback")).companies).toHaveLength(0);
      const saved = await create();
      record("created", { id: saved.id });
      await assertCreated(saved.id);
      const beforeRetry = await readback("winner-readback");
      const replay = await outcome(create());
      record("retry-refused", { error: errorFacts(replay.error) });
      expect(errorFacts(replay.error)).toMatchObject({
        name: "ClientWriteError",
        field: "crNumber",
      });
      expect(await readback("retry-readback")).toEqual(beforeRetry);
    } else if (name === "UC135-rollback") {
      // Deliberately exercise the real late repository constraint, beyond the
      // earlier schema rejection, to verify its entire transaction rolls back.
      const bad = {
        ...input(),
        contacts: [
          {
            name: "Synthetic unreachable",
            role: "Primary contact",
            email: null,
            phone: null,
            isPrimary: true,
          },
        ],
        actorId: ids.users[0],
      } satisfies CreateClientInput;
      const result = await outcome(repository.createClient(bad));
      record("late-repository-refusal", { error: errorFacts(result.error) });
      expect(errorFacts(result.error)).toMatchObject({
        name: "ClientWriteError",
        field: "contact",
      });
      const after = await readback("rollback-readback");
      expect(after).toEqual({ companies: [], contacts: [], officers: [], timeline: [] });
      const saved = await create();
      record("created", { id: saved.id });
      await assertCreated(saved.id);
    } else if (name.startsWith("UC136-race-")) {
      const field = name.endsWith("crNumber") ? "crNumber" : "brNumber";
      const winnerData = input(),
        next = input(1);
      const loserData = {
        ...next,
        [field]:
          field === "crNumber"
            ? ` ${winnerData.crNumber.slice(0, 4)} ${winnerData.crNumber.slice(4)} `
            : winnerData.brNumber + "-07-27-a",
      };
      const [p0] = await sql<{ pid: number }[]>`select pg_backend_pid() pid`,
        [p1] = await first<{ pid: number }[]>`select pg_backend_pid() pid`,
        [p2] = await second<{ pid: number }[]>`select pg_backend_pid() pid`;
      expect(new Set([p0.pid, p1.pid, p2.pid]).size).toBe(3);
      record("physical-sessions", { observerPid: p0.pid, winnerPid: p1.pid, loserPid: p2.pid });
      const winner = await first.begin(async (tx) => {
        const saved = await createClientForActor(
          actor(),
          winnerData,
          createClientRepository({ sql: tx }),
        );
        record("uncommitted-winner", { id: saved.id, winnerData, loserData, field });
        competitor = outcome(
          second.begin(async (other) => {
            await other`set local lock_timeout='10s'`;
            return createClientForActor(
              actor(3),
              loserData,
              createClientRepository({ sql: other }),
            );
          }),
        );
        let blocked = false;
        for (let n = 0; n < 200; n++) {
          signal.throwIfAborted();
          const [a] = await sql<
            { wait_type: string; blockers: number[] }[]
          >`select wait_event_type wait_type,pg_blocking_pids(pid) blockers from pg_stat_activity where pid=${p2.pid}`;
          if (a?.wait_type === "Lock" && a.blockers.includes(p1.pid)) {
            record("lock-observed", { ...a, winnerPid: p1.pid, loserPid: p2.pid });
            blocked = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(blocked).toBe(true);
        return saved;
      });
      const loser = await competitor!;
      record("concurrent-refused", {
        error: errorFacts(loser.error),
        createdId: loser.value?.id ?? null,
        field,
      });
      expect(errorFacts(loser.error)).toMatchObject({ name: "ClientWriteError", field });
      await assertCreated(winner.id, winnerData);
      const before = await readback("winner-readback");
      expect(before.companies).toHaveLength(1);
      expect(before.contacts).toHaveLength(1);
      expect(before.officers).toHaveLength(1);
      expect(before.timeline).toHaveLength(1);
      expect(before.timeline[0].actor_id).toBe(ids.users[0]);
      const replay = await outcome(create(loserData));
      record("retry-refused", { error: errorFacts(replay.error) });
      expect(errorFacts(replay.error).field).toBe(field);
      expect(await readback("retry-readback")).toEqual(before);
      const corrected = await create(next);
      record("corrected-created", { id: corrected.id });
      await assertCreated(corrected.id, next);
      expect((await readback("corrected-readback")).companies).toHaveLength(2);
    } else if (name.startsWith("UC136-")) {
      const field = name.endsWith("crNumber") ? "crNumber" : "brNumber";
      const saved = await create();
      record("created", { id: saved.id });
      const before = await readback("winner-readback");
      const duplicate = { ...input(1), [field]: input()[field] };
      for (let n = 0; n < 2; n++) {
        const result = await outcome(create(duplicate));
        record("duplicate-refused", { attempt: n, field, error: errorFacts(result.error) });
        expect(errorFacts(result.error)).toMatchObject({
          name: "ClientWriteError",
          field,
          message: field === "crNumber" ? "已有公司使用此 CR 號碼。" : "已有公司使用此 BR 號碼。",
        });
        expect(await readback("duplicate-readback")).toEqual(before);
      }
      const corrected = await create(input(1));
      record("corrected-created", { id: corrected.id });
      await assertCreated(saved.id);
      await assertCreated(corrected.id, input(1));
      expect((await readback("corrected-readback")).companies).toHaveLength(2);
    } else {
      const pasted = { ...input(), crNumber: " f001 2345 ", brNumber: " 1234 5678-000-07-27-a " };
      const saved = await create(pasted);
      record("created", { id: saved.id, pasted });
      const normalized = { ...pasted, crNumber: "F0012345", brNumber: "12345678-000" };
      await assertCreated(saved.id, normalized);
      const before = await readback("normalized-readback");
      expect(before.companies[0]).toMatchObject({
        cr_number: "F0012345",
        br_number: "12345678-000",
      });
      for (const br of ["12345678-000", "12345678-000-08-28-B"]) {
        const result = await outcome(create({ ...input(1), brNumber: br }));
        record("normalized-duplicate-refused", { br, error: errorFacts(result.error) });
        expect(errorFacts(result.error)).toMatchObject({
          name: "ClientWriteError",
          field: "brNumber",
        });
        expect(await readback("retry-readback")).toEqual(before);
      }
      expect(createClientSchema.parse(pasted).brNumber).toBe("12345678-000");
    }
    await readback("final-readback");
  } finally {
    try {
      await competitor;
      const owned = await raw<
        { id: string }[]
      >`select id from companies where assigned_owner_id=${ids.users[0]}`;
      const companyIds = owned.map((c) => c.id);
      record("cleanup-owned-tree", { companyIds, ids });
      await raw.begin(async (tx) => {
        await tx`delete from officers where company_id=any(${companyIds}::uuid[])`;
        await tx`delete from company_contacts where company_id=any(${companyIds}::uuid[])`;
        await tx`delete from timeline_events where company_id=any(${companyIds}::uuid[])`;
        await tx`delete from companies where id=any(${companyIds}::uuid[])`;
        await tx`delete from users where id=any(${ids.users}::uuid[])`;
        await tx`delete from teams where id=any(${ids.teams}::uuid[])`;
      });
      const [remaining] = await raw`select
        (select count(*)::int from companies where id=any(${companyIds}::uuid[]) or assigned_owner_id=${ids.users[0]}) companies,
        (select count(*)::int from officers where company_id=any(${companyIds}::uuid[])) officers,
        (select count(*)::int from company_contacts where company_id=any(${companyIds}::uuid[])) contacts,
        (select count(*)::int from timeline_events where company_id=any(${companyIds}::uuid[])) timeline,
        (select count(*)::int from users where id=any(${ids.users}::uuid[])) users,
        (select count(*)::int from teams where id=any(${ids.teams}::uuid[])) teams`;
      record("cleanup", { remaining });
      expect(Object.values(remaining).every((n) => n === 0)).toBe(true);
    } catch (error) {
      cleanupFailed = true;
      // eslint-disable-next-line no-unsafe-finally -- Fail closed after cleanup failure; stop subsequent fixture writes.
      throw error;
    } finally {
      try {
        await Promise.all([raw.end(), firstRaw.end(), secondRaw.end()]);
      } finally {
        closeSync(fd);
      }
    }
  }
}
