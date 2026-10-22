# Review2 finding 6 — client / case return context

Run `cosec-20261023-79d324f0`, shared candidate `codex/cosec-20261023`, base HEAD `1c57a67213af72bff8d776694e6ed8c986b921db` plus uncommitted changes. This is a local source/unit follow-up to `R19.md`, not new authenticated or DB acceptance.

## Verified defect and repair

The three business links in the client work overview omitted `search.returnTo`. The document-to-case and annual-return-history links had the same omission. Additionally, the shared `caseReturnPath` accepted `/clients` but rejected an exact `/clients/<UUID>` return, so adding a link parameter alone still returned the user to a business list.

- `client-return-context.ts` builds an exact client-detail URL from a validated UUID-shaped company ID and the existing sanitized register return URL. Router serialization nests the register context once; it is not replaced with a business-list URL.
- All three overview business links, the document's annual-return case link, and annual-return history links pass that detail URL in `search.returnTo`.
- The client detail's existing register link remains separate: **case → exact client detail → original filtered register**, retaining query, status, team and tuple cursor. The client ID remains the one from the current validated client route.
- The parent explicitly reassigned **only `caseReturnPath`** in `daily-view-state.ts` after Schrodinger finished R15. Its existing safe-redirect guard and business-list allowlist remain. An additional detail path is accepted only when the entire `/clients/` suffix parses as the existing canonical UUID shape; the original safe query is retained unchanged. Extra path segments, malformed IDs, repeated/scalar-invalid values, foreign/protocol-relative URLs, backslashes and control characters remain rejected.
- `DailyViewSearch`, `dailyViewSearch`, `dailyReturnPath`, `otherCursor` and Schrodinger's `defaultStringifySearch` behavior are unchanged. A normalized-text comparison against `R19-review2-daily-before.ts.txt` is recorded as true in `R19-review2-daily-preservation.txt`.
- A return URL grants no read access. The existing backend role/team/company authorization was not changed. Malformed client IDs still stop before client/work reads; a backend client-company denial still prevents case links and work loading.

## RED / GREEN evidence

| Evidence | Actual result |
| --- | --- |
| `R19-review2-return-context-red.txt` | 5 failing entry-point assertions, 2 passing malformed/backend-denial tests, before link repair |
| `R19-review2-return-context-wiring.txt` | Links carry the context, but 3 case-return assertions still fail at the old shared allowlist |
| `R19-review2-sanitizer-red.txt` | 2 accepted-client-detail assertions fail, 28 helper/rejection assertions pass, before changing `caseReturnPath` |
| `R19-review2-final-unit.txt` | **13 files / 203 tests passed**, exit 0, `--project unit --maxWorkers 1` |
| `R19-review2-lint.txt` | Targeted ESLint exit 0 |
| `R19-review2-diff-check.txt` | `git diff --check` exit 0 |

The routing regression mounts the real client detail with real TanStack Link/router serialization and each business route's actual search validator. It follows the accepted return URI back to the client and verifies the distinct register link and tuple cursor. Case bodies in this test are placeholders, and all reads are mocked; this is in-memory routing/component evidence, not live case-page UAT. Existing annual-return, incorporation, corporate-change, client and document role/team/read-denial units are included in the 203-test batch.

`R19-review2-typecheck-final.txt` is **exit 2** with only these two peer-owned test typing errors remaining:

- `src/features/annual-return/daily-view-state.test.ts:18` — direct `returnTo` property access on `AnySchema`.
- `src/features/annual-return/work-views-today.test.tsx:141` — the same `AnySchema` property access.

The errors in this worker's new test files were corrected; those two R15 test files were left unchanged for the parent. Full-project typecheck is therefore not claimed green.

## Source identity and evidence boundaries

`R19-review2-source-sha256.json` fingerprints the seven changed/new source and test paths. The original R19 fingerprints and receipts remain historical records. `R19-review2-backend-preservation.txt` confirms the four directly affected document/company read backend files still match the prior source snapshot; this fix changes no SQL, RPC scope, document safety guard or version-bound byte action.

The parent's prior disposable document SQL result remains **2 files / 45 tests passed** in `isolated-db-documents-green-attempt.txt`. No DB client or DB test was run for this review follow-up. No authenticated browser, production, provider, storage, business send, migration, commit, push, merge or deploy action was performed. Internal Codex coordination was explicitly authorized by the parent. Parent consolidated verification/fingerprints and authenticated UAT remain separate layers.
