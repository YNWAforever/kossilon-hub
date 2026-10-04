import "dotenv/config";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { TransactionSql } from "postgres";
import { afterAll, describe, expect, it } from "vitest";

import { createSqlClient, type SqlClient } from "@/server/db/client";

const databaseUrl = process.env.TEST_DATABASE_URL;
const inventoryQuery = readFileSync(
  new URL("../../../scripts/audit-app-role-inventory.sql", import.meta.url),
  "utf8",
);
const triggerQueryPath = new URL(
  "../../../scripts/audit-app-role-inventory-v2.sql",
  import.meta.url,
);
const triggerInventoryQuery = readFileSync(triggerQueryPath, "utf8");
const SENTINEL = "private-row-and-routine-body-must-not-be-exported";

type Metadata = Record<string, unknown>;
type Inventory = {
  version: number;
  assessment: string;
  release_decision: string;
  context: Metadata;
  roles: Metadata[];
  memberships: Metadata[];
  database: Metadata;
  schemas: Metadata[];
  relations: Metadata[];
  columns: Metadata[];
  sequences: Metadata[];
  routines: Metadata[];
  triggers?: Metadata[];
  default_acls: Metadata[];
};

let client: SqlClient | undefined;
function sqlForTests() {
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL required for role inventory tests.");
  return (client ??= createSqlClient(databaseUrl, { max: 1 }));
}

type Fixture = {
  schema: string;
  app: string;
  reader: string;
  nested: string;
  power: string;
  off: string;
};
async function withFixture(check: (tx: TransactionSql, fixture: Fixture) => Promise<void>) {
  const prefix = `role_probe_${crypto.randomUUID().replaceAll("-", "")}`;
  const f: Fixture = {
    schema: `${prefix}_schema`,
    app: `${prefix}_app`,
    reader: `${prefix}_reader`,
    nested: `${prefix}_nested`,
    power: `${prefix}_power`,
    off: `${prefix}_off`,
  };
  const rollback = new Error("owned role inventory fixture rollback");
  const sql = sqlForTests();
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(`
        CREATE ROLE ${f.app} NOLOGIN;
        CREATE ROLE ${f.reader} NOLOGIN;
        CREATE ROLE ${f.nested} NOLOGIN;
        CREATE ROLE ${f.power} NOLOGIN BYPASSRLS CREATEROLE;
        CREATE ROLE ${f.off} NOLOGIN;
        GRANT ${f.reader} TO ${f.nested} WITH INHERIT TRUE, SET FALSE;
        GRANT ${f.nested} TO ${f.app} WITH INHERIT TRUE, SET FALSE;
        GRANT ${f.power} TO ${f.app} WITH INHERIT FALSE, SET TRUE;
        GRANT ${f.off} TO ${f.app} WITH INHERIT FALSE, SET FALSE;
        CREATE SCHEMA ${f.schema};
        GRANT USAGE ON SCHEMA ${f.schema} TO ${f.app};
        CREATE TABLE ${f.schema}.private_rows (id integer, secret text);
        INSERT INTO ${f.schema}.private_rows VALUES (1, '${SENTINEL}');
        GRANT SELECT ON ${f.schema}.private_rows TO ${f.reader};
        ALTER TABLE ${f.schema}.private_rows ENABLE ROW LEVEL SECURITY;
        ALTER TABLE ${f.schema}.private_rows FORCE ROW LEVEL SECURITY;
        CREATE TABLE ${f.schema}.public_rows (id integer);
        GRANT SELECT ON ${f.schema}.public_rows TO PUBLIC;
        GRANT UPDATE ON ${f.schema}.public_rows TO ${f.app} WITH GRANT OPTION;
        CREATE TABLE ${f.schema}.column_rows (id integer, secret text);
        GRANT SELECT (id) ON ${f.schema}.column_rows TO ${f.app};
        CREATE SEQUENCE ${f.schema}.counter;
        GRANT USAGE ON SEQUENCE ${f.schema}.counter TO ${f.app};
        CREATE FUNCTION ${f.schema}.sensitive_body() RETURNS text
          LANGUAGE sql SECURITY DEFINER AS $$ SELECT '${SENTINEL}'::text $$;
        ALTER DEFAULT PRIVILEGES IN SCHEMA ${f.schema} GRANT SELECT ON TABLES TO ${f.app};
        SET LOCAL ROLE ${f.app};
      `);
      await check(tx, f);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  const [residue] = await sql<{ roles: number; schemas: number }[]>`
    SELECT (SELECT count(*)::int FROM pg_catalog.pg_roles
            WHERE rolname LIKE ${`${prefix}%`}) AS roles,
           (SELECT count(*)::int FROM pg_catalog.pg_namespace
            WHERE nspname = ${f.schema}) AS schemas
  `;
  expect(residue).toEqual({ roles: 0, schemas: 0 });
}

async function readInventory(tx: TransactionSql, query = inventoryQuery): Promise<Inventory> {
  const [row] = await tx.unsafe(query);
  return (row.inventory ?? row) as Inventory;
}

async function withLoginFixture(
  check: (app: SqlClient, fixture: { role: string; schema: string }) => Promise<void>,
  invalidPassword = false,
) {
  if (!databaseUrl) throw new Error("TEST_DATABASE_URL required for role inventory tests.");
  const prefix = `login_probe_${crypto.randomUUID().replaceAll("-", "")}`;
  const fixture = { role: `${prefix}_app`, schema: `${prefix}_schema` };
  const password = crypto.randomUUID().replaceAll("-", "");
  const admin = sqlForTests();
  let app: SqlClient | undefined;

  try {
    // Commit before opening a separate connection: uncommitted CREATE ROLE is
    // invisible to authentication. All identifiers/passwords here are generated.
    await admin.begin(async (tx) => {
      await tx.unsafe(`
        CREATE ROLE ${fixture.role} LOGIN PASSWORD '${password}'
          NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
        CREATE SCHEMA ${fixture.schema};
        GRANT USAGE ON SCHEMA ${fixture.schema} TO ${fixture.role};
        CREATE TABLE ${fixture.schema}.allowed_rows (id integer, value text);
        INSERT INTO ${fixture.schema}.allowed_rows VALUES (1, 'synthetic fixture');
        GRANT SELECT, UPDATE ON ${fixture.schema}.allowed_rows TO ${fixture.role};
        CREATE TABLE ${fixture.schema}.denied_rows (secret text);
        INSERT INTO ${fixture.schema}.denied_rows VALUES ('${SENTINEL}');
      `);
    });
    const url = new URL(databaseUrl);
    url.username = fixture.role;
    url.password = invalidPassword ? `${password}_incorrect` : password;
    app = createSqlClient(url.toString(), { max: 1 });
    await check(app, fixture);
  } finally {
    try {
      await app?.end({ timeout: 5 });
    } finally {
      await admin.begin(async (tx) => {
        await tx.unsafe(`
          DROP SCHEMA IF EXISTS ${fixture.schema} CASCADE;
          DROP ROLE IF EXISTS ${fixture.role};
        `);
      });
      const [residue] = await admin<{ roles: number; schemas: number }[]>`
        SELECT (SELECT count(*)::int FROM pg_catalog.pg_roles
                WHERE rolname = ${fixture.role}) AS roles,
               (SELECT count(*)::int FROM pg_catalog.pg_namespace
                WHERE nspname = ${fixture.schema}) AS schemas
      `;
      expect(residue).toEqual({ roles: 0, schemas: 0 });
    }
  }
}

function named(rows: Metadata[] | undefined, key: string, value: string) {
  return (rows ?? []).find((row) => row[key] === value);
}

afterAll(async () => {
  await client?.end();
});

describe.skipIf(!databaseUrl)("actual app-role metadata inventory", () => {
  it("authenticates a fresh restricted LOGIN and preserves its identity and read-only boundary", async () => {
    await withLoginFixture(async (app, fixture) => {
      const attributes = {
        superuser: false,
        bypassrls: false,
        create_role: false,
        create_db: false,
        replication: false,
        login: true,
      };
      for (const query of [inventoryQuery, triggerInventoryQuery]) {
        const report = await app.begin("read only", async (tx) => readInventory(tx, query));
        expect(report.context).toMatchObject({
          current_user: fixture.role,
          session_user: fixture.role,
          transaction_read_only: "on",
          current_attributes: attributes,
          session_attributes: attributes,
        });
        expect(report).toMatchObject({ assessment: "not_assessed", release_decision: "NO_GO" });
        expect(JSON.stringify(report)).not.toContain(SENTINEL);
      }
      expect(await app.unsafe(`SELECT value FROM ${fixture.schema}.allowed_rows`)).toEqual([
        { value: "synthetic fixture" },
      ]);
      await expect(
        app.unsafe(`SELECT secret FROM ${fixture.schema}.denied_rows`),
      ).rejects.toMatchObject({ code: "42501" });
      await expect(
        app.begin("read only", async (tx) => {
          await tx.unsafe(`UPDATE ${fixture.schema}.allowed_rows SET value = 'changed'`);
        }),
      ).rejects.toMatchObject({ code: "25006" });
    });
  });

  it("rejects an incorrect fresh LOGIN password without falling back to the admin connection", async () => {
    await withLoginFixture(async (app) => {
      await expect(app`SELECT current_user`).rejects.toMatchObject({ code: "28P01" });
    }, true);
  });

  it("retains the privileged session identity behind a basic current role without assessing safety", async () => {
    await withFixture(async (tx, f) => {
      const report = await readInventory(tx);
      expect(report).toMatchObject({
        version: 1,
        assessment: "not_assessed",
        release_decision: "NO_GO",
      });
      expect(report.context).toMatchObject({
        current_user: f.app,
        current_attributes: { superuser: false, bypassrls: false, create_role: false },
        session_attributes: { superuser: true },
      });
      expect(report.context.session_user).not.toBe(f.app);
    });
  });

  it("reports predefined inherited data access despite false direct role flags", async () => {
    await withFixture(async (tx, f) => {
      await tx.unsafe(`RESET ROLE; GRANT pg_read_all_data TO ${f.app}; SET LOCAL ROLE ${f.app};`);
      const report = await readInventory(tx);
      expect(named(report.roles, "name", "pg_read_all_data")).toMatchObject({
        member: true,
        usage: true,
      });
      expect(named(report.relations, "relation", "column_rows")).toMatchObject({
        privileges: expect.arrayContaining(["SELECT"]),
      });
    });
  });

  it("reports nested inherited grants independently of SET reachability", async () => {
    await withFixture(async (tx, f) => {
      const report = await readInventory(tx);
      expect(named(report.roles, "name", f.reader)).toMatchObject({
        member: true,
        usage: true,
        set: false,
      });
      expect(named(report.relations, "relation", "private_rows")).toMatchObject({
        rls: true,
        force_rls: true,
        privileges: ["SELECT"],
      });
    });
  });

  it("exposes SET-only privileged roles without inventing inherited BYPASSRLS", async () => {
    await withFixture(async (tx, f) => {
      const report = await readInventory(tx);
      expect(named(report.roles, "name", f.power)).toMatchObject({
        member: true,
        usage: false,
        set: true,
        attributes: { bypassrls: true, create_role: true },
      });
      expect(report.context).toMatchObject({
        current_attributes: { bypassrls: false, create_role: false },
      });
    });
  });

  it("distinguishes disabled inheritance and SET options from membership alone", async () => {
    await withFixture(async (tx, f) => {
      const report = await readInventory(tx);
      expect(named(report.roles, "name", f.off)).toMatchObject({
        member: true,
        usage: false,
        set: false,
      });
      expect(named(report.memberships, "role", f.off)).toMatchObject({
        member: f.app,
        inherit_option: false,
        set_option: false,
        admin_option: false,
      });
    });
  });

  it("includes PUBLIC privileges and separates grantable privileges", async () => {
    await withFixture(async (tx) => {
      const report = await readInventory(tx);
      expect(named(report.relations, "relation", "public_rows")).toMatchObject({
        privileges: ["SELECT", "UPDATE"],
        grantable: ["UPDATE"],
      });
    });
  });

  it("exposes column-only access without falsely granting whole-table SELECT", async () => {
    await withFixture(async (tx) => {
      const report = await readInventory(tx);
      expect(named(report.relations, "relation", "column_rows")).toMatchObject({ privileges: [] });
      const columns = (report.columns ?? []).filter((row) => row.relation === "column_rows");
      expect(named(columns, "column", "id")).toMatchObject({
        privileges: ["SELECT"],
        grantable: [],
      });
      expect(named(columns, "column", "secret")).toMatchObject({ privileges: [] });
    });
  });

  it("reports effective schema, sequence and database access plus future default ACLs", async () => {
    await withFixture(async (tx, f) => {
      const report = await readInventory(tx);
      expect(named(report.schemas, "schema", f.schema)).toMatchObject({
        privileges: ["USAGE"],
        grantable: [],
      });
      expect(named(report.sequences, "sequence", "counter")).toMatchObject({
        privileges: ["USAGE"],
        grantable: [],
      });
      expect(report.database).toMatchObject({
        privileges: expect.arrayContaining(["CONNECT", "TEMPORARY"]),
      });
      expect(
        (report.default_acls ?? []).find((row) => row.schema === f.schema && row.grantee === f.app),
      ).toMatchObject({
        object_type: "r",
        privilege: "SELECT",
        grantable: false,
      });
    });
  });

  it("reports accessible SECURITY DEFINER metadata without invoking or exporting bodies or rows", async () => {
    await withFixture(async (tx) => {
      const report = await readInventory(tx);
      expect(named(report.routines, "routine", "sensitive_body")).toMatchObject({
        security_definer: true,
        execute: true,
        grantable: false,
      });
      expect(JSON.stringify(report)).not.toContain(SENTINEL);
    });
  });

  it("executes as a SELECT in a read-only transaction", async () => {
    const report = await sqlForTests().begin("read only", async (tx) => readInventory(tx));
    expect(report.context).toMatchObject({ transaction_read_only: "on" });
    expect(report.release_decision).toBe("NO_GO");
  });

  it("reports a definer trigger that executes despite revoked direct EXECUTE", async () => {
    await withFixture(async (tx, f) => {
      await tx.unsafe(`
        RESET ROLE;
        INSERT INTO ${f.schema}.public_rows VALUES (1);
        CREATE FUNCTION ${f.schema}.trigger_body() RETURNS trigger
          LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
          AS $$ BEGIN UPDATE ${f.schema}.private_rows SET id = id + 1; RETURN NEW; END $$;
        CREATE TRIGGER guarded_update BEFORE UPDATE ON ${f.schema}.public_rows
          FOR EACH ROW EXECUTE FUNCTION ${f.schema}.trigger_body('${SENTINEL}');
        REVOKE EXECUTE ON FUNCTION ${f.schema}.trigger_body() FROM PUBLIC;
        SET LOCAL ROLE ${f.app};
      `);
      await expect(
        tx.savepoint(async (probe) => probe.unsafe(`UPDATE ${f.schema}.private_rows SET id = id`)),
      ).rejects.toMatchObject({ code: "42501" });
      // Actual trigger invocation is a separate LOCAL fixture action, never
      // performed by the metadata SELECT itself.
      await tx.unsafe(`UPDATE ${f.schema}.public_rows SET id = id + 1; RESET ROLE;`);
      expect(await tx.unsafe(`SELECT id FROM ${f.schema}.private_rows`)).toEqual([{ id: 2 }]);
      await tx.unsafe(`SET LOCAL ROLE ${f.app};`);
      const report = await readInventory(tx, triggerInventoryQuery);
      expect(named(report.routines, "routine", "trigger_body")).toMatchObject({
        execute: false,
        security_definer: true,
      });
      expect(named(report.triggers, "trigger", "guarded_update")).toMatchObject({
        schema: f.schema,
        relation: "public_rows",
        enabled: "O",
        internal: false,
        function_schema: f.schema,
        function: "trigger_body",
        security_definer: true,
        function_execute: false,
        function_owner: report.context.session_user,
      });
      expect(JSON.stringify(report)).not.toContain(SENTINEL);
      // Collecting metadata did not invoke the trigger again.
      await tx.unsafe("RESET ROLE");
      expect(await tx.unsafe(`SELECT id FROM ${f.schema}.private_rows`)).toEqual([{ id: 2 }]);
    });
  });

  it("retains disabled, replica, always and invoker trigger facts without classifying safety", async () => {
    await withFixture(async (tx, f) => {
      await tx.unsafe(`
        RESET ROLE;
        CREATE FUNCTION ${f.schema}.invoker_trigger() RETURNS trigger LANGUAGE plpgsql
          AS $$ BEGIN RETURN NEW; END $$;
        CREATE TRIGGER disabled_trigger BEFORE INSERT ON ${f.schema}.public_rows
          FOR EACH ROW EXECUTE FUNCTION ${f.schema}.invoker_trigger();
        CREATE TRIGGER replica_trigger BEFORE UPDATE ON ${f.schema}.public_rows
          FOR EACH ROW EXECUTE FUNCTION ${f.schema}.invoker_trigger();
        CREATE TRIGGER always_trigger BEFORE DELETE ON ${f.schema}.public_rows
          FOR EACH ROW EXECUTE FUNCTION ${f.schema}.invoker_trigger();
        ALTER TABLE ${f.schema}.public_rows DISABLE TRIGGER disabled_trigger;
        ALTER TABLE ${f.schema}.public_rows ENABLE REPLICA TRIGGER replica_trigger;
        ALTER TABLE ${f.schema}.public_rows ENABLE ALWAYS TRIGGER always_trigger;
        SET LOCAL ROLE ${f.app};
      `);
      const report = await readInventory(tx, triggerInventoryQuery);
      for (const [name, enabled] of [
        ["disabled_trigger", "D"],
        ["replica_trigger", "R"],
        ["always_trigger", "A"],
      ]) {
        expect(named(report.triggers, "trigger", name)).toMatchObject({
          enabled,
          security_definer: false,
          function: "invoker_trigger",
        });
      }
      expect(report).toMatchObject({
        version: 2,
        assessment: "not_assessed",
        release_decision: "NO_GO",
        context: { session_replication_role: "origin" },
      });
    });
  });

  it("keeps v1 immutable and v2 read-only behind hostile application search_path", async () => {
    expect(createHash("sha256").update(inventoryQuery).digest("hex")).toBe(
      "4be89014591a7d0d5599b5aeaef9a1e320156fadb24a9090dc699e2aa681ea6b",
    );
    await withFixture(async (tx, f) => {
      await tx.unsafe(`
        RESET ROLE;
        CREATE FUNCTION ${f.schema}.unsafe_concat(text, text) RETURNS text
          LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'application operator executed'; END $$;
        CREATE OPERATOR ${f.schema}.|| (LEFTARG = text, RIGHTARG = text,
          FUNCTION = ${f.schema}.unsafe_concat);
        SET LOCAL ROLE ${f.app};
        SET LOCAL search_path = ${f.schema}, pg_catalog;
      `);
      const report = await readInventory(tx, triggerInventoryQuery);
      expect(report.version).toBe(2);
      expect(report.context.current_user).toBe(f.app);
      expect(JSON.stringify(report)).not.toContain(SENTINEL);
    });
    const report = await sqlForTests().begin("read only", async (tx) =>
      readInventory(tx, triggerInventoryQuery),
    );
    expect(report.context.transaction_read_only).toBe("on");
    expect(report.release_decision).toBe("NO_GO");
  });

  it("does not invoke application operators when search_path places a user schema before pg_catalog", async () => {
    await withFixture(async (tx, f) => {
      await tx.unsafe(`
        RESET ROLE;
        CREATE FUNCTION ${f.schema}.unsafe_concat(text, text) RETURNS text
          LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'application operator executed'; END $$;
        CREATE OPERATOR ${f.schema}.|| (LEFTARG = text, RIGHTARG = text,
          FUNCTION = ${f.schema}.unsafe_concat);
        SET LOCAL ROLE ${f.app};
        SET LOCAL search_path = ${f.schema}, pg_catalog;
      `);
      const report = await readInventory(tx);
      expect(report.context).toMatchObject({ current_user: f.app });
      expect(named(report.relations, "relation", "public_rows")).toMatchObject({
        privileges: ["SELECT", "UPDATE"],
        grantable: ["UPDATE"],
      });
    });
  });
});
