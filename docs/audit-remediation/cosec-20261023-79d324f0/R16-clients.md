# R16 Clients URL context — 2026-10-23

Status: **VERIFIED_LOCAL_UNIT_ROUTER** for the assigned list URL state and safe detail-route passthrough. **DETAIL_BACK_LINK_PENDING_DIRAC**: the actual detail UI currently ignores `returnTo`; its visible back links still return to plain `/clients`. This worker did not edit Dirac's detail component or its tests. The local coordination request is `R16-clients-coordination.md`; this session exposes no Dirac/subagent message target, so delivery to Dirac is not claimed.

## Identity, ownership and limits

- Checkout: `C:\Users\laich\Documents\kossilon-hub\cosec-20261023`; branch `codex/cosec-20261023`; unchanged HEAD/base `1c57a67213af72bff8d776694e6ed8c986b921db`.
- User assigned only the remaining Clients URL context from R16, after the R17 payment fix. Read R16's plan requirements at lines 112–122.
- Parent owns full suite/build/typecheck and exclusively runs DB suites against its independently identified disposable DB. This worker ran pure unit/component/router tests only, with fake server functions. No DB client, DB suite, migration, provider, Auth runtime, `.env` copy, commit, push, or deploy.
- No Clients SQL, server read, global return allowlist, bulk-selection implementation, or detail UI changes by this worker. Existing actor and fixture authorization remains server-owned.
- All unrelated/shared changes preserved. In particular, the pre-existing `actorScope={actor}` detail-route change was preserved when adding safe return passthrough.

## Changed paths owned by this worker

1. `src/features/clients/components/production-client-register.tsx`
   - Receives validated route search state and writes changes through the route callback; retains a local state fallback for isolated callers.
   - Keeps `q`, `status`, `team`, `includeFixtures`, and cursor in one view state. Search/status/team/fixture changes explicitly clear cursor; first/next-page actions change URL state.
   - Uses the existing bounded `listClientPage` read (`limit: 100`), existing retained-page behavior, and unchanged actor-scoped bulk selection.
   - Detail links carry the validated current list state in a safe `returnTo`.
2. `src/features/clients/register-view-state.ts` (new pure URL contract)
   - Validates scalar values, enum/UUID bounds, a maximum 200-character query, fixture boolean, and the existing two-element company-name/UUID cursor contract (maximum 2048 characters).
   - Malformed or repeated values reject navigation instead of falling back to a broader directory read. Unknown parameters are excluded from return paths.
   - Uses the router serializer so numeric queries and JSON-shaped tuple cursor strings survive parsing without becoming numbers or arrays.
   - Sanitizes detail `returnTo` through the parent's existing `caseReturnPath` allowlist; unsafe/array/missing targets fall back to `/clients`.
3. `src/routes/clients.tsx`
   - Installs search validation, connects route search/navigation to the register, and provides an explicit reset link for an invalid filter/cursor URL.
   - Retains child-route outlet behavior and the demo/production boundary.
4. `src/routes/clients.$id.tsx` — safe passthrough only
   - Adds scalar-safe return search validation and passes `{ clientId, actorScope, returnTo }` to the detail component boundary. Dirac's actual UI must consume the optional value to finish the visible back-link behavior.
5. `src/features/clients/register-view-state.test.ts` (new; 26 cases).
6. `src/routes/-clients-url-context.test.tsx` (new; 21 cases).
7. `src/features/clients/components/production-client-register.interaction.test.tsx`
   - Preserves its six existing behavior assertions; changes its router mock to retain the real serializer export needed by the URL contract.

## TDD and exact validation

| Stage | Evidence | Result |
| --- | --- | --- |
| Meaningful RED before production edits | `R16-clients-red-url.txt` | Selected copied-URL regression failed: expected the query input to contain `Acme`, received empty string. 14 nonselected cases skipped by `-t`. |
| First validation | `R16-clients-first-validation.txt` | 14 passed / 7 failed. Six existing tests needed the new real router serializer in their mock; one new test incorrectly inspected a JSON-shaped cursor before the router parser unquoted it. These were harness issues, not seven product defects. |
| Detail passthrough RED | `R16-clients-before-detail-passthrough.txt` | 46 passed / 1 failed. Detail boundary received client/actor but no `returnTo`. |
| Final GREEN | `R16-clients-green.txt` | **4 files / 57 tests passed / zero skips**, exit 0, 21.78 seconds. Includes 21 real-router component cases, 26 pure URL cases, six existing register cases, and four route/demo SSR cases. |
| Focused ESLint | `R16-clients-eslint.txt` | Exit 0. |
| Format | `R16-clients-format.txt` | All seven owned source/test files pass Prettier check. |
| Scoped tracked diff whitespace | `git diff --check -- <owned tracked paths>` | Exit 0. |

Tests stub all relevant server transports, including the real bulk toolbar's assignee read. Real router parsing/navigation, list components, retained-page logic, and bulk-selection UI are exercised. The detail component is a boundary stub in the new router tests: passing `returnTo` and navigating to that path are proven, while the actual detail back-link UI is not.

The first meaningful RED used:

```powershell
npm.cmd test -- --project unit src/routes/-clients-url-context.test.tsx --maxWorkers 1 -t 'restores q'
```

Final exact command (with a writable, local temporary directory for the known sandbox TEMP rename restriction):

```powershell
$r16Temp = Join-Path (Get-Location) 'docs\audit-remediation\cosec-20261023-79d324f0\R16-clients-temp'
New-Item -ItemType Directory -Path $r16Temp -Force | Out-Null
$env:TEMP = $r16Temp
$env:TMP = $r16Temp
npm.cmd test -- --project unit src/routes/-clients-url-context.test.tsx src/features/clients/register-view-state.test.ts src/features/clients/components/production-client-register.interaction.test.tsx src/routes/-clients-data-mode.test.tsx --maxWorkers 1
```

Runner advisories about tsconfig paths and other workers' route exports (`LoginPage`, `WorkQueueRoute`) are retained in the log. No assertions were weakened to suppress failures. Source fingerprints are in `R16-clients-source-fingerprints.json`; these identify dirty working-tree files, not the entire shared candidate or a final commit.

## Acceptance and outstanding handoff

- Verified locally: copied filtered URL, all five persisted fields, cursor reset on each filter change, next-page URL, correct detail target, safe scalar returnTo passthrough, list context restoration by navigating to that returnTo, invalid/repeated values without directory reads, real bulk selection reset on actor change, retained prior page on cursor failure, and explicit first-page/reset recovery.
- Dirac action still required: accept `returnTo?: string` (default `/clients`) in `ProductionClientDetail`, thread it through the loaded and not-found views, and render sanitized back links. The exact request is in the coordination note; no remote message or UI delivery is claimed.
- Parent action: complete shared-candidate typecheck/build/full suite, and any intended DB read verification in the exclusively owned disposable target. No new integration test or SQL rewrite was needed for this URL-only slice.
- Not verified here: physical browser reload/history/scroll restoration, live Auth roles, providers, DB authorization/SQL measurements, large synthetic DB page sizes, or actual detail back-link consumption. The existing list SQL read was intentionally preserved.

## Subsequent type-only correction for the parent

`typecheck-mid.txt` reported three errors in the new router test: string indexing at line 158 and `AnySchema` property access for q/cursor at lines 177–178. The parameter table now uses a const tuple and the router parse result has a `Record<string, unknown>` annotation. Expectations and production behavior are unchanged. Static typecheck subsequently passed (`R21-typecheck-static.txt`, exit 0); lint passed (`R16-clients-type-fix-eslint.txt`). Functional tests were not rerun under the later static-only R21 assignment. `R16-clients-type-fix-fingerprint.json` identifies this correction, preserving the earlier 57-test snapshot separately.
