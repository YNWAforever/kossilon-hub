import type postgres from "postgres";
import type { ReleaseReceipt } from "./release-compatibility.ts";

/** Canonical algorithm v1: recursively sorted object keys, array order retained,
 * UTF-8 JSON, SHA256 lowercase. Approval must name this algorithm. */
export function canonicalReleaseJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalReleaseJson).join(",")}]`;
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalReleaseJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function releaseDigest(value: unknown): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalReleaseJson(value)),
  );
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function compareRuntimeContracts(
  observed: Record<string, string>,
  expected: Record<string, string>,
) {
  return [...new Set([...Object.keys(observed), ...Object.keys(expected)])].sort().map((key) => ({
    key,
    matches: Boolean(observed[key] && expected[key] && observed[key] === expected[key]),
  }));
}

export type ReleaseCatalogSnapshot = {
  algorithm: "canonical-json-v1-sha256";
  catalogSha256: string;
  historicalLedgerSha256: string;
  contractHashes: Record<string, string>;
  receipt: ReleaseReceipt | null;
  receiptCount: number;
  tableCount: number;
  databaseRole: string;
};

/** SELECTs only, preferably in one repeatable-read/read-only transaction.
 * Includes all non-extension objects in the namespace: no marker-only shortcut
 * or automatic attribution of unknown tables. Business tenant authorization
 * still requires the bound build's negative-access tests and fresh-role UAT. */
export async function readReleaseCatalog(
  sql: postgres.Sql | postgres.TransactionSql,
  namespace = "public",
): Promise<ReleaseCatalogSnapshot> {
  const [row] = await sql<{ catalog: Record<string, unknown[]>; role: string }[]>`
    with recursive relations as (
      select c.* from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname=${namespace} and c.relkind in ('r','p','v','m','f')
        and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass
          and d.objid=c.oid and d.deptype='e')
    ), sequences as (
      select c.* from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname=${namespace} and c.relkind='S'
        and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass
          and d.objid=c.oid and d.deptype='e')
    ), routines as (
      select p.* from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname=${namespace} and p.prokind='f'
        and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass
          and d.objid=p.oid and d.deptype='e')
    ), reachable_roles(oid) as (
      select oid from pg_roles where rolname=current_user
      union select m.roleid from pg_auth_members m join reachable_roles r on r.oid=m.member
    ), security_roles(oid) as (
      select oid from reachable_roles
      union select relowner from relations
      union select relowner from sequences
      union select proowner from routines
    ) select current_user role, jsonb_build_object(
      'tables',(select coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'kind',c.relkind,
        'owner',pg_get_userbyid(c.relowner),'persistence',c.relpersistence,
        'options',array(select option from unnest(c.reloptions) options(option) order by option collate "C"),
        'replicaIdentity',c.relreplident,'accessMethod',a.amname,
        'viewDefinition',case when c.relkind in ('v','m') then pg_get_viewdef(c.oid,false) end,
        'partitionKey',case when c.relkind='p' then pg_get_partkeydef(c.oid) end,
        'partitionBound',pg_get_expr(c.relpartbound,c.oid))
        order by c.relname::text collate "C"),'[]'::jsonb) from relations c
        left join pg_am a on a.oid=c.relam),
      'sequences',(select coalesce(jsonb_agg(jsonb_build_object('table',c.relname,
        'owner',pg_get_userbyid(c.relowner),'persistence',c.relpersistence,'acl',c.relacl::text,
        'type',format_type(s.seqtypid,null),'start',s.seqstart,'increment',s.seqincrement,
        'min',s.seqmin,'max',s.seqmax,'cache',s.seqcache,'cycle',s.seqcycle,
        'ownedBy',(select jsonb_build_object('schema',n.nspname,'table',t.relname,
          'column',a.attname,'dependency',d.deptype) from pg_depend d
          join pg_class t on t.oid=d.refobjid join pg_namespace n on n.oid=t.relnamespace
          join pg_attribute a on a.attrelid=t.oid and a.attnum=d.refobjsubid
          where d.classid='pg_class'::regclass and d.objid=c.oid
            and d.refclassid='pg_class'::regclass and d.deptype in ('a','i')),
        'usage',has_sequence_privilege(c.oid,'USAGE'),'select',has_sequence_privilege(c.oid,'SELECT'),
        'update',has_sequence_privilege(c.oid,'UPDATE'))
        order by c.relname::text collate "C"),'[]'::jsonb)
        from sequences c join pg_sequence s on s.seqrelid=c.oid),
      'columns',(select coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'name',a.attname,
        'ordinal',(select count(*) from pg_attribute visible where visible.attrelid=a.attrelid
          and visible.attnum>0 and visible.attnum<=a.attnum and not visible.attisdropped),
        'type',format_type(a.atttypid,a.atttypmod),'notNull',a.attnotnull,
        'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated,
        'collation',co.collname) order by c.relname::text collate "C",a.attnum),'[]'::jsonb)
        from relations c join pg_attribute a on a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
        left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
        left join pg_collation co on co.oid=a.attcollation),
      'indexes',(select coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'name',ic.relname,
        'definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive)
        order by c.relname::text collate "C",ic.relname::text collate "C"),'[]'::jsonb)
        from relations c join pg_index i on i.indrelid=c.oid join pg_class ic on ic.oid=i.indexrelid),
      'constraints',(select coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'name',x.conname,
        'type',x.contype,'definition',pg_get_constraintdef(x.oid),'validated',x.convalidated,
        'deferrable',x.condeferrable,'deferred',x.condeferred)
        order by c.relname::text collate "C",x.conname::text collate "C"),'[]'::jsonb)
        from relations c join pg_constraint x on x.conrelid=c.oid),
      'triggers',(select coalesce(jsonb_agg(jsonb_build_object('table',c.relname,'name',t.tgname,
        'definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled)
        order by c.relname::text collate "C",t.tgname::text collate "C"),'[]'::jsonb)
        from relations c join pg_trigger t on t.tgrelid=c.oid and not t.tgisinternal),
      'functions',(select coalesce(jsonb_agg(jsonb_build_object('name',p.proname,
        'identity',pg_get_function_identity_arguments(p.oid),'definition',pg_get_functiondef(p.oid),
        'owner',pg_get_userbyid(p.proowner),'acl',p.proacl::text,
        'execute',has_function_privilege(p.oid,'EXECUTE'))
        order by p.proname::text collate "C",pg_get_function_identity_arguments(p.oid) collate "C"),'[]'::jsonb)
        from routines p),
      'tenant-access',(select coalesce(jsonb_agg(jsonb_build_object('table',c.relname,
        'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
        'rlsActive',row_security_active(c.oid),'acl',c.relacl::text,
        'select',has_table_privilege(c.oid,'SELECT'),'insert',has_table_privilege(c.oid,'INSERT'),
        'update',has_table_privilege(c.oid,'UPDATE'),'delete',has_table_privilege(c.oid,'DELETE'))
        order by c.relname::text collate "C"),'[]'::jsonb) from relations c),
      'role-context',jsonb_build_array(jsonb_build_object('role',current_user,
        'sessionRole',session_user,'rowSecurity',current_setting('row_security'))),
      'security-roles',(select coalesce(jsonb_agg(jsonb_build_object('name',r.rolname,
        'superuser',r.rolsuper,'bypassRls',r.rolbypassrls,'inherit',r.rolinherit,
        'createRole',r.rolcreaterole,'createDb',r.rolcreatedb,'replication',r.rolreplication,
        'canLogin',r.rolcanlogin,'validUntil',r.rolvaliduntil,
        'reachable',r.oid in(select oid from reachable_roles),
        'member',pg_has_role(r.oid,'MEMBER'),'usage',pg_has_role(r.oid,'USAGE'),
        'set',pg_has_role(r.oid,'SET')) order by r.rolname::text collate "C"),'[]'::jsonb)
        from pg_roles r join security_roles s on s.oid=r.oid),
      'role-memberships',(select coalesce(jsonb_agg(jsonb_build_object(
        'role',pg_get_userbyid(m.roleid),'member',pg_get_userbyid(m.member),
        'grantor',pg_get_userbyid(m.grantor),'admin',m.admin_option,
        'inherit',m.inherit_option,'set',m.set_option)
        order by pg_get_userbyid(m.roleid) collate "C",pg_get_userbyid(m.member) collate "C",
          pg_get_userbyid(m.grantor) collate "C"),'[]'::jsonb)
        from pg_auth_members m where m.member in(select oid from reachable_roles)),
      'policies',(select coalesce(jsonb_agg(jsonb_build_object('table',tablename,'name',policyname,
        'permissive',permissive,'roles',roles,'command',cmd,'using',qual,'check',with_check)
        order by tablename::text collate "C",policyname::text collate "C"),'[]'::jsonb)
        from pg_policies where schemaname=${namespace})
    ) catalog
  `;
  const contracts: Record<string, unknown> = {
    "tenant-access:database-role": {
      context: row.catalog["role-context"],
      roles: row.catalog["security-roles"],
      memberships: row.catalog["role-memberships"],
    },
  };
  for (const [category, entries] of Object.entries(row.catalog)) {
    contracts[`catalog:${category}`] = entries;
    const perTable = new Map<string, unknown[]>();
    for (const entry of entries as { table?: string; name?: string; identity?: string }[]) {
      if (category === "tables") contracts[`table:${entry.table}`] = entry;
      if (category === "functions") contracts[`function:${entry.name}(${entry.identity})`] = entry;
      if (entry.table) perTable.set(entry.table, [...(perTable.get(entry.table) ?? []), entry]);
    }
    for (const [table, entries] of perTable) contracts[`${category}:${table}`] = entries;
  }
  const contractHashes = Object.fromEntries(
    await Promise.all(
      Object.entries(contracts).map(async ([key, value]) => [key, await releaseDigest(value)]),
    ),
  );
  const [presence] = await sql<{ ledger: boolean; receipt: boolean }[]>`
    select to_regclass(${`${namespace}.schema_migrations`}) is not null ledger,
           to_regclass(${`${namespace}.schema_release_receipts`}) is not null receipt
  `;
  const ledger = presence.ledger
    ? await sql`select to_jsonb(m) entry from ${sql(namespace)}.${sql("schema_migrations")} m order by id collate "C"`
    : null;
  const receipts = presence.receipt
    ? await sql<
        { id: string; payload_sha256: string; manifest: unknown }[]
      >`select id,payload_sha256,manifest from ${sql(namespace)}.${sql("schema_release_receipts")} order by id`
    : [];
  return {
    algorithm: "canonical-json-v1-sha256",
    catalogSha256: await releaseDigest(row.catalog),
    historicalLedgerSha256: await releaseDigest(ledger),
    contractHashes,
    receipt:
      receipts.length === 1
        ? {
            id: receipts[0].id,
            payloadSha256: receipts[0].payload_sha256,
            manifestSha256: await releaseDigest(receipts[0].manifest),
          }
        : null,
    receiptCount: receipts.length,
    tableCount: row.catalog.tables.length,
    databaseRole: row.role,
  };
}
