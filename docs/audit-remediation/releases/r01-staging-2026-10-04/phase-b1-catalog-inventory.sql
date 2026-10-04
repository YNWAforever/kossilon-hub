-- R01 B1: one catalog SELECT only; no customer/document rows or migration writes.
SELECT
  current_database() AS database_name,
  current_setting('server_version') AS server_version,
  current_setting('server_version_num') AS server_version_num,
  current_user AS observer_name,
  (SELECT jsonb_build_object(
    'superuser', rolsuper, 'bypassrls', rolbypassrls,
    'create_role', rolcreaterole, 'create_db', rolcreatedb,
    'replication', rolreplication
  ) FROM pg_catalog.pg_roles WHERE rolname = current_user) AS observer_attributes,
  (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'relation', c.relname, 'kind', c.relkind,
    'owner', pg_catalog.pg_get_userbyid(c.relowner),
    'persistence', c.relpersistence, 'rls', c.relrowsecurity,
    'force_rls', c.relforcerowsecurity
  ) ORDER BY n.nspname, c.relname), '[]'::jsonb)
   FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
     AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')) AS relations,
  (SELECT coalesce(jsonb_agg(jsonb_build_object(
    'schema', n.nspname, 'relation', c.relname, 'column', a.attname,
    'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
    'not_null', a.attnotnull, 'identity', a.attidentity,
    'generated', a.attgenerated
  ) ORDER BY n.nspname, c.relname, a.attnum), '[]'::jsonb)
   FROM pg_catalog.pg_attribute a
   JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'
     AND a.attnum > 0 AND NOT a.attisdropped
     AND c.relkind IN ('r', 'p', 'v', 'm', 'f')) AS columns;
