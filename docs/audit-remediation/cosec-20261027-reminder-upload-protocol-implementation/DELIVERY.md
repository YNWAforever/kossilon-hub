# Manual reminder command UUID and staff recovery lookup

Accepted design, 2026-10-27, from draft PR #148 (`cursor/protocol-review-reminder-upload-3c21`). The review notes are in [../cosec-20261027-protocol-review-reminder-upload/DELIVERY.md](../cosec-20261027-protocol-review-reminder-upload/DELIVERY.md). This change implements the four decisions Willy accepted. It does not replace that review.

Starting ref: `fcce28d6b5483bd78bc31c8f32590325f3152d98` on `codex/cosec-20261023` (draft PR #147).

Implementation commit: `740077307c61d664d2209e0eec3cc1c541a0a18f`.

Native remains **70 BLOCKED / 114 NOT_RUN / 0 PASS — BLOCKED / NO_GO**. This implementation does not execute Native, does not bind artifact or CI evidence, and does not turn either leftover into a local PASS. No schema migration, hosted CI green, deploy, promote, provider send, storage write, or production Vercel/Neon change was made.

## What landed

**Manual reminder.** Each click is a client-minted command UUID, persisted in `sessionStorage` before the POST, under the actor, case, and the recipient text as typed. The outbox key is `annual-return-reminder:{caseId}:{commandUuid}` on the existing `notification_outbox.idempotency_key` unique constraint. The phone stays the contact-digit check and the message `toPhone`. It is not part of the key, and historical `phone:remindersSent` keys are not rewritten. Staff GET `readAnnualReturnReminderCommand` returns one closed state: `absent`, `queued`, `sent`, `failed`, `unknown`, or `redacted`. `messageId` is included only while the payload still has it. On `idempotentReplay`, the queue returns the existing message and does not call `recordReminder`. The case-page mutation uses `retry: false`, disables send while that GET is unread or failed, and blocks a second click in the same turn. That guard does not replace the GET. A visible non-absent receipt is what allows the next click, and that click mints a new UUID. Reload restores the latest command for the actor and case and reads it. A corrupt journal blocks send.

**Staff upload.** `readOpenDocumentRecovery` is a read-only GET by the source `documentId`. It runs the same prior-intent query `createUploadIntent` already uses (one open `document_recovery_requested` row, excluding terminal and expired-created intents). It returns `absent`, `open` with `intentId` and the receipt state (`unconfirmed` or `received`), or `blocked` with no id and no checksum when the actor or the selected file does not match. The panel calls it on mount and after a lost create, before another create. An open result then uses the existing `readDocumentUploadReceipt`. The lookup does not create or finalise. The recovery/`uploadRequestId` ban is unchanged. Portal same-tab `sessionStorage` journal code is unchanged.

## Deferred

- A portal attempt whose journal and create response are both gone stays unrecoverable. No filename or checksum search was added.
- No cross-tab lock. Two reminder tabs that mint two UUIDs are two commands. UC150 additive uploads across tabs stay as they are.
- An explicit later resume that re-selects the original file and calls finalize is still a write. This GET does not perform it.
- `recordAnnualReturnReminder`, the follow-up `%` delivery filter, and automated milestone keys are unchanged.
- The reminder GET uses the same `record_reminder` case check as the queue, including the writable-case guard. A later lock on the case can refuse the read. That is the existing check, not a new receipt store.

## Local verification

`tsc --noEmit` exit 0. ESLint on the changed files exit 0. Vitest, no `TEST_DATABASE_URL`: **2998 passed / 440 skipped / 0 failed** (298 files passed, 48 skipped). The skipped tests are the existing database integration tests. They were not run, and this note does not call them green. Focused files cover key shape, replay skip, closed states, the journal, the case-page command, the recovery lookup, and the recovery panel. Provider delivery, Auth/RLS, a real second outbox row, redaction, storage, and scan stay on the Native gate.
