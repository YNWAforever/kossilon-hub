# Manual reminder queue / log reconciliation

Reviewed at `fcce28d6b5483bd78bc31c8f32590325f3152d98`. Design only.

Prior passes (`cosec-20261027-automation-draft-read-recovery`, `cosec-20261027-filing-receipt-recovery`, `cosec-20261027-integration-read-recovery`) left this path closed because a lost response has no command handle the UI can re-read. This note checks that claim against the handlers and states the protocol that would make a later UI safe.

## Current semantics

Staff click on the case page calls `queueAnnualReturnWhatsAppReminderMessage` (`src/features/annual-return/server-fns.ts`). The body is `caseId`, `recipientName`, `recipientPhone`. The actor comes from the request. The handler:

1. Opens one `sql.begin`.
2. Builds both repositories on that same transaction.
3. Loads the case and checks the phone, as digits, against `company_contacts` for that case's company.
4. Calls `queueAnnualReturnWhatsAppReminder`.

`annualReturnReminderIdempotencyKey` (`src/features/annual-return/whatsapp-reminders.ts`) is:

`annual-return-reminder:{caseId}:{recipientPhone with spaces removed}:{case.remindersSent}`

`remindersSent` is the counter **before** this click. The comment on that function says the counter is in the key so two concurrent clicks collapse to one send, and a later click after the counter advances is a new reminder.

`queueOutboundTemplateMessage` (`src/features/whatsapp/repository.ts`), still inside the outer transaction when called from this server function:

- Locks the company and the case, checks staff authority for `record_reminder`, and refuses a locked, Filed, or Completed case.
- Takes `pg_advisory_xact_lock` on the idempotency key.
- If `notification_outbox` already has that key and its payload still contains `whatsappMessageId`, returns that `whatsapp_messages` row with `idempotentReplay: true`.
- If the key exists and the payload has no message id (including after 90-day redaction, which nulls `payload` and keeps `idempotency_key`), throws `Existing WhatsApp follow-up cannot be replayed safely.`
- Otherwise inserts `whatsapp_messages` (`status = queued`), a `whatsapp_message_queued` timeline row, and a `notification_outbox` row. `idempotency_key` is `text not null unique` (`src/server/db/schema.sql`).

Then `recordReminder` (`src/features/annual-return/repository.ts`) increments `annual_return_cases.reminders_sent`, may move `Upcoming` to `Client reminder sent`, and inserts `reminder_logs`, a `client_reminder_logged` timeline row, and an audit event. `reminder_logs` has its own uuid. It does not store the outbox id, the WhatsApp message id, or the idempotency key.

The HTTP body on success is `caseId`, `remindersSent` (after the increment), `currentStatus`, `messageId`, `messageStatus`. `messageId` is `whatsapp_messages.id`. The client does not send or store a command id.

`withTransaction` in both repositories calls `client.begin` only when the client has `begin`. The codebase treats an in-flight postgres.js transaction as the client that has `savepoint` instead (`src/server/db/operational-read.ts`). The production server function therefore runs the queue insert and `recordReminder` on one transaction. A throw from `recordReminder` fails that `sql.begin` and rolls the outbox insert back with it.

That is a correction of the shorter note in `cosec-20261027-automation-draft-read-recovery`. The helper really does call the queue write and then `recordReminder`, and a caller that gives each repository its own root client would commit the outbox before the log. The production HTTP handler does not do that. This review did not open a database session; the conclusion is the control flow above.

Two related writes sit outside that pairing:

- `recordAnnualReturnReminder` is a separate POST that inserts a reminder log and increments the counter with no outbox row.
- The automated sweep and the follow-up sender also increment `reminders_sent`. Follow-up uses `follow-up:{source}:{caseId}:{entityId}` and, on `idempotentReplay`, skips `recordReminder` (`src/features/annual-return/follow-up-server-fns.ts`). The manual helper does not skip. A second request that finds the same outbox key still logs another reminder and increments the counter again.
- Automation delivery readback selects `idempotency_key like 'follow-up:%'` (`src/features/annual-return/follow-up-repository.ts`). Manual keys use the `annual-return-reminder:` prefix, which the failed-reminder reconciler scans on the cron, not a staff read API. Inbox reads take a contact id (`src/features/whatsapp/server-fns.ts`). They are not a receipt for this POST.

The case-page mutation (`reminderMutation` in `src/features/annual-return/components/production-case-detail.tsx`) has no `retry: false`, unlike the owner, status, checklist, note, packet, and filing-receipt mutations beside it. `src/router.tsx` constructs `new QueryClient()` with no mutation default. This review does not claim the library retries the POST on its own. The button stays enabled after an error (`isPending` is the only disable). A person can send the same body again. Success only toasts and invalidates the case and notifications queries.

## Failure modes

| Outcome | What is stored | What the UI has |
| --- | --- | --- |
| Request fails before the outer commit | No outbox row, no new log, counter unchanged | An error, and the same button |
| Outer commit succeeds, response is lost (timeout, closed tab, worker finished after commit) | One outbox row, one WhatsApp `queued` row, one log, counter + 1 | No `messageId`. Reload has only the case read |
| Second click after that lost success | Server reads the new counter, so the key is different. A second outbox row is inserted and the counter moves again | Two statutory reminders can be queued |
| Two in-flight clicks that both read the same counter | Advisory lock collapses the outbox to one row. The manual helper still calls `recordReminder` on the replay, so the counter and `reminder_logs` can move twice for one message | Each response that arrives looks successful |
| Retry after the outbox payload has been redacted | The unique key still blocks a new insert, and replay throws because `whatsappMessageId` is gone | An error. The row is still queued-or-settled history, not "absent" |
| Automated sweep or another staff reminder lands first | `reminders_sent` advances for a different key shape or a different phone | A case-counter or history diff does not name this click |

`reminders_sent`, a new `client_reminder_logged` row, or a new `reminder_logs` row cannot prove this click's queue outcome. The counter also moves for automation, follow-up, and the log-only POST. The log row is not tied to an outbox key. A matching phone in history can be an earlier deliberate reminder. An outbox row can exist for this key while a replay has written an extra log, so the counter can move without a second message.

## Why a local UI latch is insufficient

A ref that disables the button until a case refetch returns would cover one mounted session. It would not survive reload, and the case refetch has no field that is this command. `messageId` existed only in the lost response. The idempotency key the server will use on the next POST depends on `reminders_sent` after the first commit, which the client does not know if the response was lost. Blocking the button while showing a generic error also leaves the staff member unable to tell a rolled-back attempt from a queued message that the dispatcher may still send.

Widening the follow-up delivery query to `annual-return-reminder:%` would list every manual and automated reminder for the case. It would not point at the click whose response was lost.

## Options

### Recommended: command UUID on the existing unique key

Before the POST, the page mints one UUID and stores it in `sessionStorage` under the actor, case, and recipient snapshot, the same way the portal upload journal stores `uploadRequestId` before `createDocumentUploadIntent`. The server uses:

`annual-return-reminder:{caseId}:{commandUuid}`

as `notification_outbox.idempotency_key`. No new column: the unique key is the identity. `parseAnnualReturnReminderKey` splits on `:` and reads the case id from the second field. The third field is a milestone only when it is one of the automated milestone tokens; a command UUID falls through as `milestone: null`, which is already how today's manual phone field is treated. The failed-reminder reconciler still receives the case id.

A staff GET, authorized with the same `record_reminder` case check as the queue, takes `caseId` and `commandUuid` and reads that one outbox row. Return only a closed state: `absent`, `queued` (pending/processing), `sent`, `failed`, `unknown` (including `dispatch_outcome_unknown` and a non-null `dispatch_started_attempt`), or `redacted` when the key exists and `payload` is null. Include `messageId` only while the payload still has it. `absent` means this command did not commit. Any other state means do not POST again.

On `idempotentReplay`, return the existing message and do not call `recordReminder`. That matches follow-up send. The outer `sql.begin` stays the atomicity boundary: a visible outbox row for this command means the log and counter increment committed with it. A future caller that splits the two repositories onto root clients would break that reading; keep the single transaction.

A deliberate second reminder is a new UUID, created only after the staff member has seen the first command's receipt and chooses to send again. The counter stops being the idempotency input. The phone stays a contact check and a message field. It stops being part of the command identity, which removes the current split between digit-equal numbers that differ by a leading `+`.

Tradeoff: this changes the key shape for new manual sends. Historical `annual-return-reminder:{caseId}:{phone}:{remindersSent}` rows stay unique and are not rewritten. The client must persist the UUID before the POST; a click that never stored one is still the old lost-response case. `sessionStorage` is per tab. Two tabs that mint two UUIDs are two commands.

### Minimal: read back the key the server already derives

Snapshot `caseId`, the exact phone string submitted, and `remindersSent` from the case on screen. Persist that triple. Add a GET that recomputes today's key and reads `notification_outbox` by it.

Tradeoff: the triple is only right when the server's pre-increment counter equals the snapshot. Another commit between the case read and this POST makes the server write a different key. The client then looks up the old key, sees `absent`, and a retry can queue a second message. The GET also keeps the phone inside the handle. It does not fix replay double-logging unless the replay skip is added too. Use this only if a command UUID is refused. It is a weaker handle for the same lost response.

### Deferred

Leave the button as it is. After an error, staff are told not to click again until someone inspects `notification_outbox` and the case timeline. Ship no latch.

Tradeoff: the product keeps a one-click path that can queue a second WhatsApp after a lost success, and a concurrent double-click that can double-count one message. The archive the staff member would inspect is not linked from this screen. Defer only if Willy wants no protocol change in the next implementation slice. Do not fill the gap with a UI-only latch.

## Non-goals

- No claim that a queued row was delivered by WOZTELL. `dispatch_started_attempt` and `dispatch_outcome_unknown` stay human outcomes.
- No change to the follow-up `%` delivery filter, the automated milestone key, or `recordAnnualReturnReminder`.
- No new table, and no `reminder_logs` column, in the recommended slice. The outbox key is the receipt. The log is coupled by the existing outer transaction plus the replay skip.
- No client retry of the POST from the GET. The GET publishes state. A new send is a new explicit click with a new UUID.
- No cross-tab lock. No BroadcastChannel was found, and no duplicate-open defect was reproduced.

## Native boundary

The design document itself is the only artifact of this pass. A later implementation can unit-test key shape, replay skip, and the GET's closed states with mocked repositories, the same way other server functions are tested. That work still does not show a real second click leaving a single outbox row, a redacted row refusing a resend, or an authorized staff member reading only their case. Those remain Native. Do not mark them PASS from this review.
