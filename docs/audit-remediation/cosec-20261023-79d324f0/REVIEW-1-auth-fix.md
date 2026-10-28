# REVIEW-1 auth sign-out repair and finding dispositions

Date: 2026-10-23 (Asia/Hong_Kong)
Worktree: `C:\Users\laich\Documents\kossilon-hub\cosec-20261023`
Branch: `codex/cosec-20261023`
Base and unchanged HEAD: `1c57a67213af72bff8d776694e6ed8c986b921db`
Delivery: dirty local candidate, no commit.

## Authorized scope and preserved review

The user authorized the auth P1 only, conditional on a component reproduction, plus saving the original review and re-reading the parent's R16 repairs. No DB, network, real provider sign-out, push, merge, deployment or commit was authorized or performed.

`REVIEW-1.md` preserves all four findings as delivered. It is read-only and its SHA256 remains `BF232B3DE97B87604029DB820E66ED8FA47054F673CDA2E4E5B042166C2A75B1`; `REVIEW-1.md.sha256` independently records the hash. Do not rewrite that historical review; use this file for dispositions.

## Reproduction and cause

The new `src/features/auth/auth-signout-remount.test.tsx` renders the real root component, real auth provider, and real login component. Router state transitions are controlled in the component harness; auth configuration, session, actor and provider methods are mocked. Native `fetch` throws if reached. No DB module is imported by the harness.

The starting actor/session both remain account A while a deferred sign-out promise is unresolved. The test starts sign-out, changes the route actor to login (which remounts the actor-keyed provider), then checks protected content. Before the repair, both cases rendered `Private A record` again while sign-out was still pending.

The request generation counter lived inside the remounted provider. Clearing local session and publishing hydrated state before the remote outcome allowed the protected shell to redirect to login; the new provider's ordinary hydration accepted the still-valid old session. The old provider's generation guard could not protect this new instance.

## Repair

- Added `AuthSessionBoundary` in `auth-context-neon.tsx`, mounted above the existing actor-keyed provider in `__root.tsx`. It retains a synchronous sign-out marker and reactive status across those provider remounts. Standalone auth providers have their own fallback boundary.
- Pending sign-out immediately hides private UI and invalidates old reads. It keeps hydration pending and clears the prior actor's query/mutation cache before invoking the mocked/native adapter. Concurrent sign-out attempts join the existing operation.
- Rejection, returned provider error or timeout leaves an explicit failed marker and visible recovery error. Hydration and credential/social/magic-link entry cannot silently restore the prior account while sign-out is unresolved.
- A failed sign-out retries only through the user's explicit recovery action. Confirmed sign-out remains locally signed out despite old session reads; a new explicit successful credential sign-in can clear that marker and must still verify the returned actor. Social/magic-link sign-in remains blocked until sign-out is confirmed.
- A timed-out request completing later cannot publish a restored session or clear the failed marker. Successful recovery reports that sign-out completed and asks the user to sign in again.
- Existing actor-keyed remounts, session generation checks and query-scope behavior remain. The original `auth-context-neon.test.tsx` is unchanged, including all account/cache and pending-read/sign-in regressions.

Only two production files were edited by this auth repair: `src/features/auth/auth-context-neon.tsx` and the minimal boundary wrapper/import in `src/routes/__root.tsx`. The new auth component test and this run's evidence are the other additions. The parent's queue files were read, not edited.

## RED / GREEN evidence

All test runs use local installed dependencies, the `unit` project and `--maxWorkers 1`. They are pure unit/component tests with injected transports, not native Auth/HTTP/browser acceptance.

1. `REVIEW-1-auth-red.txt`: harness setup failure, zero tests collected. The client import guard rejected an explicit mock of the server DB module. Removed that unnecessary import; the auth RPC/client remain mocked. This is not counted as RED.
2. `REVIEW-1-auth-red-assertions.txt`: **2 tests failed**, exit 1. Both failed because `Private A record` was present after the actor remount while remote sign-out remained pending. This confirmed the P1 before any production edit.
3. `REVIEW-1-auth-green-attempt1.txt`: **61 tests passed in 5 files**, exit 0. Includes the original account/cache/session races and the two component reproductions.
4. `REVIEW-1-auth-green-expanded.txt`: **85 tests passed in 7 files**, exit 0. Adds returned error, manual recovery across another remount, timeout with late completion, and explicit verified account B sign-in after confirmed sign-out.
5. `REVIEW-1-auth-recovery-message-red.txt`: **1 expected failure / 5 filtered skips**, exit 1. After successful manual recovery the UI still asked the user to complete sign-out. The assertion requires a truthful completed sign-out message; repaired that outcome text.
6. `REVIEW-1-auth-green-final.txt`: **85 tests passed in 7 files**, exit 0, 21.49 seconds, after the final source formatting and recovery-message change. This is the final test evidence.
7. `REVIEW-1-auth-eslint.txt`: targeted ESLint on the two edited production files and new auth test, exit 0, no diagnostics. Targeted `git diff --check` also exited 0.

Final command:

```text
node node_modules/vitest/vitest.mjs run --project unit --maxWorkers 1 src/features/auth/auth-signout-remount.test.tsx src/features/auth/auth-context-neon.test.tsx src/features/auth/query-scope.test.ts src/features/auth/route-guard.test.ts src/routes/-root-auth-recovery.test.tsx src/routes/-login.interaction.test.tsx src/routes/-root-error-contract.test.tsx
```

The process used a run-local TEMP/TMP directory. Existing Vite tsconfig-path and LoginPage code-splitting warnings remain in the test output. No full-suite, typecheck, build or deployment claim is made.

## Disposition of all four original findings

The current queue chunks, their regression assertions, and the saved parent RED/GREEN records were re-read after the auth repair. The queue tests were not rerun by this reviewer.

| Original finding | Current disposition | Evidence inspected |
| --- | --- | --- |
| 1. P1 sign-out restores the same account across provider remounts | Locally repaired; pending parent re-review | Stable boundary above the actor-keyed provider; new real-component RED followed by final 85/85 GREEN. |
| 2. P2 breached-view snapshot mismatch | Addressed in the parent's inspected source | `work-queue.tsx:91` derives `effectiveSla`; both read filters at line 100 and snapshot filters at line 146 use it. SLA control at lines 251-252 displays that value and is disabled in the breached view. Parent regression checks both read and snapshot receive `breach` with raw `sla=warning`. |
| 3. P2 view change retains an incompatible cursor | Addressed in the parent's inspected source | View links at `work-queue.tsx:199` explicitly set `cursor: undefined`. Parent regression checks a later-page view link drops the old cursor. |
| 4. P2 retained rows carry the failed page's return context | Addressed in the parent's inspected source | Lines 112-114 retain the response together with its successful normalized search; line 151 builds `returnTo` from that retained search. Parent regression checks retained row links exclude the failed page-2 cursor. |

The earlier mobile-link and acknowledgement-dialog observations also remain addressed: both desktop/mobile links carry `returnTo`, and the queue session is keyed by actor/data mode. They were not separate findings in the saved four-item review.

Parent records read: `REVIEW-1-R16-red.txt` contains three corresponding expected failures; `REVIEW-1-R16-green.txt` records **17 passed in 3 files**, exit 0. This confirms what those saved records state, not an independent rerun or native/DB acceptance.

## Version and integrity

`REVIEW-1-auth-final-sha256.json` captures the final auth sources/test and inspected queue source. The auth production files' pre-repair snapshots and `.REVIEW-1.patch` files in this directory isolate this repair from the parent's pre-existing dirty changes.

| File | Final SHA256 |
| --- | --- |
| src/features/auth/auth-context-neon.tsx | B26367470915B81EBD054D37B2DF5BB413BCA1A5264A4D7139D9273BB6B9B66F |
| src/features/auth/auth-signout-remount.test.tsx | 6ED8EA870FA5DE65B50A4579D694A2925CE44032FDE7B15859882E0F7D5BDEA6 |
| src/features/auth/auth-context-neon.test.tsx (unchanged) | 534835DC769DEB9321EE673D70B125EA9A268CABFCAD61FB59CE476D6442AF44 |
| src/routes/__root.tsx | 332A0668781B06D1EF53AC2CAE690980C20985FB76D0CA5735436AB73AF555DB |
| src/routes/work-queue.tsx (parent-owned inspection snapshot) | 2139A726AE8698162B4CBBC00BB1C99D180936C2F3DE17CAB7E5112C02B69D72 |

## Parent re-review requested and limits

Please re-review the auth source delta, minimal root wrapper and six component cases, especially sign-out state surviving an actor remount, fail-closed recovery, and intentional new sign-in after confirmed sign-out. The original four findings are addressed at the local source/component layer described above; this is an implementer self-review, not independent approval.

The marker is in memory for the stable root boundary's lifetime. This repair does not claim browser-reload persistence, cookie/provider revocation, multi-tab propagation, native sign-out, real magic-link/Google behavior or full browser acceptance. There were no real provider calls, DB actions, network tools, commits, pushes or deployments. R15/R20 and document/client-overview work remain outside this repair.
