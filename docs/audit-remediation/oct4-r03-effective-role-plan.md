# R03 effective app-role inventory

**Spec:** oct3-execution-plan.md Task4 and r03-staging-acceptance.md: verify the
actual restricted web role's effective grants; do not infer restriction from a
role name or its direct flags. Existing B1 catalog SQL is approved separately
and remains byte-identical. This is an acceptance-tool gap, not a reproduced
product authorization failure. Work from current main e38a310, independent of
the unpublished B1v3 access-policy branch.

**Scope:** one metadata-only SQL SELECT and real PostgreSQL integration tests.
No hosted execution, role write, app binding, migration, deployment or provider
call. No automatic restricted-role PASS. Original UAT, old evidence and gates
remain unchanged. Keep postgres.js and register the test in the serialized DB
project. PostgreSQL17 CI and owned local PostgreSQL18 are separate evidence.

## Task 1: implement the read-only inventory using real DB contracts

Write integration tests using the current B1 query as the initial limited
baseline. Assert effective inherited and nested access, SET-only and disabled
membership, PUBLIC and column-only grants, grant options, sequence/schema/DB
capabilities, SECURITY DEFINER exposure, session/current identities and default
ACLs. Fixtures use unique names inside transactions which always roll back.
Expected RED: direct flags are insufficient and the new inventory fields are
absent; SQL still executes, not an import/connection error.

Add scripts/audit-app-role-inventory.sql, a single SELECT over pg_catalog with
fully qualified built-in functions/operators/types. Report version1, context, effective roles
and membership options, user-object effective/grantable privileges, RLS/owner,
routine execution/security-definer metadata and default ACL metadata. Never
query application rows, passwords, routine bodies or connection options.
Always assessment=not_assessed and release_decision=NO_GO. Switch only the
test's query path to the new artifact. Expected GREEN: every new contract passes
on actual local PG18; the query also runs inside BEGIN READ ONLY.

Exercise a controlled user-schema operator with that schema before pg_catalog.
Expected RED if the probe invokes its body; bind operators/types to pg_catalog
and rerun without changing the connection's search_path or hiding the case.
This candidate-tool defect is BUG-R03-02, not a hosted product finding.

Run actual lint, typecheck, original release verifier and full project suite
against a newly owned loopback PG18 database migrated/seeded by existing
scripts. Keep original CI gates. Expected: 0 failures/0 skips; record actual
counts rather than a guessed fixed total. Commit the SQL, tests and registry.

## Task 2: document, review and deliver

Add the operator procedure with exact read-only transaction and target/hash
capture, fresh actual app-role connection requirement, review limits, missing
owner inputs and rollback. Append source/evidence delta, status and environment
receipt; update only R03 tracker row. Preserve all other rows, UAT and migration
bytes. Record exact commands, runtime identities, hashes, red/green and cleanup
results. Hosted invocation of this new SQL still needs applicable target/scope
authority; the old B1 SQL approval does not cover it.

Expected: local tool ready; genuine restricted role/tenancy, Auth, restore,
native ticks and provider acceptance remain blocked. One fresh whole-branch
review under executing-plans; all findings receive author rulings. Publish a
generic source/CI-only draft PR. Normal merge only all exact-head checks green,
then verify independent exact-main original CI. Retain the B1 policy branch.

## Review Focus

Inherited/PUBLIC/column grants missed by direct role flags; nested MEMBER versus
USAGE versus SET differences; privilege/grant-option ambiguity; superuser
session hidden by SET ROLE; metadata-query execution of user code; secret/body
or data leakage; SECURITY DEFINER mistaken for proven escalation; default ACL
metadata mistaken for current grants; fixture residue or writes outside the
owned DB; automatic restricted-role or genuine Auth/UAT PASS; altered original
B1 SQL, migration ledger, CI gates or unapproved B1v3 payload publication.
