import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { readReleaseCatalog, compareRuntimeContracts } from "./release-catalog";

const url = process.env.TEST_DATABASE_URL;
const sql = url
  ? postgres(url, {
      ssl: process.env.DATABASE_SSL === "disable" ? false : "require",
      max: 1,
      onnotice: () => {},
    })
  : null;
afterAll(async () => {
  await sql?.end();
});

describe.skipIf(!sql)("full read-only release catalog", () => {
  it("detects changes outside the dispatch marker, disabled enforcement and an unexpected table", async () => {
    const schema = `release_catalog_${randomUUID().replaceAll("-", "")}`;
    try {
      await sql!.unsafe(`create schema ${schema};set search_path to ${schema},pg_catalog;
        create table schema_migrations(id text primary key,applied_at timestamptz not null default now());
        insert into schema_migrations(id) values('historical-original.sql');
        create table companies(id integer primary key, tenant_id integer not null, name text);
        create index company_tenant_idx on companies(tenant_id);
        create function immutable_company() returns trigger language plpgsql as $$begin raise exception 'immutable';end$$;
        create trigger immutable before update on companies for each row execute function immutable_company();
        alter table companies enable row level security;
        create policy company_tenant on companies using (tenant_id=1);`);
      const before = await readReleaseCatalog(sql!, schema);
      expect(before.receipt).toBeNull();
      expect(Object.keys(before.contractHashes)).toContain("columns:companies");
      expect(Object.keys(before.contractHashes)).toContain("tenant-access:companies");
      expect(
        compareRuntimeContracts(before.contractHashes, before.contractHashes).every(
          (fact) => fact.matches,
        ),
      ).toBe(true);
      await sql!.unsafe("alter table companies alter column name type varchar(30)");
      const changed = await readReleaseCatalog(sql!, schema);
      expect(changed.catalogSha256).not.toBe(before.catalogSha256);
      expect(changed.historicalLedgerSha256).toBe(before.historicalLedgerSha256);
      expect(compareRuntimeContracts(changed.contractHashes, before.contractHashes)).toContainEqual(
        { key: "columns:companies", matches: false },
      );
      await sql!.unsafe("alter table companies disable trigger immutable");
      const disabled = await readReleaseCatalog(sql!, schema);
      expect(disabled.contractHashes["triggers:companies"]).not.toBe(
        changed.contractHashes["triggers:companies"],
      );
      await sql!.unsafe("create table unexpected(id integer)");
      const extra = await readReleaseCatalog(sql!, schema);
      expect(compareRuntimeContracts(extra.contractHashes, before.contractHashes)).toContainEqual({
        key: "table:unexpected",
        matches: false,
      });
    } finally {
      await sql!.unsafe(`reset search_path;drop schema ${schema} cascade`);
    }
  });
});

it("missing and extra physical contracts are explicit failures", () => {
  expect(
    compareRuntimeContracts({ columns: "a", extra: "b" }, { columns: "a", required: "c" }),
  ).toEqual([
    { key: "columns", matches: true },
    { key: "extra", matches: false },
    { key: "required", matches: false },
  ]);
});
