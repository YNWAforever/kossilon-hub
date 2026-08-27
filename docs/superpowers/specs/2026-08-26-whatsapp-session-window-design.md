# P2-3: WhatsApp 24-hour session window handling — design

**Status:** Approved
**Date:** 2026-08-26
**Roadmap item:** P2-3 (`01-Kossilon-Hub-Roadmap-P0-P3.md:102`).

Every file:line reference below was independently verified against the working tree before this spec was committed.

## Problem

WhatsApp permits free-form text only within 24 hours of a contact's last inbound message. Outside that window an approved template is required. This codebase makes the TEXT-vs-TEMPLATE choice on an input unrelated to that rule.

`woztellResponseElement` (`src/features/whatsapp/woztell.ts:67-81`) branches purely on whether the caller supplied a `templateName`; its own comment names P2-3 as the missing piece. The result is a bug in **both** directions.

**Outside the window, free-form is sent.** Two sweeps enqueue a composed body with no template fields:
- `evaluateReminders` (`src/features/annual-return/repository.ts:1967-1978`, P1-2)
- `evaluateReminders` (`src/features/service-subscriptions/repository.ts:359-375`, P1-8 — same function name)

Both reach the WOZTELL transport (`src/features/notifications/dispatcher.ts:100-128`), which reads `payload.templateName` as `undefined` and emits `type: "TEXT"`. WhatsApp rejects it. The dispatcher then retries the **identical** payload up to `max_attempts` (default 5, `src/server/db/schema.sql:381-413`) at +0s/+60s/+120s/+240s/+480s (`src/features/notifications/outbox.ts:56-63`) before marking it `failed`. This fails for exactly the clients who have gone quiet — the population that most needs chasing.

**Inside the window, a bare template is sent.** Three staff/automation call sites always supply a `templateName` — manual reminder (`src/features/annual-return/whatsapp-reminders.ts:105`), follow-up automation (`src/features/annual-return/follow-up-server-fns.ts:122`), generic staff send (`src/features/whatsapp/server-fns.ts:242-271`) — all funnelling into `queueOutboundTemplateMessage`. On the TEMPLATE branch `input.body` is **not sent on the wire** (`woztell.ts:72-77`). An actively-engaged client receives a generic template while their composed, case-specific Traditional Chinese reminder is discarded.

**Producer levels.** There are five origination call sites but only **three** outbox producers of whatsapp-channel rows: the two sweeps, plus `queueOutboundTemplateMessage` (`src/features/whatsapp/repository.ts:1027-1041`), which the three staff paths share and which emits one notification type for all of them.

## Phone identity — the prerequisite

The window can only be resolved by matching the outbox row's `recipient` to a contact. **Three mutually incompatible formats are in play today**, so exact string equality resolves nothing:

| Source | Format | Evidence |
|---|---|---|
| Inbound-created contacts | bare digits, no `+` — `"85260903521"` | WOZTELL's `from` is unprefixed (`src/features/whatsapp/woztell-fixtures.ts:15`, copied verbatim from WOZTELL's docs); `normalizePhone` only *preserves* a leading `+`, never adds one (`woztell.ts:226-236`) |
| Sweep recipients | raw, spaces retained — `"+852 6090 3521"` | `src/features/annual-return/repository.ts:1946` passes `contact.phone` verbatim; `company_contacts.phone` is `z.string().min(3)` with no transform (`src/features/clients/server-fns.ts:74`), and the house convention is spaced (`src/lib/mock-data.ts:443-450`) |
| Staff recipients | `+` retained, spaces stripped — `"+85260903521"` | `src/features/whatsapp/repository.ts:934` |

`whatsapp_contacts.phone_e164` is **not** E.164 despite its name: `src/server/db/schema.sql:902-917` declares it plain `text` with no format CHECK, and its only writers are the two divergent `normalizePhone` copies (`woztell.ts:226-236` and `repository.ts:300-310`).

Left unaddressed, the resolver would return `null` for every real notification, `isWithinSessionWindow(null)` would return `false`, and **every send would become a template permanently** — while the feature appeared to work, because `null` is a legitimate, silently-handled outcome.

**Fix: canonicalise to digits-only on both sides.** Digits-only is the one representation all three formats already agree on, and is what the wire already uses (`woztell.ts:38`).

A new shared pure module `src/features/whatsapp/phone.ts`:

```ts
export function toPhoneDigits(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}
```

The two existing `normalizePhone` copies are left in place — collapsing them changes stored values and is a separate migration. `toPhoneDigits` is used only for *comparison*, never for storage, so it introduces no write-path change.

## Window clock

`whatsapp_contacts.last_seen_at` cannot serve as the clock: its single write (`src/features/whatsapp/repository.ts:553`) is reached from both `recordInboundMessage` (`:692-696`) and `queueOutboundTemplateMessage` (`:935-940`), and the outbound call happens at *queue* time.

The source is `whatsapp_messages`, whose CHECK constraint `whatsapp_messages_inbound_received_at_check` (`src/server/db/schema.sql:971-973`) guarantees `received_at` is non-null for every inbound row.

```sql
-- lastInboundAtForPhoneDigits(phoneDigits)
select max(wm.received_at) as last_inbound_at
from whatsapp_messages wm
join whatsapp_contacts wc on wc.id = wm.contact_id
where regexp_replace(coalesce(wc.phone_e164, wc.whatsapp_id), '\D', '', 'g') = ${phoneDigits}
  and wm.direction = 'inbound'
```

`coalesce(phone_e164, whatsapp_id)` because inbound sets both from the same `from`, while staff-created contacts often have `whatsapp_id` null.

**This also tolerates the duplicate-contact problem.** Because the unique index is on the literal string (`schema.sql:924-926`), a staff-created `"+85291234567"` and an inbound-created `"85291234567"` are *distinct rows today*. Digits-only matching spans both and takes the `max` across them, which is the desired answer. The duplicate rows themselves are a real pre-existing data problem this design surfaces but does not fix — see out of scope.

Two indexes are required. Wrapping the predicate in a normalising expression makes the existing unique index unusable as an access path, so `whatsapp_contacts` would otherwise be sequentially scanned on every dispatch:

```sql
create index if not exists whatsapp_contacts_phone_digits_idx
  on whatsapp_contacts ((regexp_replace(coalesce(phone_e164, whatsapp_id), '\D', '', 'g')));

create index if not exists whatsapp_messages_inbound_received_idx
  on whatsapp_messages (contact_id, received_at desc)
  where direction = 'inbound';
```

`regexp_replace/4` and `coalesce` are both IMMUTABLE, so the expression index is legal. **The index expression must be written character-identically to the WHERE clause** or the planner will not use it.

Both statements go in **a new `db/migrations/0021_*.sql` AND appended to `src/server/db/schema.sql`** under a `-- from 0021_….sql` marker, per this repo's convention. This is called out because **no gate catches either omission**: `verify:firm` compares only `create table` names (`scripts/verify-firm-deployment.ts:232-242`), and CI applies only `db/migrations/`. A schema.sql-only change never reaches production; a migrations-only change drifts permanently. Both stay green either way.

**No contact, or a contact with no inbound message, resolves to `null` and is treated as outside the window** — fail-closed, correct for a genuinely unknown number.

## Where the decision is made

**In `dispatchDue`, not in the transport.** The transport is the wrong layer for three reasons:

1. **It has no clock.** `NotificationTransport.dispatch(notification)` takes only the record (`src/features/notifications/types.ts:48-50`). This pipeline deliberately threads an explicit `now` — cron passes the *intended* tick (`src/server.ts:82`), and the manual path's `now` was deliberately removed from caller control (`runtime-dispatch.ts:109-117`). A transport calling `new Date()` introduces a second clock inside one dispatch run.
2. **The plumbing is cheaper in the dispatcher.** `dispatchDueNotificationsWithDependencies` already constructs the `WhatsAppRepository` (`runtime-dispatch.ts:37`), already passes it to `createNotificationDispatcher` (`:47-49`), already closes it in a `finally` (`:52`), and `dispatchDue` already branches on `channel === "whatsapp"` (`dispatcher.ts:55-59`). Resolving in the transport instead would thread a new parameter through three layers, two of which discard it.
3. **Layering.** Every other transport is a pure record→HTTP mapper. Making WOZTELL the only one that opens a DB connection also makes the whole decision table unreachable in `local` and `simulated` provider modes.

This is still *dispatch* time rather than enqueue time, so the self-healing-on-retry property is preserved: a send rejected because the window closed re-resolves on the next attempt and goes out as a template.

## Components

**`src/features/whatsapp/session-window.ts`** — pure, zero imports:

```ts
export const WHATSAPP_SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isWithinSessionWindow(
  lastInboundAt: string | Date | null,
  now: string | Date,
): boolean;
```

`now` accepts `string | Date` because the pipeline's clock is ISO **text**, not a `Date`: `NotificationDispatcher.dispatchDue(now: string, …)` (`src/features/notifications/types.ts:85-87`), fed by `run({ now: new Date(scheduledTime).toISOString() })` (`src/server.ts:82`).

`null` returns `false`. The boundary is **exclusive**: a timestamp exactly `WHATSAPP_SESSION_WINDOW_MS` old is outside. No safety margin is added, because boundary error self-heals in the dangerous direction — if we say inside and Meta says outside, the send is rejected and the retry re-resolves past 24h and succeeds as a template (cost: one attempt, ~1 minute). If we say outside and Meta says inside, the client gets a template instead of the composed body: degraded, never failed. A margin would convert a self-healing delay in a razor-thin window into an *unconditional* loss of the composed body for every client landing in the last N minutes.

The comparison is inherently cross-clock and this is accepted: `received_at` derives from WOZTELL's epoch-seconds timestamp (`woztell.ts:196-224`, Meta's clock, second-truncated so it biases fail-closed), while `now` is ours and — being the cron's intended tick rather than actual execution time — biases fail-open under delivery drift. Both are bounded by seconds.

**`src/features/whatsapp/fallback-templates.ts`** — pure policy table. The registry is deliberately not read: `whatsapp_templates` has no Meta approval status (its `status` enum is a local draft/active/paused/archived lifecycle), no variable schema, is never SELECTed by application code, and `upsertTemplate` (`repository.ts:585-623`) hard-codes `status = 'active'` while its conflict branch copies `excluded.status`, silently resurrecting paused or archived rows. Reading it would launder the same guess through a table and add false authority. Code constants also match existing precedent (`whatsapp-reminders.ts:35`, `follow-up-server-fns.ts:75,82,88`).

```ts
export type FallbackTemplate = { templateName: string; languageCode: string };
export function fallbackTemplateFor(notificationType: string): FallbackTemplate | null;
```

The six exact notification-type literals the sweeps emit, named here so the table can be checked by inspection:

```
annual_return_reminder_1_month          service_subscription_reminder_1_month
annual_return_reminder_2_week           service_subscription_reminder_2_week
annual_return_reminder_1_week           service_subscription_reminder_1_week
```

(`src/features/annual-return/repository.ts:1970`, `src/features/service-subscriptions/repository.ts:362`. Milestones come from the shared `@/lib/reminder-cadence`.) Language is `zh_HK`, matching the Traditional Chinese copy P1-2 established. Note these types do **not** identify a channel — both sweeps write the same type on the email branch when a contact has no phone (`annual-return/repository.ts:1945`), so the table is consulted only from the WOZTELL transport and never used to infer a channel.

**`WoztellSendMode`** replaces the `templateName` inference. `toPhone` stays outside the union — it addresses the envelope's `recipientId` (`woztell.ts:38`), which is a sibling of `response`, not a member of it:

```ts
export type WoztellSendMode =
  | { kind: "text"; body: string }
  | { kind: "template"; elementName: string; languageCode: string; components: readonly WoztellTemplateComponent[] };

sendWoztellMessage(
  config: WhatsAppProviderConfig,
  input: { toPhone: string; mode: WoztellSendMode },
  fetchImpl?: typeof fetch,
)
```

`toWhatsAppId` is dropped from the type — it is declared (`woztell.ts:12`) and passed (`dispatcher.ts:116`) but read nowhere.

**`NotificationTransport.dispatch` gains an optional second argument** so `local`, `simulated`, and `resend` transports are untouched and simply ignore it:

```ts
export type NotificationDispatchContext = { whatsAppSendMode?: WoztellSendMode };
```

**The composite router must forward it.** `dispatchDue` never holds the WOZTELL transport directly — in live mode it holds the channel router built by `createNotificationTransport` (`src/features/notifications/dispatcher.ts:147-160`), whose `dispatch(notification)` forwards to `whatsappTransport.dispatch(notification)` at `:149`. That signature must also gain and forward `context`, or the resolved mode is dropped and **every live WhatsApp send throws**. The email branch ignores it.

`dispatchDue` resolves the mode for whatsapp-channel rows using its existing `now` and `whatsAppRepository`, then passes it. Decision table:

| Window state | `payload.templateName` | Sent |
|---|---|---|
| Inside | supplied | `TEXT` with the composed body |
| Inside | absent | `TEXT` with the composed body |
| Outside | supplied | `TEMPLATE` using the supplied name |
| Outside | absent, fallback maps | `TEMPLATE` using `fallbackTemplateFor(notificationType)` |
| Outside | absent, no fallback maps | throws with an explicit code |

Two further states, both previously unspecified:

- **No `whatsAppRepository` available.** It is optional on the dependency type (`runtime-dispatch.ts:28`, invoked `?.()` at `:37`), so live mode can legitimately have none. The WOZTELL transport **throws** when it receives no `whatsAppSendMode` — a mis-wired deployment fails loudly rather than silently reverting to today's behaviour.
- **`local` and `simulated` modes must not resolve at all.** `runtime-dispatch.ts:67` constructs the WhatsApp repository *unconditionally* for every provider mode — unlike `config`/`resendConfig`, which are already gated on `providerMode === "live"` (`runtime-dispatch.ts:40-41`). Left ungated, the resolver would run a DB query for every whatsapp row in local and simulated mode, and a transient DB error would burn a retry attempt on sends that previously always succeeded. **The resolver is therefore gated the same way `config` already is**: supplied to the dispatcher only in live mode, and `dispatchDue` resolves only when it is present. Local and simulated behaviour is then byte-identical to today.
- **The lookup throws** (transient DB error). It propagates into the dispatcher's existing catch (`dispatcher.ts:72-93`) and burns one attempt, which then retries and self-heals. This is deliberately preferred over degrading to a template: the composed body survives a ~1-minute delay rather than being silently replaced.

## Observability

The dispatcher's catch currently writes `last_error_code`/`last_error_message` but emits **no log line**. A permanently-unapproved fallback template would therefore surface only as an aggregate `permanentlyFailed: 1` in `console.log("scheduled maintenance", …)` (`src/server.ts:83`), with no type, recipient, or error code — and `redactExpired` nulls both error columns at retention (`outbox.ts:337-345`), putting the evidence on a 90-day fuse.

This spec adds **one `console.error` in the dispatcher catch** carrying `notification.id`, `notificationType`, and the error code. Two lines, and it fixes diagnosability for every notification type, not just this feature. Without it the template-drift risk below is structurally unobservable.

Correction to a common assumption: one screen *does* read `notification_outbox` — `src/features/annual-return/follow-up-repository.ts:130-135` — but it filters `idempotency_key like 'follow-up:%'`, and sweep rows use the default key format (`outbox.ts:65-80`), so they fall outside it. Sweep failures remain invisible.

## Accepted limitations

- **The detailed body does not reach a gone-quiet client.** The re-engagement template asks them to reply, which reopens the window; but sweeps are milestone-gated to fire once per milestone, so a reminder sent as a template is not re-sent with detail after the reply — the next *milestone* carries detail, and staff have the manual path meanwhile. Because the fallbacks are no-variable, the re-engagement message also **cannot name the client or the case**. This is a deliberate product trade, not an oversight.
- **Real setup dependency:** the fallback templates must be approved in the WOZTELL/Meta dashboard. No gate can ever verify this — `verify:firm` is offline by construction and reports whatsapp as `blocked` (`verify-firm-deployment.ts:308`). The runbook entry must therefore list the **literal** template names and `zh_HK` as a checklist, since it is the only enforcement that exists.
- **A missing country code silently downgrades an engaged client.** The digits-only match is exact, so it closes the *format* mismatch (spaces, `+`) but not a *content* one. `company_contacts.phone` is unvalidated free text (`z.string().min(3)`, no transform), and nothing anywhere prepends a country code. A number stored locally as `"6090 3521"` yields digits `"60903521"`, which will never equal the `"85260903521"` an inbound-created contact carries — so the lookup returns `null`, the contact is treated as outside the window, and a client who messaged ten minutes ago receives a template with their composed body dropped. That is the inside-window half of the very bug this item exists to fix, surviving for one specific data shape.

  It fails *degraded* rather than broken — a template is still delivered — and every phone value currently in the codebase carries `+852`, so it is not evidenced today. Fixing it properly means normalising `company_contacts.phone` at the write boundary, which is a separate data migration with its own backfill; matching on trailing digits instead would trade this false negative for false positives across country codes, which is worse for a compliance record. Accepted here, and worth revisiting if the firm ever stores local-format numbers.

- **A never-satisfiable send burns five attempts** — ~15 minutes of cron ticks. The throw happens before the `fetch`, so it costs no provider traffic and no rate limit. Wiring a non-retryable path (the pattern exists at `documents/repository.ts:339-346`) is cheap but deferred; the invisibility above was the real gap and is fixed.
- **Considered and rejected: let the provider be the oracle** — send TEXT, and on a re-engagement error code re-send as a template. This would delete the migration, both indexes, the resolver, and the entire clock-skew question, and it is more correct on authority (our `whatsapp_messages` replica is lossy by its own documentation at `woztell.ts:360-373`, and every gap makes it say "closed" when WhatsApp says "open"). It is rejected because this codebase has twice been burned guessing WOZTELL's response shape (`woztell.ts:30-31`, `:44-47`), and whether WOZTELL surfaces Meta's 131047 verbatim, remaps it, or swallows it is not knowable without a live send. Revisit once a live send confirms the code.

## Explicitly out of scope

- Template registry management and Meta approval status — P2-2, needs the WOZTELL Open API (P3-3).
- Populating `templateComponents`. Plumbed end-to-end but populated by no producer, so every template ships `components: []`. The fallbacks are no-variable by design, so this stays true.
- **Duplicate contact rows** from the format split. Merging them requires repointing messages and deleting the loser (a plain UPDATE violates `whatsapp_contacts_provider_phone_uidx`). The digits-only read tolerates them; fixing the data is separate.
- Collapsing the two divergent `normalizePhone` copies, and the third normalisation rule in the idempotency key (`whatsapp-reminders.ts:57` strips whitespace only, so `"+852-9123-4567"` and `"+852 9123 4567"` key differently for the same person).
- Making sweep-originated sends visible in the inbox — they create no `whatsapp_messages` row, so no contact, no `template_id`, no receipt linkback (`dispatcher.ts:54-59`). P2-1 territory.
- The `upsertTemplate` status-resurrect bug.

## Verification plan

- Pure unit tests for `toPhoneDigits`, `isWithinSessionWindow` (null, just inside, exactly at the boundary, just outside), and `fallbackTemplateFor` (all six literals plus an unmapped type).
- `dispatchDue` tests covering all seven states in the decision table including the two added ones, asserting the exact `WoztellSendMode` handed to the transport.
- **A real-format end-to-end test, not self-consistent fixtures.** Insert a contact via `recordInboundMessage` using an *unmodified* WOZTELL fixture (bare digits), insert a `company_contacts.phone` in the house spaced `"+852 …"` format for the same person, and assert the resolver returns the inbound timestamp. Note that the existing `src/features/whatsapp/repository.test.ts` inbound test uses `from: "+85261234567"` — a `+`-prefixed value **WOZTELL never sends** — chosen so its own `phone_e164` assertion would be meaningful. That test would actively mask this bug, in tension with `woztell-fixtures.ts:5-8` ("if a fixture and the code disagree, the code is wrong"). It must be corrected to a real fixture format.
- Repository integration test for the resolver behind `describe.skipIf(!databaseUrl)` against a real local Postgres: ignores outbound rows, ignores other contacts, spans duplicate contact rows, returns `null` for an unknown phone. A green local run with `TEST_DATABASE_URL` unset is treated as inconclusive.
- **The full regression surface, verified against this working tree:**
  - `woztell.test.ts` has **five** `sendWoztellMessage` call sites needing the new mode (`:172`, `:190`, `:221`, `:234`, `:252`), not two. The byte-exact wire assertions are at `:176-180` (TEXT) and `:201-208` (TEMPLATE) — not the `it()` declaration lines.
  - `dispatcher.test.ts:200-222` and `:245-279` dispatch live-mode WhatsApp through the composite router with no second argument (the dispatches are at `:218-220` and `:274-278`). They break on the **no-send-mode** throw, not the no-fallback one, so changing their payload shape does not help — they must pass a `WoztellSendMode` context.
  - `dispatcher.test.ts:143`, `:159`, `:177` pass `{ whatsAppRepository: { attachProviderMessageId } }` object literals and become type errors the moment the `Pick` widens.
  - `runtime-dispatch.test.ts:110-114` asserts an **exact** object match on the `createTransport` call and breaks on any added key (`:145-147` and `:180-184` use `objectContaining` and survive).
- Full suite green, `npm run verify:firm -- --dry-run` PASS, and CI's `verify` job confirmed `SUCCESS` via `gh pr view <n> --json statusCheckRollup` before the item is treated as done.
