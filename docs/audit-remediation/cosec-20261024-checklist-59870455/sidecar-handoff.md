# UC159 checklist command sidecar handoff

Status: CODE_FROZEN_FOR_PARENT_REVIEW_AND_SERIAL_VERIFICATION. No unit test, SQL test,
typecheck, build, browser, migration, fixture insertion or cleanup was executed by this
sidecar. Formatting and source/diff inspection only. This extraction is a test seam
for existing behavior; it does not establish a backend defect or a passing result.

Worktree: `C:\Users\laich\Documents\kossilon-hub\cosec-20261023`.
Branch: `codex/cosec-20261023`.
Base/HEAD at intake: `347fdbcb540456863d5a93a9cdb21a9471e9416c`.

## Owned paths changed

- `src/features/incorporation/server-fns.ts`
- `src/features/incorporation/checklist-command.test.ts` (new)
- `src/features/incorporation/checklist-recovery.integration.test.ts` (new)
- `docs/audit-remediation/cosec-20261024-checklist-59870455/sidecar-vitest.config.mts` (new)
- `docs/audit-remediation/cosec-20261024-checklist-59870455/sidecar-handoff.md` (new)
- `docs/audit-remediation/cosec-20261024-checklist-59870455/sidecar-fingerprints.json` (new)

The parent's component and interaction-test changes are separate. No component,
repository, authorization function, schema, DB registry, migration or other path
was edited by this sidecar. No Git mutation, remote action or index upload occurred.
Graph metadata was already unavailable; its previously rejected upload was not retried.

## Command contract

`updateIncorporationChecklistItemForActor(actor, input, repository)` accepts an
`AuthenticatedActor`, unknown input, and a repository with `getCaseTeamId` and
`updateChecklistItem`. It parses the existing unmodified schema, requires the same
staff database identity, resolves the case's team, calls the existing
`assertIncorporationCaseWritable`, and passes the parsed fields plus only
`actor.userId` as `actorId` to the existing repository method. Extra payload authority
is stripped by the existing Zod object behavior. The native server function still
calls `getCurrentIncorporationActor` and closes its repository in the existing wrapper.
Other commands and `requireWritableCase` remain unchanged.

Planned pure tests cover active Staff/Manager/Admin, Admin across/no team, all four
status literals and null notes, inactive Staff/Admin, Client, missing/mismatched team,
missing/empty database identity, absent case, malformed payloads, forged identity and
role fields, exact note forwarding, lookup failure, and repository refusal without retry.
These are planned assertions, not executed results.

## Frozen SQL opt-in environment contract

| Variable | Required value/meaning |
| --- | --- |
| `TEST_DATABASE_URL` | Parent-verified disposable direct TCP PostgreSQL URL, protocol `postgres:` or `postgresql:`, hostname exactly `127.0.0.1`, explicit mapped port, pathname exactly `/` plus `COSEC_CHECKLIST_DB_NAME`. No fallback to `DATABASE_URL`. Credentials are not recorded. |
| `COSEC_CHECKLIST_RUN_ID` | Exactly `cosec-20261024-checklist-59870455`. |
| `COSEC_CHECKLIST_ATTEMPT` | Fresh unique value matching `^[a-z0-9-]{1,80}$`; do not reuse an existing evidence filename. |
| `COSEC_CHECKLIST_EVENTS_DIR` | Existing canonical directory at or below `docs/audit-remediation/cosec-20261024-checklist-59870455`, resolved from this worktree. Use its absolute path. Folder and parent must equal their real paths, refusing redirection. The sidecar does not create the folder during collection. |
| `COSEC_CHECKLIST_DB_NAME` | Exact parent-gated database name, also checked using `current_database()` on writer and observer before fixture insertion. |
| `COSEC_CHECKLIST_TARGET_ID` | Exactly 64 lowercase hexadecimal characters: parent's SHA256 fingerprint of the independently verified disposable container/TCP/system-identity evidence. Recorded for binding; its shape alone is not isolation proof. |

With URL or run ID absent, the integration suite is skipped without creating any
client or artifact. Once both are supplied, all remaining gates must pass before
exclusive creation of `sidecar-UC159-SQL-<attempt>.jsonl` and before client creation.
Run from this exact worktree root. Two `max: 1`, `ssl: false` clients are constructed
inside the running scenario only. The independent observer must have a different
backend PID while database, DB role, server address and server port agree. The parent
must gate the exact resolved connection including any URL options before opt-in.

The parent's disposable-target proof and resource gates remain prerequisites. This
test does not provision resources, inspect RAM, migrate/seed, verify a container's
Postgres system identifier, or establish native authentication/RLS/browser acceptance.
The latest parent report described provisioning preparation using the 50 existing
schema migrations, without seed or immutable SLA foundation. These tests do not need
that foundation. The parent's sandbox loopback EACCES baseline was preserved and an
unsandboxed local stub browser harness was running; real Auth remained blocked. This
is parent-reported context, not a verification by this sidecar.

## Planned real SQL scenario

One serial scenario owns two teams, four users, two cases and exactly five checklist
rows. Exact UUIDs are generated and appended to evidence before clients are created.
Fixtures are directly inserted and committed after identity checks; there is no
global active-user lookup, template lookup or seed dependency. Distinct fixture
`created_at` values make the repository's existing checklist ordering deterministic.

Each of the five rows traverses Received -> Verified -> Rejected -> Missing -> Received.
Staff and an Admin from the other team submit the updates. A forged payload actor ID
always points to the owned inactive user; the repository call must use the actual
supplied actor instead. After every committed update, the independent observer reads
all five SQL rows and rehydrates the case. Assertions check exact Unicode/newline/
trailing-space or null notes, set-once/reset business timestamps, preserved identity,
label, required flag and creation time, plus unchanged untargeted rows.

Every transition is immediately retried with the same values. Status, note,
`received_at`, `verified_at` and logical state must remain stable. Existing
`updated_at`/`xmin` refresh on accepted retries is deliberately excluded from logical
retry equality and remains visible in evidence. No idempotency or policy change is made.

Refusal cases include Client role, inactive supplied actor, foreign team, absent
database identity, missing case, and using case B with an item owned by case A. For
policy refusals the repository update spy must remain unused. A persisted inactive
user with `actor.active=true` must reach and fail the real repository `assertActor`.
Full-row equality, including `updated_at` and `xmin`, checks for zero item updates on
all refusals.

`guardSqlTestLifetime` wraps both clients with the current test's abort signal;
`onTestFinished` drains the scenario. Cleanup uses awaited raw clients even after an
abort, deletes only confirmed committed owned UUIDs, then independently reads zero
remaining checklist rows (both exact IDs and owned cases), cases, users and teams.
There is no broad delete or automatic retry. If fixture commit is not confirmed,
cleanup makes no deletes; planned IDs and failure markers remain for parent review.
Cleanup failure records its marker/IDs and fails the test. No later scenario runs.

## Parent execution and remaining gaps

The sidecar config selects only these two new files, disables checkout `.env` loading,
and uses one worker with file parallelism disabled. Cache files, if generated by the
parent, stay in the evidence directory under `sidecar-vitest-cache`.

Parent-only commands, listed here without execution:

```powershell
node .\node_modules\vitest\vitest.mjs run --config .\docs\audit-remediation\cosec-20261024-checklist-59870455\sidecar-vitest.config.mts src/features/incorporation/checklist-command.test.ts
# Only after the parent has provisioned and gated the disposable target, resource
# headroom, all six opt-in variables and the artifact directory:
node .\node_modules\vitest\vitest.mjs run --config .\docs\audit-remediation\cosec-20261024-checklist-59870455\sidecar-vitest.config.mts src/features/incorporation/checklist-recovery.integration.test.ts
```

All commands must remain serial with the parent's other verification. Parent review,
unit execution, typecheck/lint, SQL execution/cleanup readback and native browser
acceptance remain unverified here. Parent must add the new integration path to
`src/test/db-integration-files.ts` before using the normal full-suite configuration;
that registry is outside sidecar ownership. A final local read confirmed the parent
has now added the exact path. Keep the isolated sidecar config available for targeted
serial parent runs; this sidecar did not edit the registry.

Frozen SHA256 values are in `sidecar-fingerprints.json`. They identify file bytes
only; they do not prove a tested commit, successful SQL run or accepted native journey.
