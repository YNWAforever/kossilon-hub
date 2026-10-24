// Gated disposable PostgreSQL only. Auth sessions and HMAC requests are synthetic;
// actual authority mapping/catalog/domain/repository SQL is exercised, not native HTTP/RLS.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { appendFileSync, closeSync, openSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getCurrentTest } from "@vitest/runner";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { SqlClient } from "./db/client";
import type { ApplicationSchemaSql } from "./application-schema";
const RUN = "cosec-20261024-writegate-ac7d801e";
const ROOT = "C:\\Users\\laich\\Documents\\kossilon-hub\\cosec-20261023";
const DATABASE = "cosec_writegate_ac7d801e";
const marker = "0034_notification_outbox_dispatch_marker.sql",
  unknown = "9999_uc189_unknown_ac7d801e.sql";
const cases = [
  "missing",
  "unknown",
  "same-count-diverged",
  "no-ledger",
  "missing-marker",
  "missing-index",
  "recovery",
  "late-write-rollback",
  "webhook-recovery",
] as const;
type Case = (typeof cases)[number];
type Target = {
  uri: string;
  containerId: string;
  identity: { systemId: string };
  counts: Record<string, number>;
  configuration: Record<string, string>;
};
type Gate = {
  verifyEmptyTarget(): Promise<Target>;
  verifyOwnedTarget(): Promise<Target>;
  publicTarget(target: Target): object;
};
const tables = [
  "teams",
  "users",
  "staff_profiles",
  "client_company_memberships",
  "companies",
  "company_contacts",
  "officers",
  "timeline_events",
  "whatsapp_contacts",
  "whatsapp_messages",
  "whatsapp_webhook_events",
  "notification_outbox",
];
async function snapshot(sql: ApplicationSchemaSql) {
  const rows: Record<string, unknown[]> = {};
  for (const table of tables)
    rows[table] = [
      ...(await sql.unsafe(
        `select id,to_jsonb(t) data,xmin::text version from ${table} t order by id`,
      )),
    ];
  return rows;
}
const id = () => `ac7d801e-0189-4189-8189-${randomBytes(6).toString("hex")}`;
function identities() {
  return { team: id(), user: id(), profile: id(), company: id(), membership: id() };
}
type Ids = ReturnType<typeof identities>;
async function foundation(sql: ApplicationSchemaSql, ids: Ids) {
  await sql`insert into teams(id,name) values(${ids.team},${RUN + ids.team})`;
  await sql`insert into users(id,name,email,role,team_id) values(${ids.user},'Synthetic UC189 staff',${ids.user + "@example.test"},'Staff',${ids.team})`;
  await sql`insert into staff_profiles(id,user_id,auth_user_id,role,team_id) values(${ids.profile},${ids.user},${RUN + ":staff"},'Staff',${ids.team})`;
  await sql`insert into companies(id,company_name,cr_number,br_number,incorporation_date,annual_return_basis_date,registered_office,company_secretary,assigned_owner_id,assigned_team_id) values(${ids.company},${RUN + " foundation"},'89189001','89189001-000','2020-01-01','2026-01-01','Synthetic foundation','Synthetic secretary',${ids.user},${ids.team})`;
  await sql`insert into client_company_memberships(id,auth_user_id,company_id,invited_by) values(${ids.membership},${RUN + ":client"},${ids.company},${ids.user})`;
}
const post = () => new Request("https://local.invalid/server-function", { method: "POST" });
function session(role: "staff" | "client") {
  return {
    getSession: async () => ({ user: { id: RUN + ":" + role, email: role + "@example.test" } }),
    signOut: async () => new Response(),
  };
}
function input(ids: Ids) {
  return {
    companyName: RUN + " recovered",
    crNumber: "89189002",
    brNumber: "89189002-000",
    incorporationDate: "2020-01-01",
    annualReturnBasisDate: "2026-01-01",
    registeredOffice: "Synthetic UC189 office",
    companySecretary: "Synthetic secretary",
    ownerId: ids.user,
    teamId: ids.team,
    contacts: [
      {
        name: "Synthetic contact",
        role: "Director",
        email: "synthetic@example.test",
        phone: null,
        isPrimary: true,
      },
    ],
  };
}
const webhookSecret = "synthetic-uc189-local-hmac-ac7d801e";
async function webhookRequest() {
  const body = JSON.stringify({
    from: "85290000001",
    to: "85290000002",
    timestamp: "1785000000",
    type: "TEXT",
    data: { text: "Synthetic UC189", messageId: RUN + ":message" },
    member: RUN + ":member",
    channel: RUN + ":channel",
    app: RUN + ":app",
  });
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
  );
  return new Request("https://local.invalid/api/webhooks/whatsapp", {
    method: "POST",
    body,
    headers: {
      "x-woztell-signature": btoa(String.fromCharCode(...bytes)),
      "x-woztell-event-id": RUN + ":event",
    },
  });
}
let cleanupFailed = false;
describe.skipIf(process.env.COSEC_WRITE_UC189_RUN_ID !== RUN)(
  "UC189 non-scheduled write admission SQL",
  () => {
    it.each(cases)(
      "%s: refusal, retry and independent data readback",
      async (name) => {
        assert(!cleanupFailed, "Earlier cleanup failure; no subsequent writes");
        assert.equal(realpathSync(process.cwd()), ROOT);
        const folder = resolve(ROOT, "docs/audit-remediation", RUN, "db"),
          attempt = process.env.COSEC_WRITE_UC189_ATTEMPT!;
        assert.equal(folder, process.env.COSEC_WRITE_UC189_EVENTS_DIR);
        assert.match(attempt, /^[a-z0-9-]+$/);
        const signal = getCurrentTest()?.context.signal;
        assert(signal);
        const pending = scenario(name, attempt, folder, signal);
        onTestFinished(async () => {
          await pending.catch(() => undefined);
        });
        await pending;
      },
      90_000,
    );
  },
);
async function scenario(name: Case, attempt: string, folder: string, signal: AbortSignal) {
  const fd = openSync(resolve(folder, `UC189-write-${name}-${attempt}.jsonl`), "wx");
  const record = (phase: string, data: object = {}) =>
    appendFileSync(fd, JSON.stringify({ run: RUN, name, attempt, phase, ...data }) + "\n");
  const ids = identities(),
    failures: unknown[] = [],
    rollback = new Error("Deliberate UC189 fault rollback");
  let writerRaw: SqlClient | undefined,
    observerRaw: SqlClient | undefined,
    gate: Gate | undefined,
    target: Target | undefined;
  let baseline: Awaited<ReturnType<typeof snapshot>> | undefined;
  const external = vi.fn(() => {
    throw new Error("External HTTP/provider transport forbidden");
  });
  try {
    signal.throwIfAborted();
    record("planned-ids", { ids, marker, unknown });
    gate = (await import(
      /* @vite-ignore */ pathToFileURL(
        resolve(ROOT, "docs/audit-remediation", RUN, "isolated-db-runner.mjs"),
      ).href
    )) as Gate;
    target = await gate.verifyEmptyTarget();
    assert.equal(target.containerId, process.env.COSEC_WRITE_UC189_TARGET_ID);
    assert.equal(target.identity.systemId, process.env.COSEC_WRITE_UC189_SYSTEM_ID);
    assert.equal(target.uri, process.env.TEST_DATABASE_URL);
    record("before-application-import-or-client", gate.publicTarget(target));
    vi.stubGlobal("fetch", external);
    const [
      { createSqlClient },
      { guardSqlTestLifetime },
      { requireActor, requireStaffActor },
      { assertApplicationWriteSchema },
      { createClientForActor },
      { createClientRepository },
      { createWhatsAppWebhookHandler },
      { createWhatsAppRepository },
      { readSchemaCatalog },
    ] = await Promise.all([
      import("./db/client"),
      import("@/test/sql-test-lifetime"),
      import("@/features/auth/neon-auth-server"),
      import("./application-schema"),
      import("@/features/clients/server-fns"),
      import("@/features/clients/repository"),
      import("@/features/whatsapp/webhook"),
      import("@/features/whatsapp/repository"),
      import("@/features/operations/schema-catalog"),
    ]);
    writerRaw = createSqlClient(target.uri, { max: 1, ssl: false });
    observerRaw = createSqlClient(target.uri, { max: 1, ssl: false });
    const writer = guardSqlTestLifetime(writerRaw, () => signal),
      observer = guardSqlTestLifetime(observerRaw, () => signal);
    const sessions = await Promise.all(
      [writer, observer].map(async (sql) => {
        const [row] =
          await sql`select current_database() database,current_user username,pg_backend_pid() pid,(select system_identifier::text from pg_control_system()) system_id`;
        assert.equal(row.database, DATABASE);
        assert.equal(row.username, "cosec_runner");
        assert.equal(row.system_id, target!.identity.systemId);
        return row;
      }),
    );
    assert.notEqual(sessions[0].pid, sessions[1].pid);
    record("independent-sessions", { sessions });
    baseline = await snapshot(observer);
    const originalCatalog = await readSchemaCatalog(observer);
    const transactional = await writer
      .begin(async (tx) => {
        await foundation(tx, ids);
        const before = await snapshot(tx);
        if (["missing", "same-count-diverged"].includes(name))
          await tx`delete from schema_migrations where id=${marker}`;
        if (["unknown", "same-count-diverged"].includes(name))
          await tx`insert into schema_migrations(id) values(${unknown})`;
        if (name === "no-ledger")
          await tx`alter table schema_migrations rename to uc189_ledger_ac7d801e`;
        if (name === "missing-marker")
          await tx`alter table notification_outbox drop column dispatch_started_attempt`;
        if (name === "missing-index") await tx`drop index notification_outbox_dispatch_marker_idx`;
        if (["recovery", "webhook-recovery", "late-write-rollback"].includes(name)) {
          await tx
            .savepoint(async (fault) => {
              await fault`delete from schema_migrations where id=${marker}`;
              await expect(
                requireActor(post(), { auth: session("staff"), sql: fault }),
              ).rejects.toMatchObject({ statusCode: 503 });
              throw rollback;
            })
            .catch((error) => {
              assert.equal(error, rollback);
            });
        }
        let writerFactories = 0;
        const create = async () => {
          const actor = await requireStaffActor(post(), { auth: session("staff"), sql: tx });
          writerFactories++;
          return createClientForActor(actor, input(ids), createClientRepository({ sql: tx }));
        };
        const webhook = createWhatsAppWebhookHandler({
          webhookSecret,
          assertSchemaReady: () => assertApplicationWriteSchema(tx),
          createRepository: () => {
            writerFactories++;
            return createWhatsAppRepository({ sql: tx });
          },
        });
        if (!["recovery", "webhook-recovery", "late-write-rollback"].includes(name)) {
          const faultCatalog = await readSchemaCatalog(tx);
          if (name === "same-count-diverged") {
            expect(faultCatalog.ledger.applied).toHaveLength(originalCatalog.ledger.applied.length);
            expect(faultCatalog.ledger.applied).toContain(unknown);
            expect(faultCatalog.ledger.applied).not.toContain(marker);
          }
          for (let n = 0; n < 2; n++) {
            await expect(create()).rejects.toMatchObject({
              statusCode: 503,
              code: "SCHEMA_WRITE_BLOCKED",
            });
            await expect(
              requireActor(post(), { auth: session("client"), sql: tx }),
            ).rejects.toMatchObject({ statusCode: 503 });
            const response = await webhook(await webhookRequest());
            expect(response.status).toBe(503);
            expect(await snapshot(tx)).toEqual(before);
          }
          expect(writerFactories).toBe(0);
          const reader = await requireActor(new Request("https://local.invalid/operations"), {
            auth: session("staff"),
            sql: tx,
          });
          expect(reader.active).toBe(true);
          record("refusal-retry-full-row-xmin-readback", {
            faultCatalog,
            writerFactories,
            unchanged: true,
            staff: true,
            client: true,
            hmac: true,
            diagnostic_read_available: true,
          });
          throw rollback;
        }
        if (name === "late-write-rollback") {
          const actor = await requireStaffActor(post(), { auth: session("staff"), sql: tx });
          const error: unknown = await tx
            .savepoint(async (sp) =>
              createClientRepository({ sql: sp }).createClient({
                ...input(ids),
                actorId: actor.userId!,
                contacts: [
                  {
                    name: "Synthetic invalid",
                    role: "Director",
                    email: null,
                    phone: null,
                    isPrimary: true,
                  },
                ],
              }),
            )
            .catch((error) => error);
          expect(error).toMatchObject({ name: "ClientWriteError", field: "contact" });
          expect(await snapshot(tx)).toEqual(before);
          record("late-business-refusal-no-partial-company-contact-audit", { unchanged: true });
          const saved = await create();
          record("corrected-after-late-error", { company_id: saved.id });
        } else if (name === "recovery") {
          const saved = await create();
          expect(saved.contacts).toHaveLength(1);
          expect(saved.officers).toHaveLength(1);
          expect(saved.timeline).toHaveLength(1);
          record("created-after-schema-recovery", { company_id: saved.id, detail: saved });
        } else {
          const response = await webhook(await webhookRequest());
          expect(response.status).toBe(200);
          expect(await response.json()).toMatchObject({ ok: true });
          record("webhook-recovered-real-repository", { rows: await snapshot(tx) });
        }
        return "committed";
      })
      .catch((error) => error);
    if (!["recovery", "webhook-recovery", "late-write-rollback"].includes(name)) {
      assert.equal(transactional, rollback);
      expect(await snapshot(observer)).toEqual(baseline);
      expect(await readSchemaCatalog(observer)).toEqual(originalCatalog);
      record("independent-original-full-row-rollback-readback", { unchanged: true });
    } else {
      assert.equal(transactional, "committed");
      const saved = await snapshot(observer);
      record("independent-committed-full-row-readback", { rows: saved });
      if (name === "webhook-recovery") {
        expect(saved.whatsapp_messages).toHaveLength(1);
        expect(saved.whatsapp_webhook_events).toHaveLength(1);
        const handler = createWhatsAppWebhookHandler({
          webhookSecret,
          assertSchemaReady: () => assertApplicationWriteSchema(writer),
          createRepository: () => createWhatsAppRepository({ sql: writer }),
        });
        const response = await handler(await webhookRequest());
        expect(response.status).toBe(200);
        const replay = await snapshot(observer);
        expect(replay.whatsapp_messages).toHaveLength(1);
        expect(replay.whatsapp_webhook_events).toHaveLength(1);
        record("webhook-durable-retry-deduped", { rows: replay });
      } else {
        expect(saved.companies).toHaveLength(2);
        expect(saved.company_contacts).toHaveLength(1);
        expect(saved.officers).toHaveLength(1);
        expect(saved.timeline_events).toHaveLength(1);
        const actor = await requireStaffActor(post(), { auth: session("staff"), sql: writer });
        await expect(
          createClientForActor(actor, input(ids), createClientRepository({ sql: writer })),
        ).rejects.toMatchObject({ name: "ClientWriteError", field: "crNumber" });
        expect(await snapshot(observer)).toEqual(saved);
        record("committed-retry-no-duplicate-or-row-churn", { unchanged: true });
      }
    }
    expect(external).not.toHaveBeenCalled();
    record("scenario-passed", {
      externalHttpCalls: external.mock.calls.length,
      nativeAuth: false,
      nativeHttp: false,
      dbRls: false,
    });
  } catch (error) {
    failures.push(error);
    record("scenario-failed", {
      name: error instanceof Error ? error.name : "unknown",
      message: error instanceof Error ? error.message : "unknown",
    });
  } finally {
    try {
      if (gate && target && writerRaw && observerRaw) {
        signal.throwIfAborted();
        const current = await gate.verifyOwnedTarget();
        assert.equal(current.containerId, target.containerId);
        assert.equal(current.identity.systemId, target.identity.systemId);
        const owned = await snapshot(observerRaw);
        record("exact-cleanup-owned-rows", { ids, rows: owned });
        // Fresh target was empty. Every remaining tree must belong to this run's
        // exact user/team or synthetic webhook source; otherwise stop cleanup.
        const companies = await observerRaw<
          { id: string }[]
        >`select id from companies where assigned_owner_id=${ids.user} and assigned_team_id=${ids.team}`;
        assert.equal(companies.length, owned.companies.length);
        const companyIds = companies.map((row) => row.id);
        await writerRaw.begin(async (tx) => {
          const events = await tx<
            { id: string }[]
          >`select id from whatsapp_webhook_events where provider_event_id=${RUN + ":event"}`;
          assert.equal(events.length, owned.whatsapp_webhook_events.length);
          const contacts = await tx<
            { id: string }[]
          >`select id from whatsapp_contacts where phone_e164='85290000001'`;
          assert.equal(contacts.length, owned.whatsapp_contacts.length);
          const messages = await tx<
            { id: string }[]
          >`select id from whatsapp_messages where contact_id=any(${contacts.map((row) => row.id)}::uuid[])`;
          assert.equal(messages.length, owned.whatsapp_messages.length);
          record("precise-cleanup-ids", {
            companyIds,
            events: [...events],
            contacts: [...contacts],
            messages: [...messages],
          });
          await tx`delete from whatsapp_webhook_events where id=any(${events.map((row) => row.id)}::uuid[])`;
          await tx`delete from whatsapp_messages where id=any(${messages.map((row) => row.id)}::uuid[])`;
          await tx`delete from whatsapp_contacts where id=any(${contacts.map((row) => row.id)}::uuid[])`;
          await tx`delete from client_company_memberships where id=${ids.membership} and auth_user_id=${RUN + ":client"}`;
          await tx`delete from company_contacts where company_id=any(${companyIds}::uuid[])`;
          await tx`delete from officers where company_id=any(${companyIds}::uuid[])`;
          await tx`delete from timeline_events where company_id=any(${companyIds}::uuid[])`;
          await tx`delete from companies where id=any(${companyIds}::uuid[])`;
          await tx`delete from staff_profiles where id=${ids.profile} and user_id=${ids.user}`;
          await tx`delete from users where id=${ids.user}`;
          await tx`delete from teams where id=${ids.team}`;
        });
        if (baseline) expect(await snapshot(observerRaw)).toEqual(baseline);
        const zero = await gate.verifyEmptyTarget();
        assert.deepEqual(zero.counts, target.counts);
        assert.deepEqual(zero.configuration, target.configuration);
        record("all-public-business-counts-and-original-rows-restored", { counts: zero.counts });
      }
    } catch (error) {
      cleanupFailed = true;
      failures.push(error);
      record("cleanup-failed-preserved-no-retry", {});
    } finally {
      const ends = await Promise.allSettled([writerRaw?.end(), observerRaw?.end()]);
      for (const result of ends) if (result.status === "rejected") failures.push(result.reason);
      vi.unstubAllGlobals();
      closeSync(fd);
    }
  }
  if (failures.length)
    throw new AggregateError(failures, `UC189 write ${name} failed; inspect journal`);
}
