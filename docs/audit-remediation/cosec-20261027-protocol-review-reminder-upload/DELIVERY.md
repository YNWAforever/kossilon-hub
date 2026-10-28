# Protocol review: manual reminder reconciliation and upload lost-intent

Baseline reviewed: `fcce28d6b5483bd78bc31c8f32590325f3152d98` on `codex/cosec-20261023` (draft PR #147). This change is design only. No product handler, schema, client mutation, or recovery latch was added.

Native remains **70 BLOCKED / 114 NOT_RUN / 0 PASS — BLOCKED / NO_GO**. This document does not execute Native, does not bind artifact or CI evidence, and does not turn either leftover into a local PASS. No build, DB integration, hosted CI, deploy, provider send, storage write, or production Vercel/Neon change was run for this review.

## Recommendation

**Manual reminder.** Give each click a client-minted command UUID, persist that UUID before the POST, and use it as the existing `notification_outbox.idempotency_key` (`annual-return-reminder:{caseId}:{commandUuid}`). Add a staff GET that reads that one row. A read miss does not prove rollback while the POST may still commit; retain the UUID, and any explicitly approved retry must reuse the same command identity and data. On replay, return the existing queued message and do not call `recordReminder` again. A mounted-session latch cannot do this: after a lost response the server has already moved `reminders_sent`, so the key the server would derive on a second click is a different key, and reload drops any in-memory guard.

**Staff upload lost-intent.** The panel already holds the source `documentId` across reload. `createUploadIntent` already links recovery intents through `document_recovery_requested`. Use that identity join for a read-only GET for the initiating auth user, then use the existing `readDocumentUploadReceipt` once the intent id is known. The read must retain terminal/expired history instead of copying create-admission filters: a rejected/failed intent can still name a committed document. A read miss alone does not settle an in-flight create or authorize another upload. Do not search by filename or checksum. Do not resume by calling `createDocumentUploadIntent` again. Portal same-tab reload already has `uploadRequestId` in `sessionStorage`; a closed session that also lost the create response has no remaining client handle, and that case stays deferred.

Cross-tab duplicate-open: this review found no reproduced defect. The portal journal is per-tab `sessionStorage` by the UC150 contract (a new request in another tab is an additive upload). No fix is proposed.

## What can ship without Native

This design set can be reviewed and merged as documentation. The recommended GETs use columns and constraints that already exist (`notification_outbox.idempotency_key` unique; `document_upload_intents` plus `timeline_events.metadata`). They do not require a migration.

Implementing those GETs, the command-UUID key, or the replay skip is a later product change. Unit tests of that change would still leave provider delivery, Auth/RLS, real outbox dispatch, storage/scan, and the duplicate-message journey on the Native gate. A UI latch shipped before the GET exists would repeat the refusal in the 2026-10-27 recovery passes.

## Willy's decisions before any implementation

1. Confirm the manual-reminder command UUID replaces `remindersSent` inside the idempotency key, so a deliberate second reminder is a new UUID after the first receipt is visible.
2. Confirm phone spelling stays out of that command identity. The current key keeps a leading `+` and only strips spaces, so two digit-equal numbers can already queue twice. Changing normalization is a separate decision because it would not match historical keys.
3. Confirm staff recovery identity is "one open recovery per source document for this auth user", which `createUploadIntent` already enforces, rather than allowing `uploadRequestId` on recovery (the server currently rejects that combination).
4. Confirm a portal attempt whose `sessionStorage` journal and create response are both gone stays unrecoverable. No checksum or filename lookup.

Detail, failure modes, and the options that were rejected: [reminder-protocol.md](reminder-protocol.md), [upload-protocol.md](upload-protocol.md). Source pins: [receipt.json](receipt.json).

## PR-diff follow-up

Review of docs commit `031444eaaaa97fc37c98f7b61c312e207bb3c3ea` against `main@7bfdfdc` found two protocol issues, corrected in these docs: read absence was treated as rollback despite a possible late POST commit; and upload receipt discovery reused create-admission filters that hide terminal received intents. CI run [40677487375](https://github.com/YNWAforever/kossilon-hub/actions/runs/40677487375) passed Node22, Node24, and verify on that reviewed commit before this follow-up. These corrections remain design only; the original review's source pin and Native status above are unchanged.
