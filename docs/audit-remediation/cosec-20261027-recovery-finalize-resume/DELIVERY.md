# Staff recovery finalize resume

Baseline: `520402352ef947f1c9a1e87b8df866875e704bac` on draft PR #149, branch `cursor/reminder-upload-protocol-942a`.

Product commit: `ce3d4136dc231198050f9041e507241b8348c187` — `fix(documents): resume an open staff recovery by finalizing the original file`.

The accepted upload protocol already described this write and left it outside the read-only lookup: after that lookup reports the caller's own open recovery, staff may re-select the original file and call finalize. Finalize stays the existing `finalizeDocumentUpload`. This pass wires that gated click. It does not add a server function, a search, or a new identity.

The open panel still starts from `readOpenDocumentRecovery` with only the source `documentId`. When the receipt read is `unconfirmed`, the panel shows a separate file input and the button `以所選檔案完成補傳`. The button does nothing until a file is chosen. The click fingerprints that file and calls the same lookup with name, content type, size, and checksum. Finalize runs only when that result is `open`, the intent id is the one already shown, and the receipt state is still `unconfirmed`. The body goes to the existing finalize POST. `createDocumentUploadIntent` is not called. `uploadRequestId` is not sent.

A `blocked` comparison does not finalize and does not create. The intent id from the earlier own-open read stays on screen. The blocked response is not rendered, and no checksum is shown. An `absent` result does not finalize; a new approve stays a separate preview click. A fresh `received` result uses the existing receipt screen and does not finalize. A failed comparison read stays on the open intent, hides the error text, and does not finalize. Local file preparation failure does not finalize and can be retried. One turn admits one finalize. After finalize has been invoked, a lost or rejected response removes the resume control and leaves the existing receipt check. A response that arrives after the panel unmounts does not call `onRecovered`.

No server file changed. `finalizeDocumentUploadForActor` still checks size and checksum before `storage.put`, returns the committed document without putting again when `documentId` is set, and refuses a non-created or expired intent before the put. The recovery-source token check inside `finalizeUploadIntent` still runs after `storage.put`. That ordering is the existing function. This slice does not change it.

Portal journal loss, the recovery/`uploadRequestId` ban, filename or checksum search, cross-tab locks, schema changes, `recordAnnualReturnReminder`, the follow-up `%` filter, and automated milestone keys stay as they were. No further local pass on this protocol is justified: the remaining holes are the accepted deferrals, and closing them would invent a protocol this review rejected.

Ten panel tests cover the resume. Pre-fix RED, same filter: **9 failed / 1 passed / 17 skipped**. The nine failures were the missing `以所選檔案完成補傳` control while the open-recovery status was already visible. The one pass was the already-received receipt, which already returns the verified screen and therefore had no resume control to miss. No test-fixture typecheck failure occurred.

Native remains **70 BLOCKED / 114 NOT_RUN / 0 PASS — BLOCKED / NO_GO**. This pass does not execute Native, does not bind artifact or CI evidence, and does not turn either leftover into a local PASS. Real Auth/RLS, object storage, scan, and a browser reload of a committed intent stay on the Native gate. No schema migration, hosted CI green, deploy, promote, provider send, storage write from this run, database integration run, or production Vercel/Neon change was made. PR #149 stays draft and unmerged.

## Local verification

Commands and retained RED: [receipt.json](receipt.json).

`tsc --noEmit` exit 0. ESLint on the two changed source files exit 0. Prettier `--check` on those files exit 0. `git diff --check` exit 0.

Focused Vitest, `document-recovery-panel.test.tsx`: **27 passed / 1 file / 0 failed**. Included in the unit total below. Ten of those are the new resume cases.

Vitest `--project unit`: **2997 passed / 292 files / 0 failed**. The db project was not run. `TEST_DATABASE_URL` was not set. This note does not call those integration tests green.

No source changes after these checks. This evidence commit follows the product commit.
