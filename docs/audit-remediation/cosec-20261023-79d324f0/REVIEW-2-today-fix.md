# Review 2 — Today fixes for findings 2 and 3

Recorded: 2026-10-22T21:29:28Z (2026-10-23 HKT).  
Worktree: `C:\Users\laich\Documents\kossilon-hub\cosec-20261023`  
Branch/base: `codex/cosec-20261023` / `1c57a67213af72bff8d776694e6ed8c986b921db` plus shared dirty sources/new files. No commit created.

## Immutable review

`REVIEW-2.md` preserves the review as issued, including its historical line references and excluded/disproved candidates. It was created once, has the Windows read-only attribute, and was not updated as fixes progressed.

SHA256: `8ec204fd016b3d6887567343c0e7b69401b2357058366a77b2cd9b95d6d2478e`.

## Finding 2: unfinished cases after final checklist verification

Both incorporation and corporate-change checklist updates can verify the last item while leaving the parent status at `Documents pending`. Previously the Today SQL projection excluded this state from every category.

The `returnsAndExceptions` SQL predicate now includes an unfinished `Documents pending` case when `required_count > 0`, there are no required Missing/Rejected labels, and no items remain Received. The existing outer domain predicates continue to exclude Completed/Cancelled/completed timestamps and enforce the same team scopes, search and keyset page boundaries before LIMIT. The existing checklist status contract makes those counts sufficient to identify fully verified required items; this is a manual follow-up classification, not a new approval test.

Its row explains that the checklist has been checked but the case remains unfinished, and asks the operator to manually verify filing evidence and the next case action. `readyForApproval` remains the literal `false`; the `readyToFile` predicate is unchanged. Missing/received/unknown-requirement and filed-follow-up branches remain distinct.

Two new SQL regression cases were authored BEFORE the fix, one for each domain. Each builds unique synthetic rows inside a rollback transaction, starts with a Received final required item, reads it in newlyReceived, changes only that item to Verified, then requires the exact same case ID in returnsAndExceptions with `Documents pending`, an explicit manual next action and `readyForApproval=false`. It also requires absence from newlyReceived and readyToFile. These new SQL cases were NOT executed by this assessor. Parent owns the isolated DB target and execution.

## Finding 3: exact Today return context

`DailyViewSearch` gains optional `otherCursor`. Its existing 4096-character route bound is moved into `dailyViewSearch`, alongside the existing annual-return cursor bound. `dailyReturnPath` uses the real router's `defaultStringifySearch` so numeric/JSON-shaped q values and JSON tuple/object continuation strings remain strings when read by `defaultParseSearch`.

The Today route delegates validation to that helper. Annual-return, incorporation and corporate-change links use the same daily return builder, preserving both page cursors. The other-business links no longer manually append/re-encode otherCursor after building the URL.

Regression tests call the actual installed `defaultParseSearch`/`defaultStringifySearch`, including nested detail returnTo, reload reserialization, numeric q, JSON-shaped q, a JSON tuple cursor and a JSON object otherCursor. The component test inspects all three business detail links with the actual parser. Server reads/router hooks remain stubbed in that component test; it is not an authenticated or native browser journey.

## Scope and shared interfaces

Only findings 2 and 3 were implemented here. No edits were made to the queue serializer/filter fixes (parent), R20 controls/refresh (Noether), or client-overview links (Dirac). A peer request concerning finding 6's client-detail sanitizer was not incorporated because the direct task limits this pass to findings 2 and 3.

The existing `caseReturnPath` allowlist and `getSafeRedirectPath` behavior are preserved; Prettier only wrapped the pre-existing allowed-path array. Any finding-6 sanitizer change remains a separate owner task. `OtherWorkSource`, `OtherWorkRow`, page/repository interfaces and RPC signatures are unchanged. `DailyViewSearch.otherCursor?: string` is the only additive public type field. No readiness or domain write/authorization/completion implementation was changed.

## Verification actually run

Node: v24.18.0. All Vitest commands use `--project unit --maxWorkers 1`. Process-local TEMP/TMP point at this run's `review-2-today-temp` directory; no environment file was copied or credentials printed.

| Evidence file | Result | Meaning |
| --- | --- | --- |
| `REVIEW-2-today-red.txt` | 3 files; 6 failed / 14 passed | Before product edits: 2 manual-follow-up model failures, 3 real-serializer round-trip failures, 1 all-business link-context failure. Does not establish a SQL RED run. |
| `REVIEW-2-today-green.txt` | 8 files / 67 passed; exit 0 | Focused fix and surrounding readiness/work-view/Today/page/DB-registry unit regressions. |
| `REVIEW-2-today-final.txt` | 8 files / 67 passed; exit 0 | Same focused command after final formatting; duration 10.35s. |
| `REVIEW-2-today-eslint.txt` | exit 0 | ESLint on all eight changed source/test paths, including the authored SQL test file. |

Prettier completed successfully on those same eight paths. `git diff --check` passed for the tracked edited source files. Vitest printed the existing vite-tsconfig-paths/native-resolution advisory twice; it did not affect the test result.

Final unit command:

```text
node node_modules/vitest/vitest.mjs run --project unit --maxWorkers 1 src/features/annual-return/daily-view-state.test.ts src/features/annual-return/work-views-other.test.ts src/features/annual-return/work-views-today.test.tsx src/features/annual-return/work-views-other-page.test.ts src/features/annual-return/readiness.test.ts src/features/annual-return/work-views.test.ts src/routes/-today.interaction.test.tsx src/test/db-integration-files.convention.test.ts
```

Parent-only SQL command, after the parent's exact isolated-target/serialized-execution gate:

```text
node node_modules/vitest/vitest.mjs run --project db --maxWorkers 1 src/features/annual-return/work-views-other.integration.test.ts
```

The integration file now has its original scoped-pagination case plus two final-verification cases. The parent-reported earlier 1-test SQL PASS applies to the previous file, not these newly authored cases.

No DB clients/connections, DB test runs, migrations, network/provider calls, browser/runtime acceptance, commits or remote operations were performed in this fix pass. Full suite, build, combined typecheck and native acceptance remain with the parent. SQL behavior is source-fixed and awaiting the parent's actual execution result.

## Final source fingerprints

These identify this assessor's final files; the shared checkout is still being edited by other owners.

| Path | SHA256 |
| --- | --- |
| `src/features/annual-return/daily-view-state.ts` | `2ee82d3b883726fc2ae64c2bcd3de1a2607b4f4e9dd7f48586cb6b3056de8f12` |
| `src/features/annual-return/daily-view-state.test.ts` | `dd74781a237199b5f4b8f4e92010a4fa4677559ce8fb20e1008ff8e7489a53d8` |
| `src/features/annual-return/work-views-other.ts` | `0f49969096832261c85a4224279582e150ea28664079a4ece9ef7d633dc95785` |
| `src/features/annual-return/work-views-other-repository.ts` | `b57a047e07d9dd41f991b73a4c54025e5a3d0bb3afd73b2dc9b42a3b3089ecc2` |
| `src/features/annual-return/work-views-other.test.ts` | `6f07a8313115d6be06b71e9d38f9d721a437cba4cae06f626ac66868541238bd` |
| `src/features/annual-return/work-views-today.test.tsx` | `79048c353a7c6fe2c48033d895ed8669e78a5d952f0eded64a1cd91204ef8b41` |
| `src/features/annual-return/work-views-other.integration.test.ts` | `95dfa7bebb23dfc83bd63b4e1d9eaf864e836ff5dba085f92b9e007d7eaedf4a` |
| `src/routes/today.tsx` | `069ebb25747a9c32f518bbb826df0886ec28d68abcd31c33133d018d1a8948fb` |

## Evidence amendment — parent SQL result and test-only typing repair

Recorded: 2026-10-23 05:47 HKT (2026-10-22T21:47:36Z). Earlier results and fingerprints above are retained as historical evidence. This amendment supersedes the earlier pending-SQL statement for this exact Today integration file only.

Read `REVIEW-2-today-sql.txt`: the parent ran `vitest run --project db src/features/annual-return/work-views-other.integration.test.ts --maxWorkers 1` and recorded **1 file / 3 tests passed**, duration 1.09s. This covers the original scoped-pagination regression plus the two final-verified/unfinished cases, one per business. The current integration file still hashes to `95dfa7bebb23dfc83bd63b4e1d9eaf864e836ff5dba085f92b9e007d7eaedf4a`, matching the authored file in this receipt. The SQL log hashes to `43df0783366ded923c1a62283250ee3a7cbbbef98ab1870af0ffde40a1a0fa1b`. This is parent-executed isolated SQL evidence, independently read here; this assessor did not execute a DB test or open any DB client.

The parent reported two aggregate-typecheck errors from accessing `AnySchema.returnTo` in the new tests. Current source confirms the targeted test-only casts:

- `daily-view-state.test.ts` casts the parsed nested detail search to `{ returnTo: unknown }` before passing its value into the real `caseReturnPath` guard.
- `work-views-today.test.tsx` casts the parsed detail search to `{ returnTo: string }`; the existing runtime string assertion and all exact restored-search expectations remain present.

The tests' fixture values, case matrices and behavioral expectations are unchanged. Both test files were formatted by the parent. This amendment does not present the earlier 67-pass run as a fresh rerun of these newly typed files, and does not claim the parent's aggregate typecheck/full-unit run has completed.

Current replacement test fingerprints:

| File | SHA256 |
| --- | --- |
| `src/features/annual-return/daily-view-state.test.ts` | `120de0c5402511bc9379eef4b5f6d76e8561f8e44bafc2768ceb55b025640693` |
| `src/features/annual-return/work-views-today.test.tsx` | `f412e75e34393fdc72c2cf2ce26258180da2682b1b9d7c372e3692c5d686999b` |

The Today route, other-work model/repository/model tests and integration file still match the original final fingerprints above. The shared `daily-view-state.ts` now hashes to `7e9ab06bdb0833a360e4b5761128f46ab627a5a5f6ae33ac51e21941e842e6af`: it contains Dirac's separately assigned finding-6 `caseReturnPath` client-UUID-detail allowlist update. The completed `DailyViewSearch`, `dailyViewSearch` and `dailyReturnPath` cursor/serializer changes remain intact. No production change was made as part of the parent's two typing fixes or this receipt amendment.

Parent also preserved and moved the owned TEMP caches under ignored `node_modules/.cache/cosec-run-temp`; original evidence logs were not moved. Any later authorized targeted rerun must set TEMP/TMP under node_modules only, never recreate cache directories under this receipt folder. Exact moves are recorded by the parent's `owned-temp-moves.json`.

`REVIEW-2.md` remains read-only and retains SHA256 `8ec204fd016b3d6887567343c0e7b69401b2357058366a77b2cd9b95d6d2478e`. Only this receipt was amended. Source/test edits, formatting, test execution, DB clients, network calls and commits were not performed in this amendment pass. The parent's source freeze remains in effect; native/production acceptance is not claimed.
