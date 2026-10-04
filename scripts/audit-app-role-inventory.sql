-- R03 metadata only. Run through an approved actual app-role connection inside
-- BEGIN READ ONLY. Facts do not establish tenant isolation or release approval.
WITH role_metadata AS (
  SELECT r.oid, r.rolname,
    pg_catalog.jsonb_build_object(
      'superuser', r.rolsuper, 'bypassrls', r.rolbypassrls,
      'create_role', r.rolcreaterole, 'create_db', r.rolcreatedb,
      'replication', r.rolreplication, 'login', r.rolcanlogin,
      'inherit', r.rolinherit
    ) AS attributes
  FROM pg_catalog.pg_roles r
), user_schemas AS (
  SELECT n.oid, n.nspname, n.nspowner
  FROM pg_catalog.pg_namespace n
  WHERE n.nspname OPERATOR(pg_catalog.!~) '^pg_' AND n.nspname OPERATOR(pg_catalog.<>) 'information_schema'
), user_relations AS (
  SELECT c.*, n.nspname
  FROM pg_catalog.pg_class c
  JOIN user_schemas n ON n.oid OPERATOR(pg_catalog.=) c.relnamespace
  WHERE c.relkind OPERATOR(pg_catalog.=) ANY (ARRAY['r', 'p', 'v', 'm', 'f', 'S']::pg_catalog."char"[])
)
SELECT pg_catalog.jsonb_build_object(
  'version', 1,
  'assessment', 'not_assessed',
  'release_decision', 'NO_GO',
  'context', pg_catalog.jsonb_build_object(
    'database', pg_catalog.current_database(),
    'server_version', pg_catalog.current_setting('server_version'),
    'server_version_num', pg_catalog.current_setting('server_version_num'),
    'transaction_read_only', pg_catalog.current_setting('transaction_read_only'),
    'current_user', current_user,
    'session_user', session_user,
    'current_attributes', (SELECT attributes FROM role_metadata WHERE rolname OPERATOR(pg_catalog.=) current_user),
    'session_attributes', (SELECT attributes FROM role_metadata WHERE rolname OPERATOR(pg_catalog.=) session_user)
  ),
  'roles', (SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'name', r.rolname, 'attributes', r.attributes,
    'member', pg_catalog.pg_has_role(current_user, r.oid, 'MEMBER'),
    'usage', pg_catalog.pg_has_role(current_user, r.oid, 'USAGE'),
    'set', pg_catalog.pg_has_role(current_user, r.oid, 'SET'),
    'admin_option', pg_catalog.pg_has_role(current_user, r.oid, 'MEMBER WITH ADMIN OPTION')
  ) ORDER BY r.rolname), '[]'::pg_catalog.jsonb)
    FROM role_metadata r
    WHERE pg_catalog.pg_has_role(current_user, r.oid, 'MEMBER')),
  'memberships', (SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'role', pg_catalog.pg_get_userbyid(m.roleid),
    'member', pg_catalog.pg_get_userbyid(m.member),
    'grantor', pg_catalog.pg_get_userbyid(m.grantor),
    'inherit_option', m.inherit_option, 'set_option', m.set_option,
    'admin_option', m.admin_option
  ) ORDER BY m.roleid, m.member, m.grantor), '[]'::pg_catalog.jsonb)
    FROM pg_catalog.pg_auth_members m
    WHERE pg_catalog.pg_has_role(current_user, m.member, 'MEMBER')),
  'database', (SELECT pg_catalog.jsonb_build_object(
    'name', d.datname, 'owner', pg_catalog.pg_get_userbyid(d.datdba),
    'privileges', ARRAY(SELECT p FROM pg_catalog.unnest(ARRAY['CREATE', 'CONNECT', 'TEMPORARY']) p
      WHERE pg_catalog.has_database_privilege(current_user, d.oid, p)),
    'grantable', ARRAY(SELECT p FROM pg_catalog.unnest(ARRAY['CREATE', 'CONNECT', 'TEMPORARY']) p
      WHERE pg_catalog.has_database_privilege(current_user, d.oid, p OPERATOR(pg_catalog.||) ' WITH GRANT OPTION'))
  ) FROM pg_catalog.pg_database d WHERE d.datname OPERATOR(pg_catalog.=) pg_catalog.current_database()),
  'schemas', (SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'schema', n.nspname, 'owner', pg_catalog.pg_get_userbyid(n.nspowner),
    'privileges', ARRAY(SELECT p FROM pg_catalog.unnest(ARRAY['CREATE', 'USAGE']) p
      WHERE pg_catalog.has_schema_privilege(current_user, n.oid, p)),
    'grantable', ARRAY(SELECT p FROM pg_catalog.unnest(ARRAY['CREATE', 'USAGE']) p
      WHERE pg_catalog.has_schema_privilege(current_user, n.oid, p OPERATOR(pg_catalog.||) ' WITH GRANT OPTION'))
  ) ORDER BY n.nspname), '[]'::pg_catalog.jsonb) FROM user_schemas n),
  'relations', (SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'schema', c.nspname, 'relation', c.relname, 'kind', c.relkind,
    'owner', pg_catalog.pg_get_userbyid(c.relowner),
    'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
    'privileges', ARRAY(SELECT p FROM pg_catalog.unnest(
      ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) p
      WHERE pg_catalog.has_table_privilege(current_user, c.oid, p)),
    'grantable', ARRAY(SELECT p FROM pg_catalog.unnest(
      ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) p
      WHERE pg_catalog.has_table_privilege(current_user, c.oid, p OPERATOR(pg_catalog.||) ' WITH GRANT OPTION'))
  ) ORDER BY c.nspname, c.relname), '[]'::pg_catalog.jsonb)
    FROM user_relations c WHERE c.relkind OPERATOR(pg_catalog.<>) 'S'),
  'columns', (SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'schema', c.nspname, 'relation', c.relname, 'column', a.attname,
    'privileges', ARRAY(SELECT p FROM pg_catalog.unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) p
      WHERE pg_catalog.has_column_privilege(current_user, c.oid, a.attnum, p)),
    'grantable', ARRAY(SELECT p FROM pg_catalog.unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) p
      WHERE pg_catalog.has_column_privilege(current_user, c.oid, a.attnum, p OPERATOR(pg_catalog.||) ' WITH GRANT OPTION'))
  ) ORDER BY c.nspname, c.relname, a.attnum), '[]'::pg_catalog.jsonb)
    FROM user_relations c JOIN pg_catalog.pg_attribute a ON a.attrelid OPERATOR(pg_catalog.=) c.oid
    WHERE c.relkind OPERATOR(pg_catalog.<>) 'S' AND a.attnum OPERATOR(pg_catalog.>) 0 AND NOT a.attisdropped),
  'sequences', (SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'schema', c.nspname, 'sequence', c.relname,
    'owner', pg_catalog.pg_get_userbyid(c.relowner),
    'privileges', ARRAY(SELECT p FROM pg_catalog.unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) p
      WHERE pg_catalog.has_sequence_privilege(current_user, c.oid, p)),
    'grantable', ARRAY(SELECT p FROM pg_catalog.unnest(ARRAY['USAGE', 'SELECT', 'UPDATE']) p
      WHERE pg_catalog.has_sequence_privilege(current_user, c.oid, p OPERATOR(pg_catalog.||) ' WITH GRANT OPTION'))
  ) ORDER BY c.nspname, c.relname), '[]'::pg_catalog.jsonb)
    FROM user_relations c WHERE c.relkind OPERATOR(pg_catalog.=) 'S'),
  'routines', (SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'schema', n.nspname, 'routine', p.proname, 'oid', p.oid,
    'identity_arguments', pg_catalog.pg_get_function_identity_arguments(p.oid),
    'kind', p.prokind, 'owner', pg_catalog.pg_get_userbyid(p.proowner),
    'security_definer', p.prosecdef,
    'execute', pg_catalog.has_function_privilege(current_user, p.oid, 'EXECUTE'),
    'grantable', pg_catalog.has_function_privilege(current_user, p.oid, 'EXECUTE WITH GRANT OPTION')
  ) ORDER BY n.nspname, p.proname, p.oid), '[]'::pg_catalog.jsonb)
    FROM pg_catalog.pg_proc p JOIN user_schemas n ON n.oid OPERATOR(pg_catalog.=) p.pronamespace),
  'default_acls', (SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'owner', pg_catalog.pg_get_userbyid(d.defaclrole),
    'schema', n.nspname, 'object_type', d.defaclobjtype,
    'grantor', pg_catalog.pg_get_userbyid(a.grantor),
    'grantee', CASE WHEN a.grantee OPERATOR(pg_catalog.=) 0 THEN 'PUBLIC' ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
    'privilege', a.privilege_type, 'grantable', a.is_grantable
  ) ORDER BY d.defaclrole, d.defaclnamespace, d.defaclobjtype, a.grantee, a.privilege_type), '[]'::pg_catalog.jsonb)
    FROM pg_catalog.pg_default_acl d
    LEFT JOIN pg_catalog.pg_namespace n ON n.oid OPERATOR(pg_catalog.=) d.defaclnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) a
    WHERE d.defaclnamespace OPERATOR(pg_catalog.=) 0 OR (n.nspname OPERATOR(pg_catalog.!~) '^pg_' AND n.nspname OPERATOR(pg_catalog.<>) 'information_schema'))
) AS inventory;
