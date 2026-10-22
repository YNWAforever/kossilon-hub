# REVIEW-4 — bounded delivery-integrity review

Recorded: 2026-10-23 05:57 HKT. Worktree: `C:/Users/laich/Documents/kossilon-hub/cosec-20261023`; branch `codex/cosec-20261023`; HEAD/base `1c57a67213af72bff8d776694e6ed8c986b921db` plus the uncommitted candidate.

**No actionable correctness findings within the requested fixed-run, local-only contract.** Reviewed both new delivery scripts, all seven new test cases, and the imported CSV parser. Independently read and hashed the four original files in this run's `source-inputs`. The in-progress acceptance matrix/release-candidate content was not reviewed, so this is not a verdict on the eventual package.

## Original-input pins verified

Every hardcoded digest in `scripts/verify-cosec-delivery.ts:6-31` matches the actual raw file in `docs/audit-remediation/cosec-20261023-79d324f0/source-inputs`. Read-only CSV inspection also confirmed the ID columns, counts, uniqueness and absence of blank IDs.

| Type | Original file | Records / unique IDs | SHA256 matched |
| --- | --- | --- | --- |
| F | `Kossilon_Findings_35_Updated_2026-10-23.csv` | 35 / 35 | `bd7663aaf7b95302241f106c56f6cb44e3e42e5b69049b69bbc8ee8f6249c247` |
| R | `Kossilon_Remediation_Tasks_15_Updated_2026-10-23.csv` | 15 / 15 | `9fdb5cbb515ebfa5220a10e55f0db1a975e7450d8752269fa288b922adfe91a8` |
| UC | `Kossilon_Test_Cases_100_With_Followup_2026-10-23.csv` | 100 / 100 | `4bfe0a2e5e0e0f180ba542f05b901f3f973288119952dd89e76cfbe5bc2d3526` |
| LA | `Kossilon_Live_Assertions_34_2026-10-23.csv` | 34 / 34 | `5597705ff8f3a011d3aecba21a609a69111c3bc0d0b7f2f870e7cc3ded55f4ce` |

The lookup uses the supplied original IDs, rather than assuming consecutive finding/task numbers. The four source types total 184.

## Guard review

- **Candidate and local-only authority:** `cosec-delivery.ts:56-67,111-114,130` compares the candidate source SHA with the caller's explicitly inspected SHA, checks the run ID, requires `release_gate=NO_GO` and `auth_runtime_verified=false`, and permits only `BLOCKED` or `NOT_RUN` in every new native-result field. Success reports zero native passes and `NO_GO`. The CLI fixes the run ID and retains the offline-authority label (`verify-cosec-delivery.ts:44,67-77`). Preserved historical results are not miscounted as new native acceptance.
- **Original/history integrity:** `cosec-delivery.ts:69-110` checks each original checksum before parsing, rejects duplicate source types/IDs and wrong per-type counts/ID columns, and requires all four types. Each delivery row must match an original type/ID and source filename. `original_row_json` must parse to an object with exactly the original fields and string values; removing, adding or changing historical fields fails.
- **Duplicate, missing and malformed rows:** `cosec-delivery.ts:26-35,89-110` rejects duplicate CSV headers, missing required delivery columns, wrong row widths, malformed original JSON, duplicate/substituted IDs and any total other than 184. Given 184 unique delivery keys drawn from exactly 184 original keys, a missing original cannot silently pass. The imported parser handles escaped quotes, quoted commas/multiline fields and CRLF, and rejects unclosed quotes, quotes inside an unquoted field and text following a closed quoted field.
- **Evidence paths:** `cosec-delivery.ts:115-127` requires at least one nonempty local evidence path, rejects absolute/drive/URL forms, control characters and `..` segments using either slash convention, then checks every listed file. The CLI resolves the run root and target through `realpathSync`, requires the real target to remain below that root, and requires a regular file (`verify-cosec-delivery.ts:38,52-64`). This supplies the actual missing-file, directory and symlink/junction-escape checks; the unit-test callback alone does not provide those filesystem guarantees.
- **Execution boundary:** The CLI and its transitive application import contain local filesystem/crypto operations only. The imported parser module has no top-level I/O or application initialization. No DB, network/provider call, subprocess, fixture mutation or source write is introduced by these scripts.

## Seven tests and limits

Read all seven cases in `scripts/cosec-delivery.test.ts:80-155`: valid 184-row local package; missing/duplicate/substituted IDs; historical edits; changed input checksum/wrong source SHA/run; forbidden native/GO/Auth claims; absent scope/evidence/files; and unsafe paths/malformed original JSON/duplicate headers. Their generated source data and injected `evidenceExists` exercise the pure validator, not the CLI's real filesystem resolution or the final matrix.

The saved `R23-evidence-green.txt` records **7 tests passed in 1 file**. This review did not rerun those tests, the CLI, lint, typecheck or a build. Digest/count inspection used read-only filesystem operations. No source edits, DB/network access or commits were performed; this report is the only authored file in this review.

The caller-supplied inspected SHA remains the source-SHA authority; this check does not derive a dirty-tree fingerprint or prove that referenced logs establish their claimed result. Those are boundaries of the deliberately bounded integrity validator, not requests to expand it into a general-purpose evidence verifier. No final matrix/schema verdict, native PASS, real Auth acceptance or release authority is granted.

## Reviewed source fingerprints

| File | SHA256 |
| --- | --- |
| `scripts/cosec-delivery.ts` | `5671EA842007542AEB6AC6DF934EEA24318B2159DF3543F37E3329C67D2F05D0` |
| `scripts/verify-cosec-delivery.ts` | `10CD77AF96CE0CEDD8069879ED67DF3FD029E38BF2ED9B54D87B4C6917AAF551` |
| `scripts/cosec-delivery.test.ts` | `19FB42708C1C80A9FA8EE01D16874F2F366301E5597FFE5E04412A87EBABE316` |
| `scripts/audit-uat-ledger.ts` | `7827DE106C6BA0A29FDAD7C03D3E865770E9EBC6236D696A5A34A547C4480641` |
