# Staff controlled-upload receipt readback

Baseline: d3e047060a3cc9a23a42d55bd0cc85e97737191c, draft PR #147, branch codex/cosec-20261023.

After an uncertain finalization response, the staff controlled-upload panel retained its intent ID but offered no independent receipt lookup. It now offers an explicit read-only check of that exact intent. A matched persisted intent/document lineage confirms the recorded upload and requests the existing parent archive refresh, without creating another intent or finalizing/transmitting bytes again.

The new GET server function requires active staff, current intent-scope authorization and the initiating auth user. It matches the committed intent to the document using the existing version/company/case/category/file/type/size/checksum/object/status validator, rechecks authorization after the asynchronous read, and returns only intent ID, receipt state and document ID. Incomplete intents return unconfirmed; missing, denied or inconsistent records fail closed. No storage/scanner operations or repository writes occur on readback.

The UI serializes read checks synchronously, allows another explicit read after failure, and keeps all upload writes unavailable after uncertain server outcomes. It ignores responses after the mounted document session ends. A confirmed registration does not imply current object presence, malware safety or review approval: staff are directed to the archive for those states.

Boundaries: in-session recovery with a known intent ID only. A lost intent-creation response supplies no handle; that path remains blocked with independent verification required. No durable attempt identity or reload recovery was added. No new intent lookup by guessed filename/checksum and no upload write replay. Existing local preparation retry remains unchanged. Server dependency tests and JSDOM RPC fixtures do not establish real Auth/HTTP/RLS, committed database/storage effects or complete staff journey acceptance.

Regression evidence: initial RED had 15 failed / 33 passed across two files. Final focused run has 85 passed / 4 files (included in the full unit total), with 17 new cases: receipt/no replay, incomplete/mismatched results, deduplicated pending read and read retry after denial, late unmount completion, ownership/role/activity/scope/missing intent, inconsistent lineage and access revocation during readback. The existing unknown-intent test additionally asserts no receipt control/request without an ID. Focused read-only review found no important issues.

Initial typecheck found two test-only mock typing errors; corrected with vi.mocked. The first broad unit attempt was stopped (143) while correcting those tests, and is not a completed acceptance run. Original logs are retained. Existing Vite path-resolution and route-export/code-splitting warnings remain.

Native remains **70 BLOCKED / 114 NOT_RUN / 0 PASS — BLOCKED / NO_GO**. Same-candidate artifact, required hosted CI/security, DB catalog/application-role/Auth bindings, complete Today-to-case/action/readback journeys, actual storage/scan/restore, calendar/UC134, scheduler, device/performance and provider/filing gates remain outstanding. Original acceptance rows and approvals are unchanged. Historical build evidence does not bind this source. No build, DB integration, Native execution, hosted CI green, deployment/promotion or production Vercel/Neon changes occurred. PR #147 remains draft and unmerged.

Product commit: `2c774997591cc33dcdc1ba3ec65dcf26aaaafeed` — `fix(documents): read back uncertain controlled-upload receipts without replay`.

Final local verification: **2,890 passed / 290 unit/component files**; focused **85 passed / 4 files**, included in that total. Typecheck, changed-file lint/format and diff checks exit 0. Commands, file fingerprints, counts and retained failure logs: [receipt.json](receipt.json). No product source changes after final checks.
