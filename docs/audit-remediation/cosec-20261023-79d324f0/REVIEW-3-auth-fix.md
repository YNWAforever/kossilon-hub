# REVIEW-3 auth repair and explicit source freeze

Recorded: 2026-10-23 06:08 HKT. Worktree: `C:\Users\laich\Documents\kossilon-hub\cosec-20261023`; branch: `codex/cosec-20261023`; HEAD/base: `1c57a67213af72bff8d776694e6ed8c986b921db`.

**SOURCE AND TESTS FROZEN.** No further source/test edits or formatting by this owner. Parent owns current-content aggregate checks and any subsequent commit. Current source fingerprints are in `REVIEW-3-auth-freeze-sha256.json`. This is a handoff for parent/Pasteur re-review, not aggregate acceptance.

## Disposition and owned changes

- REVIEW-3 finding 1 (P1): repaired locally. Sign-out lifecycle now uses a store keyed by the router's QueryClient in a WeakMap, subscribed through `useSyncExternalStore`. Root error replacement can unmount the React boundary without discarding pending/failed/signed-out intent. Root and provider supply the same QueryClient; independent QueryClients do not share the marker. Existing generation, actor verification and cache cancellation/reset guards remain. The real-router regression exercises the actual root beforeLoad, error screen and Retry action with the provider's old A session still valid. Pending, rejected, timeout and timeout while the error screen is mounted all keep A's protected outlet hidden. Separate-client isolation is covered locally; native SSR acceptance is not claimed.
- REVIEW-3 finding 2 (P2): repaired locally. Auth exposes its sign-out marker state; login clears `denied` after confirmed sign-out, including successful explicit recovery following rejected, returned-error or timed-out sign-out. The pending/failed state retains the guard. B's verified credential sign-in reaches the preserved safe destination. A pathname guard prevents a departed/remounting login page from issuing a second navigation to the default destination.
- Direct-entry bootstrap: login waits for hydration before automatic denied sign-out. The final small correction described below also makes bootstrap's unavailable sign-out reject, so configuration failure cannot falsely confirm completion.
- REVIEW-3 finding 3 (annual-return failure return context): outside this owner's auth scope. No disposition or verification of the parent's repair is claimed here.

Owned production files: `src/features/auth/auth-context-neon.tsx`, `src/routes/__root.tsx`, `src/routes/login.tsx`. Owned new test: `src/features/auth/auth-router-recovery.test.tsx`. Existing `auth-context-neon.test.tsx` and `auth-signout-remount.test.tsx` contents remain unchanged from the prior receipt. No ownership expansion occurred.

## Post-freeze correction: exact reason and current evidence

Parent requested freeze after reading the 94-pass result at approximately 06:05. This owner should have held that freeze and reported the remaining edge before editing. A commentary heads-up to pause checks did not satisfy that coordination requirement. At 06:07 only the auth context and existing direct-entry test were changed; root and login stayed at the previously verified hashes.

Concrete trigger: enter `/login?denied=1&redirect=%2Fdocuments` while auth configuration rejects. Bootstrap reports a settled service error (`isHydrated=true`) but previously supplied `signOut: async () => undefined`. The denied effect treated that resolved no-op as confirmed remote sign-out and removed `denied=1` despite never invoking the real adapter. This violated the required truthful sign-out guard. The configuration-failure RED directly observes the URL marker becoming null. It does not itself prove protected-content exposure in this configuration-failure phase.

Minimal production delta: bootstrap sign-out now throws the existing sanitized configuration/loading message while unavailable, instead of resolving success (`auth-context-neon.tsx:218-220`). Minimal test delta: six added lines strengthen the existing direct-entry case with configuration rejection, retained denied state, no adapter invocation, explicit configuration recovery, then an actual adapter sign-out rejection that must still preserve the guard. Test count stays nine in this file; no new suite was added.

Current-content focused verification:

- `REVIEW-3-auth-config-red.txt`: 06:07:24, one expected failure/eight filtered skips. The actual router/login/provider composition received `denied=null` instead of `1` before the production correction.
- `REVIEW-3-auth-config-green.txt`: 06:07:39, one passed/eight filtered skips after the correction, including the configuration-retry-to-real-sign-out phase. Exit 0.
- Current owned-path `git diff --check`: exit 0 after these changes.
- **The 94-test run, targeted typecheck and lint below predate this two-file delta. They have not been rerun on the frozen content by this owner.** Parent must verify the current hashes before treating its final checks as current. No further tests are being launched by this owner.

Focused command (TEMP/TMP under `node_modules/.cache/cosec-run-temp/review-3-auth`):

```powershell
node node_modules/vitest/vitest.mjs run --project unit --maxWorkers 1 src/features/auth/auth-router-recovery.test.tsx -t 'waits for the actual auth provider'
```

## Earlier RED/GREEN evidence, preserved as historical

- `REVIEW-3-auth-red-assertions.txt`: seven meaningful failures before the main repair: root-error recovery resurrected A, manual denied recovery trapped B, and direct-entry bootstrap used the no-op adapter too early.
- `REVIEW-3-auth-redirect-red.txt`: actual navigation trace showed `/documents?from=recovery` followed by `/today`; the departed-login pathname guard repairs that duplicate redirect.
- `REVIEW-3-auth-green-expanded.txt`: 93 passing tests/eight files before adding the timeout-while-error case.
- `REVIEW-3-auth-error-timeout-final.txt`: one passing/eight filtered skips for timeout while the real error screen is mounted. The helper expires the actual outstanding 10-second auth deadline while preserving real router scheduling.
- `REVIEW-3-auth-green-final.txt`: **94 passed/eight files**, exit 0, start 06:04:15, duration 20.60 seconds. This is the exact historical result parent read. Its source snapshot remains unchanged in `REVIEW-3-auth-final-sha256.json`; that snapshot is superseded for current source by the new freeze snapshot.
- `REVIEW-3-auth-typecheck-green.txt`: TypeScript 5.9.3, zero diagnostics for syntax/semantics of the four owned files using repository configuration, no emit. This was targeted checking, not a full-branch typecheck.
- `REVIEW-3-auth-eslint-final.txt`: targeted four-file ESLint exit 0/no diagnostics, before the 06:07 delta.

Earlier unsuccessful attempts are retained: `REVIEW-3-auth-red.txt` included a timeout-test clock installed too late; `green-attempt1` stopped on an introduced syntax mistake before tests ran; `green-attempt2` exposed the real duplicate redirect. Initial typecheck logs contain new-test typing errors subsequently corrected. `green-router-final`, `error-timeout-clock` and `error-timeout-green` contain timeout-case harness hangs caused by global fake timers affecting the real router; the narrow deadline helper resolves those hangs. These attempts are not passing product evidence and have not been erased or relabeled.

The historical eight-file command used the unit project and one worker only:

```powershell
node node_modules/vitest/vitest.mjs run --project unit --maxWorkers 1 src/features/auth/auth-router-recovery.test.tsx src/features/auth/auth-signout-remount.test.tsx src/features/auth/auth-context-neon.test.tsx src/features/auth/query-scope.test.ts src/features/auth/route-guard.test.ts src/routes/-root-auth-recovery.test.tsx src/routes/-login.interaction.test.tsx src/routes/-root-error-contract.test.tsx
```

## Handoff and limits

Request parent/Pasteur re-review of the frozen source, especially the QueryClient lifetime across actual root error replacement and retained denied state on failed/unavailable sign-out. Parent owns full-suite and current-content type/lint acceptance. If another important defect is identified, report it first; this owner will not edit under the freeze without renewed authorization.

This work used local source, mocked transports and JSDOM components. The real TanStack router and actual root/login/provider composition run in the new regressions; external Auth RPC/client calls are mocked and native fetch is blocked. Native Auth revocation, cookies, reload persistence, multi-tab behavior, browser and SSR runtime acceptance remain unverified. No DB/SQL client, network, actual provider sign-out, staging, commit, push, merge or deployment was performed. No graph upload/indexing was retried. TEMP/TMP stayed under ignored `node_modules`; previous logs and REVIEW-1's immutable report were preserved.
