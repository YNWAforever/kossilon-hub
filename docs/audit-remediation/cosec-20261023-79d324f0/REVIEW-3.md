# REVIEW-3 — final independent focused source review

Recorded: 2026-10-23 05:46 HKT. Candidate: `C:/Users/laich/Documents/kossilon-hub/cosec-20261023`, branch `codex/cosec-20261023`, base and HEAD `1c57a67213af72bff8d776694e6ed8c986b921db`, plus the current dirty/new files. This is an independent static review; the regression cases below are proposed, not executed.

## Findings

### 1. [P1] Root error recovery discards the sign-out fence

**Location:** `src/routes/__root.tsx:214-219`; related `:135-138`, `:101-105`, and `src/features/auth/auth-context-neon.tsx:95-103,252-277`.

**Trigger:** Account A starts sign-out, which remains pending or fails/times out while A's provider session remains valid. An in-app protected-route navigation (including browser Back) then encounters a root actor-read service failure or timeout. After the root error screen appears, its Retry action succeeds with the still-valid A session.

**Impact/cause:** The new boundary survives the keyed `AuthProvider` remount, but lives inside `RootComponent`. The root route's error fallback replaces that entire component, destroying the boundary's ref/state. Retry mounts a fresh boundary with a null marker; normal hydration accepts A again without a new explicit sign-in. An outstanding sign-out completion still targets the discarded boundary. This reopens the original private-content re-entry class through root error recovery, without a page reload. The installed router source confirms the replacement: `node_modules/@tanstack/react-router/src/Match.tsx:139-157,241-260` and `src/CatchBoundary.tsx:38-54` under the same package.

**Repair:** Keep sign-out intent in a per-router/per-client lifetime that encloses the root error/pending presentation as well as the actor-keyed provider. Preserve SSR request isolation; a process-wide auth marker would be unsafe.

**Regression to add:** Use the real router/root error boundary with mocked transports. Hold or reject A's sign-out, force the next protected navigation's root actor read to fail, then recover it as A and click the actual error Retry action. Assert A's private outlet stays hidden and the sign-out recovery state survives. Repeat after a sign-out timeout. The current remount test mocks router state and renders `Route.options.component` directly, so it never exercises this replacement.

### 2. [P2] Retried denied-account sign-out leaves a valid new account trapped on login

**Location:** `src/features/auth/auth-context-neon.tsx:399-407`; related `src/routes/login.tsx:84,97-116,171-179`.

**Trigger:** Enter `/login?denied=1&redirect=...`; its automatic sign-out rejects, returns an error, or times out. Click the displayed session-recovery button, let the retried sign-out succeed, then successfully sign in as an active, verified account B.

**Impact/cause:** Only the original `signOut().then(...)` in the denied effect removes `denied` from the URL. That promise has already rejected. `retrySession()` performs a separate successful sign-out, but neither it nor `retryLoginSession()` clears the URL marker. The `signOut` callback stays stable across these marker changes, so the denied effect does not run again. B is published as a verified session, but the login redirect effect always exits at line 84 while `denied=1` remains. The advertised account-switch recovery therefore cannot leave login without another navigation/reload.

**Repair:** Make successful explicit recovery complete the denied-state URL transition too, while retaining the guard until sign-out is confirmed.

**Regression to add:** Extend the real provider/login composition with `denied=1`, an initial rejected/returned-error/timed-out sign-out, a successful manual retry, and a verified B credential sign-in. Assert `denied` is removed, the safe redirect is retained, and navigation reaches B's permitted destination. The existing denied-login test covers initial sign-out success; the new retry test starts without `denied`.

### 3. [P2] Annual-return failure screens still discard the originating client

**Location:** `src/features/annual-return/components/production-case-detail.tsx:231-238`; related `:96,100-108,255-256` and `src/features/clients/components/client-work-overview.tsx:91-96`.

**Trigger:** Open an annual-return case from the client overview/history/document entry with its new nested client/register `returnTo`; the case request then fails or returns no accessible record.

**Impact/cause:** The success screen uses `caseReturnPath(returnTo)`, but the request-error screen hardcodes `/annual-returns`, and `CaseNotFound` receives no return context. The only recovery back action loses the originating client plus its register filters/cursor. This leaves the failure branch of REVIEW-2 finding 6's client-return repair incomplete. Incorporation/corporate-change valid-ID wrappers retain their separate contextual return action even when the inner read fails.

**Repair:** Pass the same sanitized return destination into the annual-return error/not-found states and render their back action from it.

**Regression to add:** Render the real annual-return detail with the exact client return URI, reject its read and separately return null, then follow its displayed recovery link. Assert the same client and nested register search/cursor survive. `client-case-return-context.test.tsx:95-101,177-183` substitutes the case component and calls the return helper directly, so it cannot detect these recovery links.

## Focused checks and evidence limits

- The original actor-provider-remount mechanism in REVIEW-1 is repaired at the inspected source layer: the outer boundary retains the marker, session generations invalidate old publications, sign-out cancels/clears the previous actor scope, and failure/timeout remains fenced during that boundary's lifetime. Finding 1 identifies an additional root-error lifetime gap.
- Explicit credential sign-in is blocked while sign-out is pending/failed. After confirmed sign-out it still requires an active actor matching the session user's ID. No additional concrete false-actor publication was found in that inspected path. Late completion of the timed-out sign-out race does not itself clear the failed marker.
- The shared return helper checks the exact client UUID path, serializes nested search through the router, and retains the existing same-site/control-character boundary. All three case route/consumer paths were read. No additional concrete unsafe destination was found in that chain; finding 3 concerns recovery-context loss.
- Auth source/root/test hashes match `REVIEW-1-auth-final-sha256.json`; login matches `R24.md`. The saved `REVIEW-1-auth-green-final.txt` records 7 files / 85 passing tests. That is inspected historical mocked RPC/component evidence, not a rerun or real Auth acceptance.
- WorkQueue's separately reviewed 18-test repair and R21 SQL work were outside this pass. No whole-branch review, fixture-file inspection, test/lint/build execution, network/DB/provider access, secret reads, source edits, staging or commits. Local-source fallback followed the existing graph-upload refusal; no indexing/upload was retried. This report is the only authored file.
- Native Auth/session cookies, browser/provider revocation, reload persistence, cross-tab behavior and SSR/browser runtime acceptance remain unverified. The lifecycle observation above is based on the current application and installed router source. No release or merge approval is implied.

## Reviewed source fingerprints

SHA256 snapshot taken before writing this report. The candidate is shared and uncommitted; these fingerprints identify the reviewed content.

| Path | SHA256 |
| --- | --- |
| `src/features/auth/auth-context-neon.tsx` | `B26367470915B81EBD054D37B2DF5BB413BCA1A5264A4D7139D9273BB6B9B66F` |
| `src/routes/__root.tsx` | `332A0668781B06D1EF53AC2CAE690980C20985FB76D0CA5735436AB73AF555DB` |
| `src/routes/login.tsx` | `0E47DB2168506C4FDAE80434A6351C05EE0632DDECB97E2AAEBD5A96E8EFEACD` |
| `src/features/auth/auth-signout-remount.test.tsx` | `6ED8EA870FA5DE65B50A4579D694A2925CE44032FDE7B15859882E0F7D5BDEA6` |
| `src/features/auth/auth-context-neon.test.tsx` | `534835DC769DEB9321EE673D70B125EA9A268CABFCAD61FB59CE476D6442AF44` |
| `src/features/clients/client-return-context.ts` | `FDE64198A77E797E1D58AC78204221A17DA48B066BF1C4837910838E4BD93D1A` |
| `src/features/clients/register-view-state.ts` | `D4E085D4AE7555FC9D7C6504245C89249C6F0628DC58CAD07EA99909EB25F79B` |
| `src/features/clients/components/client-work-overview.tsx` | `893D640A6595C344DDDCB6506DFB15CAE48BC204AE0B7B9B9D7CF03830410D6A` |
| `src/features/clients/components/production-client-detail.tsx` | `A7882B5B042ABED828F6C4D243F3D8FDD09243160EB9C54212058BFE9634A236` |
| `src/features/annual-return/daily-view-state.ts` | `7E9AB06BDB0833A360E4B5761128F46AB627A5A5F6AE33AC51E21941E842E6AF` |
| `src/features/annual-return/components/production-case-detail.tsx` | `DC87EA80F838995AF52768C599E7586C80008A1429F234018F5404360959F536` |
| `src/features/incorporation/components/production-incorporation-detail.tsx` | `FB3D3C1607D94EC9D6F9BD5FA19FF485B598B492DAACB6A0A9FC816942C94902` |
| `src/features/corporate-changes/components/production-corporate-change-detail.tsx` | `8102208BAE797C18DC0458AA1DAD65EF45650E2C381D364D31660647CFC07282` |
| `src/routes/clients.$id.tsx` | `48C80EA8C3C533A685860E930421E5A4FD0871F131E0139544BB935D369B239B` |
| `src/routes/annual-returns.$id.tsx` | `EB8712BF58FCAE0989445CC649BB631F68DF3BE947137038D5678F9B47077E74` |
| `src/routes/incorporation.$id.tsx` | `F82D3D046B155C2C990E73199540B4CF52AFE288804CBA82E1C9856D54782E2F` |
| `src/routes/corporate-changes.$id.tsx` | `8A18469AFD7D1B4F4B74ED913B027BB1F3392638492836851100FC0C12C7E3F1` |
| `docs/audit-remediation/cosec-20261023-79d324f0/REVIEW-1.md` | `BF232B3DE97B87604029DB820E66ED8FA47054F673CDA2E4E5B042166C2A75B1` |
| `docs/audit-remediation/cosec-20261023-79d324f0/REVIEW-1-auth-fix.md` | `D762F31078B56BBCF6838581EAFEFF0AD67E2621BE6A5AA063C70CDF8E6D7916` |
