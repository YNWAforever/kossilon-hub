# R03 effective app-role inventory

This tool prepares the existing restricted web-role acceptance gate. The old B1
catalog query reports direct observer flags and relation/column metadata; it
does not report effective privileges. Neither query automatically certifies a
role as safe. No product authorization failure was established by this slice.

## Artifact and scope

`scripts/audit-app-role-inventory.sql` returns one version-1 JSON object from
PostgreSQL catalog metadata. It covers current/session identities and flags,
reachable roles with MEMBER/USAGE/SET/admin capability, membership edge options,
current database and user schemas, effective/grantable relation/column/sequence
privileges, owner/RLS flags, user routine EXECUTE/SECURITY DEFINER metadata and
stored default ACLs. PUBLIC and inherited grants are included through PostgreSQL
privilege inquiry functions. Those functions and membership options are defined
by the [PG18 information functions](https://www.postgresql.org/docs/18/functions-info.html),
[membership policy](https://www.postgresql.org/docs/18/role-membership.html) and
[membership catalog](https://www.postgresql.org/docs/18/catalog-pg-auth-members.html).

It reads no customer/document rows, role passwords, function bodies, view
definitions, provider config, foreign-server options or connection strings. It
invokes no application routine and changes no grants, schema, ledger or data.
It always emits `assessment: not_assessed` and `release_decision: NO_GO`.
Functions, operators and explicit type casts bind to pg_catalog. A controlled
user operator before pg_catalog in search_path reproduced candidate BUG-R03-02;
the final probe remains safe without silently replacing the caller's path.

## Actual operator procedure (not executed on hosted environments)

1. DB/Release owner approves the exact environment/branch/database, endpoint,
   actual app login role, query hash and metadata-read scope. This is a **new**
   query; the original B1 catalog-query approval does not approve its execution.
   Resolve credentials through the existing secret store into a private
   PostgreSQL service entry, with the approved TLS policy. Do not paste secrets
   in chat, evidence, a command argument or a PR.
2. Open a fresh direct connection as the actual app login role. An administrator
   connection with `SET ROLE`, a role name or an existing app session is not
   proof of the actual app credential/binding. Do not grant catalog access or
   change permissions to make a failed probe succeed: record the SQLSTATE and
   owner action instead. Match the secret-store binding metadata to the approved
   target identity separately; the database name alone cannot identify a Neon
   branch or prove isolation.
3. Compute the SQL SHA256 and store the approved target/build/UTC/actor identity
   in a private receipt. Execute this exact read-only envelope with the approved
   service entry. The service name below is a placeholder, not an existing
   credential or instruction to provision one:

   ```sh
   psql --dbname=service=APPROVED_PRIVATE_APP_SERVICE -X --quiet \
     --no-align --tuples-only --set=ON_ERROR_STOP=1 \
     --command="BEGIN READ ONLY; SET LOCAL lock_timeout='2s'; SET LOCAL statement_timeout='30s';" \
     --file=scripts/audit-app-role-inventory.sql \
     --command="ROLLBACK;" --output=PRIVATE_LOCAL_INVENTORY.json
   ```

   Exit must be 0; JSON must contain version1, read_only=on, and the expected
   current/session identity. Both identities must match the approved login for
   this fresh-role receipt; a role-switched session cannot satisfy that gate.
   On error psql exits and connection close aborts
   the transaction; retain a redacted failure, never retry through an admin
   login or disable TLS. Rollback means connection close/transaction abort;
   there is no permission/data rollback because this probe makes no writes.
4. Review effective and grantable privileges against the owner-adopted allowlist
   for this build. Review every reachable privileged role and SET/admin route.
   Keep session flags visible: a privileged login is not restricted simply
   because current_user has false flags. SQL role attributes are not inherited
   in the same way as object privileges; SET-only BYPASSRLS is reported as a
   possible role switch, not an already active current-user attribute.
5. Attach a redacted receipt/hash through the approved evidence channel, not a
   public raw inventory. Record original/full JSON hash locally. Complete fresh
   Auth, cross-company/team negative access, revoke/expiry, actual credential
   mapping and app/scheduler release-contract checks independently. Do not mark
   original50 UAT, UC07/UC20 or R03 runtime PASS from this metadata output.

## Limits and remaining owner inputs

This is a bounded inventory of **current database and user objects**, not a
complete PostgreSQL privilege/escalation classifier. System-schema routines,
other databases, large objects, languages/foreign wrappers, extension-specific
capabilities, view/routine implementation, role-admin mutation effects and
runtime policy expressions require separate owner review where applicable.
`EXECUTE=true` alone does not prove an exploitable SECURITY DEFINER path or
schema access. RLS flags do not prove row-policy correctness; table ownership
and effective access must be considered together. Default ACLs describe stored
future-object rules, not retroactive current grants or every implicit default.
Concurrent DDL/grant changes invalidate the observed snapshot; repeat only
under the newly approved read scope, before activation, with a matching freeze.

| Owner | Precise remaining input/action |
| --- | --- |
| DB/Release | Supported approved endpoint policy/capability; fresh actual restricted app-role credentials/binding through the secret store; owner-adopted grant allowlist; query target/hash authority; logical owners and sole DDL freeze; hosted backup/restore receipt. |
| Auth/QA | Approved staging origin/callback and controlled existing four personas/two-company scopes; fresh login/expiry/revoke and server negative-access receipts. |
| Ops | One approved native scheduler, exact web/scheduler artifacts matching one release contract, three actual native ticks plus controlled failure/recovery. |
| Storage/Scanner/AI/Channel/Filing/Business | The exact isolated resources, protocols, corpora, recipient-purpose authority, submission proof and provenance/SLO inputs already listed in r03-staging-acceptance.md. |

The local fixtures deliberately use transaction-local `SET ROLE` from an owned
superuser connection to exercise the query's visibility of both identities.
They are LOCAL REAL DB contracts, not Neon role provisioning or genuine Auth.
All fixture roles/schema/objects roll back, and each successful test checks zero
residue. Read-only transaction execution is tested separately. The approved B1
SQL and old audit evidence remain unchanged. No new hosted operation is implied.
