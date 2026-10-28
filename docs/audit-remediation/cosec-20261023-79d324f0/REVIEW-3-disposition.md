# REVIEW-3 — independent frozen-source disposition

Recorded: 2026-10-23 06:10 HKT. Worktree: `C:/Users/laich/Documents/kossilon-hub/cosec-20261023`; branch `codex/cosec-20261023`. Original review base: `1c57a67213af72bff8d776694e6ed8c986b921db`. HEAD observed at both ends of this frozen-source read: `8bc1e0dea88c5796c37b2f32a781fac7aab31774` (parent-owned commit).

**All three original REVIEW-3 findings are repaired in the inspected frozen source. No concrete remaining defect in those three findings was identified.** This is a bounded source/receipt disposition, not native or aggregate release acceptance. REVIEW-3.md remains unchanged as the historical findings record.

## Original finding dispositions

| Original finding | Independent disposition and concrete source basis |
| --- | --- |
| **1 — P1: root error recovery loses sign-out intent** | **Repaired.** `auth-context-neon.tsx:96-143` retains the lifecycle in a `WeakMap` keyed by the router's QueryClient and subscribes through `useSyncExternalStore`. Root error replacement can discard the React boundary without discarding that client's pending/failed/signed-out marker. `__root.tsx:214-219` supplies the same QueryClient to the boundary/provider; `auth-context-neon.tsx:290-301` fences hydration before session reads. Outstanding sign-out completion updates that same retained store, including when the boundary is unmounted. The real-router tests at `auth-router-recovery.test.tsx:193-250` use the actual root beforeLoad, error component and Retry action and assert A's outlet/cache stay absent for pending, rejected, timed-out, and timeout-while-error cases. |
| **2 — P2: successful denied-account recovery leaves B trapped on login** | **Repaired.** `login.tsx:101-130` observes sign-out state and removes `denied` after confirmed completion, including manual recovery; pending/failed attempts retain the guard. `login.tsx:77-99` preserves the safe destination and prevents a departed login component from issuing a second default redirect. `auth-context-neon.tsx:218-220` now rejects the unavailable bootstrap sign-out instead of falsely confirming it. The actual-router cases at `auth-router-recovery.test.tsx:253-318` cover rejected/returned-error/timed-out sign-out recovery, B's verified credential sign-in to the exact safe destination, and configuration failure/retry with no false adapter completion. |
| **3 — P2: annual-return failure screens discard the originating client** | **Repaired.** `production-case-detail.tsx:96,100-108,224-238` carries returnTo through malformed-ID, request-error and null-result paths and uses the existing `caseReturnPath` sanitizer for each displayed recovery anchor. The success path still uses the same sanitizer. `production-case-detail.return-context.test.tsx:151-199` renders the actual detail and client components, follows the rendered recovery URI through the real router for error/null results, checks the exact client and nested register search/cursor, and covers malformed IDs and unsafe-origin fallback. |

## SSR/request isolation

The retained store is per QueryClient, not a single process-wide marker. `src/router.tsx:6-14` constructs a fresh QueryClient inside each `getRouter()` invocation, preserving the existing router/request isolation boundary. `auth-router-recovery.test.tsx:320-329` independently checks that a failed sign-out in one client does not fence a separate client. No source-level cross-request marker sharing was found in this repair. This observation is not a claim that native SSR runtime acceptance was executed.

## Receipts and evidence boundary

- Read the final `REVIEW-3-auth-fix.md` and matched current auth/root/login/router-test content against `REVIEW-3-auth-freeze-sha256.json`. The two final hashes supplied by the parent match exactly: auth context `4C303A4A...5DA80ED4`, router test `C139FBDC...08AA28C6`.
- The prior `REVIEW-3-auth-green-final.txt` records **94 passing tests / 8 files**, but predates the last bootstrap/test correction. It remains historical evidence; this disposition does not relabel it as a full rerun on the frozen hashes.
- `REVIEW-3-auth-config-green.txt` records the corrected direct-entry/configuration case passing on the final two-file delta: **1 passed / 8 filtered skips**. The final receipt identifies those skipped cases explicitly. The parent reports final changed-path typecheck/lint passed after this delta; those executions were not performed by this reviewer.
- Read `R19-review3-case-recovery.md`, its source fingerprints and saved GREEN record: **56 passing tests / 6 files**, with mocked transports and real components/router. The detail/test hashes match that receipt. The shared return helper's hash remains unchanged. The 94, 1 and 56 counts overlap and are not additive.
- Test source and saved results were inspected only. No reviewer tests, lint/typecheck/build, DB/network/provider calls, source mutations, staging or commits were performed. Only this disposition report was authored. The original review and repair receipts were preserved.
- Native Auth revocation/cookies, physical browser navigation/reload, multi-tab behavior, runtime SSR and parent aggregate verification remain separate evidence scopes. This disposition grants no native PASS, GO, deployment or release acceptance and adds no general audit requirements.

## Before/after source fingerprints

Frozen-source snapshots at **06:10:11** and **06:10:54 HKT** matched for all nine files below: **no drift**. The earlier provisional read was held when the parent reported a freeze violation; this disposition uses the subsequent explicit final freeze and hashes instead.

| Path | SHA256 (identical before/after) |
| --- | --- |
| `src/features/auth/auth-context-neon.tsx` | `4C303A4AE3FC32E28FC87BCAAE3309D99D818AB350CE5D2A71F7B5295DA80ED4` |
| `src/routes/__root.tsx` | `612DFE1E92CE5F906B341D11E5D5DAD421167E36AC317B61F2ABE8E6C4066C60` |
| `src/routes/login.tsx` | `DB7AD6BBF11047943F40527BBD8A662ACD467E3B9D5E08DF407A3D914505C735` |
| `src/router.tsx` | `9057723E51849B39E3738D9CFC925BB4AED078343E6C4B01389E0B197DBAC7B6` |
| `src/features/auth/auth-router-recovery.test.tsx` | `C139FBDC135EB33B75B1FB79B0234F639FD5885EE297E348BD0E380608AA28C6` |
| `src/features/auth/auth-signout-remount.test.tsx` | `6ED8EA870FA5DE65B50A4579D694A2925CE44032FDE7B15859882E0F7D5BDEA6` |
| `src/features/annual-return/components/production-case-detail.tsx` | `8F066E89512512E471B1D52963AEA57A673FD24E4B20A756D82BADDE558A5049` |
| `src/features/annual-return/components/production-case-detail.return-context.test.tsx` | `8BA5184EA3CE1A34127BC73C7CAAB9ECA02E9C7E0CEEAAEE91F09FFD6BC5F02D` |
| `src/features/annual-return/daily-view-state.ts` | `7E9AB06BDB0833A360E4B5761128F46AB627A5A5F6AE33AC51E21941E842E6AF` |
