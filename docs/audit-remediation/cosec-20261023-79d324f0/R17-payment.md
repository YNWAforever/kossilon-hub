# R17 payment read path — 2026-10-23

Status: **VERIFIED_LOCAL_UNIT_COMPONENT** for the assigned payment work. R17's document search work belongs to the parent. No DB/runtime, provider, deployment, or production acceptance is claimed.

## Identity and authorized scope

- Checkout: `C:\Users\laich\Documents\kossilon-hub\cosec-20261023`.
- Branch: `codex/cosec-20261023`; base and unchanged HEAD: `1c57a67213af72bff8d776694e6ed8c986b921db`.
- Runtime checked: Node `v24.18.0`; dependencies installed by parent using the lockfile. No install run by this worker.
- Read the supplied development plan, R17 (lines 134–144), and the supplied baseline regression. Original baseline SHA256: `9519118AD1F9CBCE2C1E612D8FE15DA0E3C6827BCB2CB87F3E4A0E37AC15860F`.
- Local source inspection followed the explicit refusal to upload the private graph index. No graph upload retry.
- No commits, push, deploy, DB clients, migrations, provider actions, environment copies, or live data changes. Only `.env.example` exists among the checkout's `.env*` names. Other workers' changes preserved.

## Changed source paths owned by this worker

1. `src/features/annual-return/components/production-payment-review.tsx`
   - Each loaded proof resolves its own context with the existing actor-authorized `getAnnualReturnCase({ data: { id } })`. Proof review never joins to or waits for the unrelated 200-case page.
   - Review context uses an actor-scoped detail cache. Pending refresh disables mutations; failed, denied/null, or mismatched case reads expose no review controls. Failed document-list refreshes also block cached proof controls, while a next-page failure retains previous pages.
   - A separate outstanding-payment section links to cases with unpaid, overdue, or partial payments, including cases with no proof. Case pagination remains available. Denied list refreshes hide cached debt details.
   - Displays server-supplied amount, received amount, balance, payment status, and readiness version. No frontend credit/balance calculation was introduced.
   - Adds a synchronous per-row submission guard shared by record/approve/return, in addition to mutation pending guards. Preserves exact proof/current-version/expected-version payloads, scan safety checks, closed-case guards, and no automatic mutation retries.
2. `src/features/annual-return/components/payment-pagination.test.tsx` (new)
   - Supplied baseline reproduction extended to 20 focused component cases, with server functions replaced by deterministic in-memory fakes.
   - Covers case201 on proof page1, proof101 after a 100-proof first page, no-proof debts and paging, trusted partial balance, null/denied/mismatched context, actor cache separation, stale refresh denial, safe/unavailable proof controls, retained earlier proof pages, cached debt denial, and duplicate record/approve/return attempts.
3. `src/routes/-payments.interaction.test.tsx`
   - Adds a fake for the existing targeted case read and awaits the actual proof review controls.
   - Preserves the existing preview, return-reason, unreadable-proof, safe-byte, empty, and error expectations. The trusted balance assertion is scoped to the proof article so the new debt section cannot satisfy it accidentally.

No new read module or shared server/repository edits were required. `git diff --exit-code <base> --` confirmed no changes to annual-return `server-fns.ts`, `repository.ts`, `payment-evidence.ts`, `payment-evidence-state.ts`, `readiness.ts`, or `readiness-repository.ts` at verification time.

## TDD and verification evidence

All filenames below are local files in this directory; logs use `.txt`.

| Stage | Evidence | Result |
| --- | --- | --- |
| First test launch | `R17-red-baseline.txt` | **Environment failure only**: sandbox TEMP rename EPERM before tests; zero tests ran. This is not RED evidence. |
| First meaningful RED, unchanged supplied baseline copied into the owned test path | `R17-red-case201.txt` | 1 passed / 1 failed. F15 / UC109 failed because `qa-proof-201.pdf：先載入所屬案件資料；暫不可審核。` remained visible for case201 beyond the 200-case page. |
| Extended contracts before implementation | `R17-red-expanded.txt` | 1 passed / 18 failed; missing targeted context/debt behavior was reproduced. |
| Read fix before synchronous submit guard | `R17-read-fix-before-submit-guard.txt` | 20 passed / 4 failed. Three failures showed **two** record/approve/return calls from same-turn duplicate clicks. The fourth was an overly strict query-count expectation: React Query correctly refreshed stale case context when the next proof page mounted. That assertion was replaced by proof101's visible, enabled action and no unrelated case paging. |
| Initial GREEN | `R17-green-focused.txt` | 2 files / 24 tests passed. |
| Authorization/readiness regression | `R17-green-regression.txt` | 6 files / 109 tests passed. |
| Additional cached-debt denial RED | `R17-red-debt-denial.txt` | Selected test failed: cached case link remained after list read denial. 19 nonselected cases skipped by `-t`; these are not verification skips. |
| Final GREEN including cached-debt fix and demo route | `R17-green-final.txt` | **7 files / 112 tests passed / zero skips**, exit 0; 15.24 seconds. |
| Focused lint | `R17-eslint-final.txt` | Exit 0, no diagnostics. |
| Whitespace | `git diff --check -- <owned tracked source paths>` | Exit 0. New component test also formatted and linted. |

The only test-runner workaround was setting `TEMP` and `TMP` for the test process to this checkout's own `R17-temp` directory, created under this evidence directory. After all tests ended, that exact resolved temporary directory was checked to be inside this checkout and removed. All `.txt` evidence remains. No `.env` or repository config was changed. Vite printed its pre-existing tsconfig-paths plugin advisory; it is not an assertion failure.

Final exact unit command:

```powershell
$r17Temp = Join-Path (Get-Location) 'docs\audit-remediation\cosec-20261023-79d324f0\R17-temp'
New-Item -ItemType Directory -Path $r17Temp -Force | Out-Null
$env:TEMP = $r17Temp
$env:TMP = $r17Temp
npm.cmd test -- --project unit src/features/annual-return/components/payment-pagination.test.tsx src/routes/-payments.interaction.test.tsx src/routes/-payments-demo.test.tsx src/features/annual-return/permissions.test.ts src/features/annual-return/server-fns.authorization.test.ts src/features/annual-return/server-fns.test.ts src/features/annual-return/readiness.test.ts --maxWorkers 1
```

The first RED used `npm.cmd test -- --project unit src/features/annual-return/components/payment-pagination.test.tsx --maxWorkers 1` before modifying production source. The cached-debt RED used that command with `-t 'hides cached debt'`.

Final lint command:

```powershell
node_modules\.bin\eslint.cmd src/features/annual-return/components/production-payment-review.tsx src/features/annual-return/components/payment-pagination.test.tsx src/routes/-payments.interaction.test.tsx
```

## Acceptance and remaining limits

| Acceptance | Outcome |
| --- | --- |
| Proof page1 / case201 without paging unrelated cases | Verified, component fake boundary |
| Proof101 reachable and record action enabled after amount/date entry | Verified, component fake boundary |
| No-proof unpaid/overdue/partial cases and next-page links | Verified, component fake boundary |
| Trusted balances, safe/current proof checks, unreadable return without invented receipt | Verified, component/route units |
| Errors, null/denied/mismatched context, stale actor/context, cached debt denial | Verified, unit/component boundaries |
| Same-turn duplicate record, approve, return | Verified, one fake server call per submission |
| Existing actor authorization and readiness/stale-version decisions | Existing pure units passed; no real Auth or DB session |
| DB concurrency/locking and actual credited totals | **NOT RUN**. Existing backend code unchanged. `payment-review.integration.test.ts` was not imported or executed. |
| DB identity/runtime | Parent subsequently proved a disposable identity in `isolated-target.json`: run `cosec-20261023-79d324f0`, container `4f5c362905d14782f4bc2c4bf74af3fc8f2b4e76259342e873bfd1ea78424580`, loopback `60953`, database `cosec_79d324f0`, tmpfs/no mounts, 512 MB. Parent exclusively owns DB execution; this worker still instantiated no DB client and ran no DB suite. Auth/runtime/providers remain unproven. |
| Full suite, build, typecheck | Parent coordinating; no claim made by this worker. |
| Document query/search / 1,000-document search | Parent owns; not edited or verified by this worker. |
| Browser/live UAT, provider/scanner, deploy/production | Not run / outside authorization. |

Source fingerprints at final verification are in `R17-source-fingerprints.json`. They identify these three dirty working-tree source files, not a tested final commit or the entire shared candidate. HEAD remained the supplied base; no commit was created.

