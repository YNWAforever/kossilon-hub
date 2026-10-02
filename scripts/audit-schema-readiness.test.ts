import "dotenv/config";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  readSchemaCatalog,
  assertMigrationPreflight,
} from "../src/features/operations/schema-catalog";
import { createNotificationOutboxRepository } from "../src/features/notifications/outbox";

const url = process.env.TEST_DATABASE_URL;
const sql = url
  ? postgres(url, {
      ssl: process.env.DATABASE_SSL === "disable" ? false : "require",
      max: 1,
      onnotice: () => undefined,
    })
  : null;
afterAll(async () => {
  await sql?.end();
});

describe.skipIf(!url)("schema readiness and additive repair against populated Postgres", () => {
  it("reproduces missing column; repair preserves rows, FKs and unknown-send fencing on repeat", async () => {
    if (!sql) throw new Error("Test database required");
    const schema = `schema_audit_${randomUUID().replaceAll("-", "")}`;
    let verified = false;
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(`create schema ${schema}; set local search_path to ${schema}, pg_catalog`);
        await tx.unsafe(`create table companies (id uuid primary key, data_origin text not null);
          create table annual_return_cases (id uuid primary key, company_id uuid, import_origin text);
          create table work_items (id uuid primary key, annual_return_case_id uuid);
          create table notification_outbox (like public.notification_outbox including all);
          alter table notification_outbox add foreign key (company_id) references companies(id);
          alter table notification_outbox drop column dispatch_started_attempt cascade;
          create table schema_migrations (id text primary key);
          insert into schema_migrations values ('0034_notification_outbox_dispatch_marker.sql');`);
        const company = randomUUID();
        await tx`insert into companies values (${company}, 'client')`;
        const outbox = createNotificationOutboxRepository({ sql: tx });
        const pending = await outbox.enqueue({
          companyId: company,
          channel: "email",
          notificationType: "sla_warning",
          idempotencyKey: "schema-test-pending",
          recipient: "audit@example.test",
          payload: { subject: "Test" },
        });
        const unknown = await outbox.enqueue({
          companyId: company,
          channel: "email",
          notificationType: "sla_warning",
          idempotencyKey: "schema-test-unknown",
          recipient: "audit@example.test",
          payload: { subject: "Test" },
        });
        await tx`update notification_outbox set status='processing', attempt_count=1, updated_at=now()-interval '2 hours' where id=${unknown.id}`;
        // A savepoint keeps the intentional SQL failure from aborting the rehearsal.
        await expect(
          tx.savepoint(async (nested) =>
            createNotificationOutboxRepository({ sql: nested }).claimDue(
              new Date().toISOString(),
              50,
            ),
          ),
        ).rejects.toMatchObject({ code: "42703" });
        const before = await readSchemaCatalog(tx);
        expect(before.facts.every((fact) => fact.present === false)).toBe(true);
        expect(() =>
          assertMigrationPreflight({ expected: before.ledger.applied, ...before }),
        ).toThrow("physical DDL");
        const repair = readFileSync(
          new URL("../db/migrations/0067_repair_outbox_dispatch_marker.sql", import.meta.url),
          "utf8",
        );
        await tx.unsafe(repair);
        await tx.unsafe(repair);
        const after = await readSchemaCatalog(tx);
        expect(after.facts.every((fact) => fact.present === true)).toBe(true);
        expect((await tx`select count(*)::int count from notification_outbox`)[0].count).toBe(2);
        const foreignKeys =
          await tx`select count(*)::int count from pg_constraint where conrelid='notification_outbox'::regclass and contype='f'`;
        expect(foreignKeys[0].count).toBe(1);
        const claimed = await outbox.claimDue(new Date(Date.now() + 1000).toISOString(), 50);
        expect(claimed.map((row) => row.id)).toEqual([pending.id]);
        await outbox.failStranded(new Date().toISOString());
        const [fenced] =
          await tx`select status,last_error_code,attempt_count,max_attempts from notification_outbox where id=${unknown.id}`;
        expect(fenced.status).toBe("failed");
        expect(fenced.last_error_code).toBe("dispatch_outcome_unknown");
        expect(fenced.attempt_count).toBe(fenced.max_attempts);
        expect(
          (await outbox.claimDue(new Date(Date.now() + 3600000).toISOString(), 50)).map(
            (row) => row.id,
          ),
        ).not.toContain(unknown.id);
        // Reconciliation never rewrites recorded history.
        expect(after.ledger.applied).toEqual(before.ledger.applied);
        verified = true;
        throw new Error("rehearsal rollback");
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "rehearsal rollback") throw error;
    }
    expect(verified).toBe(true);
    expect((await sql`select to_regnamespace(${schema}) present`)[0].present).toBeNull();
  });

  it("refuses unknown history and historical gaps before migration writes", () => {
    const base = {
      applicationPresent: true,
      facts: [],
      ledger: { present: true, applied: ["0034_unknown.sql"] },
      expected: ["0034_expected.sql"],
    };
    expect(() => assertMigrationPreflight(base)).toThrow("unrecognised");
    expect(() =>
      assertMigrationPreflight({
        ...base,
        expected: ["0001.sql", "0002.sql", "0003.sql"],
        ledger: { present: true, applied: ["0001.sql", "0003.sql"] },
      }),
    ).toThrow("historical gap");
    expect(() =>
      assertMigrationPreflight({ ...base, ledger: { present: false, applied: [] } }),
    ).toThrow("no ledger");
  });

  it("does not verify a similarly named index with an OR predicate, or a ledgerless partial schema", async () => {
    if (!sql) throw new Error("Test database required");
    let verified = false;
    try {
      await sql.begin(async (tx) => {
        const schema = `schema_audit_${randomUUID().replaceAll("-", "")}`;
        await tx.unsafe(`create schema ${schema}; set local search_path to ${schema}, pg_catalog;
          create table companies (id uuid primary key);`);
        const partial = await readSchemaCatalog(tx);
        expect(partial.applicationPresent).toBe(true);
        expect(() => assertMigrationPreflight({ expected: [], ...partial })).toThrow("no ledger");
        await tx.unsafe(`create table notification_outbox (status text, updated_at timestamptz, dispatch_started_attempt integer);
          create index notification_outbox_dispatch_marker_idx on notification_outbox(updated_at)
          where status='processing' or dispatch_started_attempt is not null;`);
        const wrong = await readSchemaCatalog(tx);
        expect(wrong.facts.find((fact) => fact.key.endsWith("_idx"))?.present).toBe(false);
        await expect(
          tx.savepoint(async (nested) =>
            nested.unsafe(
              readFileSync(
                new URL("../db/migrations/0067_repair_outbox_dispatch_marker.sql", import.meta.url),
                "utf8",
              ),
            ),
          ),
        ).rejects.toMatchObject({ code: "P0001" });
        for (const literal of ["PROCESSING", "pro cessing", "(processing)"]) {
          await tx.unsafe(`drop index notification_outbox_dispatch_marker_idx;
            create index notification_outbox_dispatch_marker_idx on notification_outbox(updated_at)
            where status='${literal}' and dispatch_started_attempt is not null;`);
          const alteredLiteral = await readSchemaCatalog(tx);
          expect(
            alteredLiteral.facts.find((fact) => fact.key.endsWith("_idx"))?.present,
            literal,
          ).toBe(false);
          await expect(
            tx.savepoint(async (nested) =>
              nested.unsafe(
                readFileSync(
                  new URL(
                    "../db/migrations/0067_repair_outbox_dispatch_marker.sql",
                    import.meta.url,
                  ),
                  "utf8",
                ),
              ),
            ),
          ).rejects.toMatchObject({ code: "P0001" });
        }
        verified = true;
        throw new Error("rehearsal rollback");
      });
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "rehearsal rollback") throw error;
    }
    expect(verified).toBe(true);
  });
});
