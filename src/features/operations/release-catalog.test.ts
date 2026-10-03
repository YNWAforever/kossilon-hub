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

async function withCatalogFixture(check: (schema: string, appRole: string) => Promise<void>) {
  const suffix = randomUUID().replaceAll("-", "");
  const schema = `release_catalog_${suffix}`;
  const appRole = `release_app_${suffix}`;
  await sql!.unsafe("begin");
  try {
    await sql!.unsafe(`create schema ${schema};set local search_path to ${schema},pg_catalog;
      create table companies(id integer primary key,tenant_id integer not null);
      insert into companies values(1,1),(2,2);
      create role ${appRole} nologin nosuperuser nobypassrls inherit;
      grant usage on schema ${schema} to ${appRole};
      grant select on companies to ${appRole};
      alter table companies enable row level security;
      create policy company_tenant on companies using(tenant_id=1);`);
    await check(schema, appRole);
  } finally {
    await sql!.unsafe("rollback");
  }
}

describe.skipIf(!sql)("full read-only release catalog", () => {
  it("refuses changed table durability and relation options", async () => {
    await withCatalogFixture(async (schema) => {
      const before = await readReleaseCatalog(sql!, schema);
      await sql!.unsafe("alter table companies set unlogged");
      const unlogged = await readReleaseCatalog(sql!, schema);
      expect(unlogged.catalogSha256).not.toBe(before.catalogSha256);
      expect(unlogged.contractHashes["table:companies"]).not.toBe(
        before.contractHashes["table:companies"],
      );
      await sql!.unsafe("alter table companies set (fillfactor=70)");
      const options = await readReleaseCatalog(sql!, schema);
      expect(options.contractHashes["table:companies"]).not.toBe(
        unlogged.contractHashes["table:companies"],
      );
    });
  });

  it("refuses a removed view tenant filter and changed security-invoker setting", async () => {
    await withCatalogFixture(async (schema) => {
      await sql!.unsafe(
        "create view tenant_companies as select * from companies where tenant_id=1",
      );
      const before = await readReleaseCatalog(sql!, schema);
      expect(await sql!.unsafe("select * from tenant_companies")).toHaveLength(1);
      await sql!.unsafe("create or replace view tenant_companies as select * from companies");
      expect(await sql!.unsafe("select * from tenant_companies")).toHaveLength(2);
      const unfiltered = await readReleaseCatalog(sql!, schema);
      expect(unfiltered.catalogSha256).not.toBe(before.catalogSha256);
      expect(unfiltered.contractHashes["table:tenant_companies"]).not.toBe(
        before.contractHashes["table:tenant_companies"],
      );
      await sql!.unsafe("alter view tenant_companies set (security_invoker=true)");
      expect(
        (await readReleaseCatalog(sql!, schema)).contractHashes["table:tenant_companies"],
      ).not.toBe(unfiltered.contractHashes["table:tenant_companies"]);
    });
  });

  it("fingerprints sequence configuration and ownership without hashing advancing values", async () => {
    await withCatalogFixture(async (schema) => {
      await sql!.unsafe(
        "create sequence company_ids;alter sequence company_ids owned by companies.id",
      );
      const before = await readReleaseCatalog(sql!, schema);
      expect(before.contractHashes["sequences:company_ids"]).toBeDefined();
      await sql!.unsafe("select nextval('company_ids')");
      expect((await readReleaseCatalog(sql!, schema)).catalogSha256).toBe(before.catalogSha256);
      await sql!.unsafe("alter sequence company_ids increment by 5 cycle");
      const changed = await readReleaseCatalog(sql!, schema);
      expect(changed.catalogSha256).not.toBe(before.catalogSha256);
      expect(changed.contractHashes["sequences:company_ids"]).not.toBe(
        before.contractHashes["sequences:company_ids"],
      );
      await sql!.unsafe("alter sequence company_ids owned by none");
      expect(
        (await readReleaseCatalog(sql!, schema)).contractHashes["sequences:company_ids"],
      ).not.toBe(changed.contractHashes["sequences:company_ids"]);
    });
  });

  it("refuses BYPASSRLS drift that increases a restricted app role's tenant visibility", async () => {
    await withCatalogFixture(async (schema, appRole) => {
      await sql!.unsafe(`set local role ${appRole}`);
      const before = await readReleaseCatalog(sql!, schema);
      expect(await sql!.unsafe("select * from companies")).toHaveLength(1);
      await sql!.unsafe(`reset role;alter role ${appRole} bypassrls;set local role ${appRole}`);
      expect(await sql!.unsafe("select * from companies")).toHaveLength(2);
      const bypass = await readReleaseCatalog(sql!, schema);
      expect(bypass.catalogSha256).not.toBe(before.catalogSha256);
      expect(bypass.contractHashes["tenant-access:database-role"]).not.toBe(
        before.contractHashes["tenant-access:database-role"],
      );
      expect(bypass.contractHashes["tenant-access:companies"]).not.toBe(
        before.contractHashes["tenant-access:companies"],
      );
    });
  });

  it("refuses table and security-definer ownership drift", async () => {
    await withCatalogFixture(async (schema, appRole) => {
      await sql!.unsafe(`create function visible_company_count() returns bigint language sql
        security definer as 'select count(*) from ${schema}.companies'`);
      await sql!.unsafe(`set local role ${appRole}`);
      const before = await readReleaseCatalog(sql!, schema);
      expect(await sql!.unsafe("select * from companies")).toHaveLength(1);
      await sql!.unsafe(
        `reset role;alter table companies owner to ${appRole};set local role ${appRole}`,
      );
      expect(await sql!.unsafe("select * from companies")).toHaveLength(2);
      const owner = await readReleaseCatalog(sql!, schema);
      expect(owner.catalogSha256).not.toBe(before.catalogSha256);
      expect(owner.contractHashes["tenant-access:companies"]).not.toBe(
        before.contractHashes["tenant-access:companies"],
      );
      await sql!.unsafe(`reset role;alter function visible_company_count() owner to ${appRole}`);
      const routineOwner = await readReleaseCatalog(sql!, schema);
      expect(routineOwner.contractHashes["function:visible_company_count()"]).not.toBe(
        owner.contractHashes["function:visible_company_count()"],
      );
    });
  });

  it("refuses reachable role membership and INHERIT/SET permission drift", async () => {
    await withCatalogFixture(async (schema, appRole) => {
      const delegate = `${appRole}_member`;
      await sql!.unsafe(
        `create role ${delegate} nologin nosuperuser nobypassrls;set local role ${appRole}`,
      );
      const before = await readReleaseCatalog(sql!, schema);
      await sql!.unsafe(`reset role;grant ${delegate} to ${appRole};set local role ${appRole}`);
      const membership = await readReleaseCatalog(sql!, schema);
      expect(membership.catalogSha256).not.toBe(before.catalogSha256);
      await sql!.unsafe(
        `reset role;grant ${delegate} to ${appRole} with inherit false;set local role ${appRole}`,
      );
      const inherit = await readReleaseCatalog(sql!, schema);
      expect(inherit.catalogSha256).not.toBe(membership.catalogSha256);
      await sql!.unsafe(
        `reset role;grant ${delegate} to ${appRole} with set false;set local role ${appRole}`,
      );
      expect((await readReleaseCatalog(sql!, schema)).catalogSha256).not.toBe(
        inherit.catalogSha256,
      );
    });
  });

  it("refuses security-definer owner membership drift even when the collector role is unchanged", async () => {
    await withCatalogFixture(async (schema, appRole) => {
      const delegate = `${appRole}_member`;
      await sql!.unsafe(`create role ${delegate} nologin nosuperuser nobypassrls;
        create policy delegated_company_access on companies to ${delegate} using(true);
        create function visible_company_count() returns bigint language sql
          security definer as 'select count(*) from ${schema}.companies';
        alter function visible_company_count() owner to ${appRole}`);
      expect((await sql!.unsafe("select visible_company_count()::int count"))[0].count).toBe(1);
      const before = await readReleaseCatalog(sql!, schema);
      await sql!.unsafe(`grant ${delegate} to ${appRole}`);
      expect((await sql!.unsafe("select visible_company_count()::int count"))[0].count).toBe(2);
      const delegated = await readReleaseCatalog(sql!, schema);
      expect(delegated.catalogSha256).not.toBe(before.catalogSha256);
      expect(delegated.contractHashes["catalog:role-memberships"]).not.toBe(
        before.contractHashes["catalog:role-memberships"],
      );
    });
  });

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
