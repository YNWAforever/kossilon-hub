# P2-3: WhatsApp Session Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Choose TEXT vs TEMPLATE on WhatsApp's actual rule — whether the contact messaged us within 24 hours — instead of on whether the caller happened to pass a template name.

**Architecture:** Three pure modules (digits-only phone comparison, window arithmetic, fallback-template policy) plus one indexed repository read. The decision is made in `dispatchDue`, which already owns the clock and the WhatsApp repository, and is handed to the transport as an already-resolved `WoztellSendMode` through a new optional second argument on `NotificationTransport.dispatch`.

**Tech Stack:** TanStack Start, Postgres via `postgres.js` raw SQL (no ORM), TypeScript strict, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-26-whatsapp-session-window-design.md`

**Branch:** `codex/whatsapp-session-window` (already checked out, branched from `main`).

---

## Deviation from the spec, decided during planning

The spec says to widen `NotificationDispatcherOptions.whatsAppRepository`'s `Pick` to include the new method. **This plan injects a narrow `LastInboundResolver` function instead.** Same intent, three concrete advantages: the live-mode gate the spec requires becomes a one-line conditional at the injection site; `dispatcher.test.ts:143`, `:159`, `:177` (which pass `{ whatsAppRepository: { attachProviderMessageId } }` literals) keep compiling; and the dispatcher stays decoupled from the repository's shape.

## Line-number warning

This branch does **not** contain the P0-11 audit-trail work, and `src/features/annual-return/repository.ts` is ~55 lines shorter here than in trees that do. Every line number below was read from this branch. Still locate anchors by surrounding text and re-read before editing.

## File structure

| File | Responsibility |
|---|---|
| `src/features/whatsapp/phone.ts` *(new)* | Digits-only canonicalisation, for comparison only |
| `src/features/whatsapp/session-window.ts` *(new)* | 24-hour window arithmetic, pure |
| `src/features/whatsapp/fallback-templates.ts` *(new)* | Notification-type → re-engagement template policy |
| `db/migrations/0021_whatsapp_session_window_indexes.sql` *(new)* | Two indexes supporting the resolver |
| `src/server/db/schema.sql` | Same two indexes, appended under a marker |
| `src/features/whatsapp/repository.ts` | `lastInboundAtForPhoneDigits` |
| `src/features/whatsapp/woztell.ts` | `WoztellSendMode` replaces the templateName inference |
| `src/features/notifications/types.ts` | `NotificationDispatchContext`, `LastInboundResolver`, widened `dispatch` |
| `src/features/notifications/dispatcher.ts` | Resolution in `dispatchDue`; transport + composite router forward context; error logging |
| `src/features/notifications/runtime-dispatch.ts` | Live-mode-gated resolver injection |
| `docs/runbooks/firm-deployment.md` | The template-approval checklist |

---

### Task 1: Digits-only phone comparison helper

**Files:**
- Create: `src/features/whatsapp/phone.ts`
- Create: `src/features/whatsapp/phone.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/features/whatsapp/phone.test.ts
import { describe, expect, it } from "vitest";
import { toPhoneDigits } from "./phone";

describe("toPhoneDigits", () => {
  it("strips the spaces a sweep recipient carries", () => {
    expect(toPhoneDigits("+852 6090 3521")).toBe("85260903521");
  });

  it("leaves WOZTELL's bare-digit inbound format unchanged", () => {
    expect(toPhoneDigits("85260903521")).toBe("85260903521");
  });

  it("strips the plus a staff-entered number carries", () => {
    expect(toPhoneDigits("+85260903521")).toBe("85260903521");
  });

  it("collapses all three real formats to the same value", () => {
    expect(toPhoneDigits("+852 6090 3521")).toBe(toPhoneDigits("85260903521"));
    expect(toPhoneDigits("+85260903521")).toBe(toPhoneDigits("85260903521"));
  });

  it("strips dashes and parentheses", () => {
    expect(toPhoneDigits("+852-6090-3521")).toBe("85260903521");
    expect(toPhoneDigits("(852) 6090 3521")).toBe("85260903521");
  });

  it("returns null for values with no digits at all", () => {
    expect(toPhoneDigits(null)).toBeNull();
    expect(toPhoneDigits(undefined)).toBeNull();
    expect(toPhoneDigits("")).toBeNull();
    expect(toPhoneDigits("   ")).toBeNull();
    expect(toPhoneDigits("+")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/whatsapp/phone.test.ts`
Expected: FAIL with "Cannot find module './phone'".

- [ ] **Step 3: Write the implementation**

```ts
// src/features/whatsapp/phone.ts

/**
 * Digits-only canonicalisation, used ONLY to compare phone numbers that were
 * written by different normalizers. Three mutually incompatible formats exist:
 *
 *   inbound-created contacts   "85260903521"      (WOZTELL's `from` is bare digits,
 *                                                  and normalizePhone only preserves
 *                                                  a leading "+", never adds one)
 *   sweep recipients           "+852 6090 3521"   (raw company_contacts.phone)
 *   staff sends                "+85260903521"     (normalizePhone with a typed "+")
 *
 * Digits-only is the one representation all three agree on, and is already what
 * goes on the wire as WOZTELL's `recipientId`.
 *
 * This is a COMPARISON helper, never a storage format. It does not replace either
 * normalizePhone copy (woztell.ts, repository.ts) and no write path uses it.
 */
export function toPhoneDigits(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length > 0 ? digits : null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/whatsapp/phone.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/whatsapp/phone.ts src/features/whatsapp/phone.test.ts
git commit -m "feat: add digits-only phone comparison helper"
```

---

### Task 2: Session window arithmetic

**Files:**
- Create: `src/features/whatsapp/session-window.ts`
- Create: `src/features/whatsapp/session-window.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/features/whatsapp/session-window.test.ts
import { describe, expect, it } from "vitest";
import { WHATSAPP_SESSION_WINDOW_MS, isWithinSessionWindow } from "./session-window";

const now = "2026-08-26T12:00:00.000Z";
const nowMs = Date.parse(now);

function isoAgo(ms: number): string {
  return new Date(nowMs - ms).toISOString();
}

describe("isWithinSessionWindow", () => {
  it("treats a contact who has never messaged us as outside the window", () => {
    expect(isWithinSessionWindow(null, now)).toBe(false);
  });

  it("treats a message from one minute ago as inside", () => {
    expect(isWithinSessionWindow(isoAgo(60_000), now)).toBe(true);
  });

  it("treats a message just under 24 hours old as inside", () => {
    expect(isWithinSessionWindow(isoAgo(WHATSAPP_SESSION_WINDOW_MS - 1000), now)).toBe(true);
  });

  it("treats a message exactly 24 hours old as OUTSIDE (exclusive boundary)", () => {
    expect(isWithinSessionWindow(isoAgo(WHATSAPP_SESSION_WINDOW_MS), now)).toBe(false);
  });

  it("treats a message just over 24 hours old as outside", () => {
    expect(isWithinSessionWindow(isoAgo(WHATSAPP_SESSION_WINDOW_MS + 1000), now)).toBe(false);
  });

  it("accepts Date objects on both sides", () => {
    expect(isWithinSessionWindow(new Date(nowMs - 60_000), new Date(nowMs))).toBe(true);
  });

  it("fails closed on an unparseable timestamp", () => {
    expect(isWithinSessionWindow("not a date", now)).toBe(false);
    expect(isWithinSessionWindow(isoAgo(60_000), "not a date")).toBe(false);
  });

  it("exports 24 hours in milliseconds", () => {
    expect(WHATSAPP_SESSION_WINDOW_MS).toBe(86_400_000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/whatsapp/session-window.test.ts`
Expected: FAIL with "Cannot find module './session-window'".

- [ ] **Step 3: Write the implementation**

```ts
// src/features/whatsapp/session-window.ts

/** WhatsApp allows free-form text only within 24 hours of the contact's last inbound message. */
export const WHATSAPP_SESSION_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * `now` accepts a string because this pipeline's clock is ISO text, not a Date:
 * NotificationDispatcher.dispatchDue(now: string) (notifications/types.ts) is fed
 * `new Date(scheduledTime).toISOString()` by the cron (src/server.ts).
 *
 * The boundary is EXCLUSIVE — exactly WHATSAPP_SESSION_WINDOW_MS old is outside —
 * and no safety margin is applied, because boundary error self-heals in the
 * dangerous direction. Guessing "inside" costs one rejected attempt that then
 * retries as a template; guessing "outside" only downgrades to a template. A
 * margin would convert that self-healing delay into an unconditional loss of the
 * composed body for every client landing in the last N minutes.
 *
 * The comparison is inherently cross-clock and that is accepted: lastInboundAt
 * derives from WOZTELL's epoch-seconds timestamp (Meta's clock, second-truncated,
 * biasing fail-closed), while `now` is the cron's intended tick (ours, biasing
 * fail-open under delivery drift). Both are bounded by seconds.
 *
 * Anything unparseable fails closed — a template is always deliverable, free-form
 * outside the window is not.
 */
export function isWithinSessionWindow(
  lastInboundAt: string | Date | null,
  now: string | Date,
): boolean {
  if (lastInboundAt === null) return false;

  const last = new Date(lastInboundAt).getTime();
  const current = new Date(now).getTime();
  if (Number.isNaN(last) || Number.isNaN(current)) return false;

  return current - last < WHATSAPP_SESSION_WINDOW_MS;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/whatsapp/session-window.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/whatsapp/session-window.ts src/features/whatsapp/session-window.test.ts
git commit -m "feat: add WhatsApp 24-hour session window arithmetic"
```

---

### Task 3: Fallback template policy

**Files:**
- Create: `src/features/whatsapp/fallback-templates.ts`
- Create: `src/features/whatsapp/fallback-templates.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/features/whatsapp/fallback-templates.test.ts
import { describe, expect, it } from "vitest";
import { fallbackTemplateFor } from "./fallback-templates";

describe("fallbackTemplateFor", () => {
  it.each([
    "annual_return_reminder_1_month",
    "annual_return_reminder_2_week",
    "annual_return_reminder_1_week",
  ])("maps the annual-return sweep type %s", (notificationType) => {
    expect(fallbackTemplateFor(notificationType)).toEqual({
      templateName: "annual_return_reengagement",
      languageCode: "zh_HK",
    });
  });

  it.each([
    "service_subscription_reminder_1_month",
    "service_subscription_reminder_2_week",
    "service_subscription_reminder_1_week",
  ])("maps the service-subscription sweep type %s", (notificationType) => {
    expect(fallbackTemplateFor(notificationType)).toEqual({
      templateName: "service_subscription_reengagement",
      languageCode: "zh_HK",
    });
  });

  it("returns null for a type with no mapped fallback", () => {
    expect(fallbackTemplateFor("whatsapp_template")).toBeNull();
    expect(fallbackTemplateFor("test")).toBeNull();
    expect(fallbackTemplateFor("")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/whatsapp/fallback-templates.test.ts`
Expected: FAIL with "Cannot find module './fallback-templates'".

- [ ] **Step 3: Write the implementation**

```ts
// src/features/whatsapp/fallback-templates.ts

export type FallbackTemplate = { templateName: string; languageCode: string };

/**
 * Approved, no-variable re-engagement templates — one per sweep family. Sent when a
 * reminder is due but the contact is outside the 24-hour window, where WhatsApp
 * forbids free-form text. They ask the client to reply, which reopens the window.
 *
 * Deliberately code constants rather than rows in whatsapp_templates: that table
 * has no Meta approval status, no variable schema, is never SELECTed by any
 * application code, and its upsertTemplate resurrects paused/archived rows. Reading
 * it would launder the same guess through a table and add false authority. Template
 * names are already constants elsewhere (whatsapp-reminders.ts,
 * follow-up-server-fns.ts).
 *
 * Matched by prefix because each sweep emits one type per milestone. The full set
 * of six literals is enumerated in the tests.
 *
 * SETUP DEPENDENCY: both template names must be approved in the WOZTELL/Meta
 * dashboard, in zh_HK. Nothing in this repo can verify that — verify:firm is
 * offline by construction. See docs/runbooks/firm-deployment.md.
 */
const FALLBACK_TEMPLATES: ReadonlyArray<{ prefix: string } & FallbackTemplate> = [
  {
    prefix: "annual_return_reminder_",
    templateName: "annual_return_reengagement",
    languageCode: "zh_HK",
  },
  {
    prefix: "service_subscription_reminder_",
    templateName: "service_subscription_reengagement",
    languageCode: "zh_HK",
  },
];

/**
 * Note these notification types do NOT identify a channel — both sweeps write the
 * same type for an email-channel row when the contact has no phone. This table is
 * consulted only from the WhatsApp send path.
 */
export function fallbackTemplateFor(notificationType: string): FallbackTemplate | null {
  const match = FALLBACK_TEMPLATES.find((entry) => notificationType.startsWith(entry.prefix));
  if (!match) return null;
  return { templateName: match.templateName, languageCode: match.languageCode };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/whatsapp/fallback-templates.test.ts`
Expected: PASS (7 tests — 3 + 3 from the two `it.each` tables, plus 1 with three assertions).

- [ ] **Step 5: Commit**

```bash
git add src/features/whatsapp/fallback-templates.ts src/features/whatsapp/fallback-templates.test.ts
git commit -m "feat: add WhatsApp re-engagement fallback template policy"
```

---

### Task 4: Migration and schema for the resolver indexes

**Files:**
- Create: `db/migrations/0021_whatsapp_session_window_indexes.sql`
- Modify: `src/server/db/schema.sql` (append at end of file)

Both are required. Neither omission is caught by any gate: `verify:firm` compares only `create table` names, and CI applies only `db/migrations/`. A schema.sql-only change never reaches production; a migrations-only change drifts permanently.

- [ ] **Step 1: Create the migration**

`db/migrations/0021_whatsapp_session_window_indexes.sql`:

```sql
-- 0021: indexes supporting WhatsApp 24-hour session window resolution (P2-3).
--
-- The window is resolved by matching a notification's recipient against the contact
-- that last messaged us. The two sides are written by different normalizers and are
-- stored in three mutually incompatible formats: WOZTELL's inbound `from` is bare
-- digits, sweep recipients are raw company_contacts.phone with spaces, and staff
-- sends are plus-prefixed. The comparison is therefore digits-only.
--
-- Wrapping the predicate in a normalising expression makes
-- whatsapp_contacts_provider_phone_uidx unusable as an access path, so without the
-- first index below every dispatch sequentially scans whatsapp_contacts.
--
-- regexp_replace/4 and coalesce are both IMMUTABLE, so the expression index is legal.
-- The expression MUST stay character-identical to the one in
-- lastInboundAtForPhoneDigits (src/features/whatsapp/repository.ts) or the planner
-- will not use this index.

create index if not exists whatsapp_contacts_phone_digits_idx
  on whatsapp_contacts ((regexp_replace(coalesce(phone_e164, whatsapp_id), '[^0-9]', '', 'g')));

create index if not exists whatsapp_messages_inbound_received_idx
  on whatsapp_messages (contact_id, received_at desc)
  where direction = 'inbound';
```

- [ ] **Step 2: Append the same statements to `schema.sql`**

Append to the very end of `src/server/db/schema.sql`, following the existing `-- from 000N_….sql` marker convention (see the markers at `schema.sql:1011`, `:1039`, `:1045`, `:1054`):

```sql

-- from 0021_whatsapp_session_window_indexes.sql
-- Digits-only comparison indexes for 24-hour session window resolution. The
-- contacts expression must stay character-identical to the query in
-- lastInboundAtForPhoneDigits or the planner will not use it.
create index if not exists whatsapp_contacts_phone_digits_idx
  on whatsapp_contacts ((regexp_replace(coalesce(phone_e164, whatsapp_id), '[^0-9]', '', 'g')));

create index if not exists whatsapp_messages_inbound_received_idx
  on whatsapp_messages (contact_id, received_at desc)
  where direction = 'inbound';
```

- [ ] **Step 3: Verify the migration applies against a real database**

```bash
docker run -d --name kossilon-test-pg -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=kossilon_test -p 5432:5432 postgres:17-alpine
DATABASE_URL=postgres://postgres:postgres@localhost:5432/kossilon_test DATABASE_SSL=false bun scripts/db-migrate.ts
```
Expected: all 21 migrations apply, including `0021_whatsapp_session_window_indexes.sql`.

- [ ] **Step 4: Confirm both indexes exist**

`psql`'s `\di` takes only ONE pattern — a two-argument form silently ignores the second and would report success even if that index was never created. Query `pg_indexes` instead, which also shows the materialized definition so you can confirm the expression index was accepted:

```bash
docker exec kossilon-test-pg psql -U postgres -d kossilon_test -c "select indexname, indexdef from pg_indexes where indexname in ('whatsapp_contacts_phone_digits_idx','whatsapp_messages_inbound_received_idx');"
```
Expected: **two** rows. The contacts index should be a btree over `regexp_replace(COALESCE(phone_e164, whatsapp_id), '[^0-9]'::text, ''::text, 'g'::text)`; the messages index `(contact_id, received_at DESC) WHERE (direction = 'inbound'::text)`.

Note on idempotency: re-running `bun scripts/db-migrate.ts` proves nothing, because the script keeps a `schema_migrations` ledger and simply skips applied files. To exercise the SQL itself, delete the `0021` ledger row and re-run, or apply the statements directly with `psql -v ON_ERROR_STOP=1`.

Tear the container down (`docker rm -f kossilon-test-pg`) — Task 5 runs as a separate process and creates its own.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/0021_whatsapp_session_window_indexes.sql src/server/db/schema.sql
git commit -m "feat: add digits-only phone indexes for session window resolution"
```

---

### Task 5: `lastInboundAtForPhoneDigits` repository read

**Files:**
- Modify: `src/features/whatsapp/repository.ts`
- Modify: `src/features/whatsapp/repository.test.ts`

- [ ] **Step 1: Add the method to the `WhatsAppRepository` type**

In `src/features/whatsapp/repository.ts`, the type starts at `:149`. Add this member immediately before `close(): Promise<void>;` (`:169`):

```ts
  lastInboundAtForPhoneDigits(phoneDigits: string): Promise<string | null>;
```

- [ ] **Step 2: Implement it**

Add this function inside `createWhatsAppRepository`, immediately before the returned object literal (which starts around `:1278`):

```ts
  /**
   * The 24-hour session window clock. whatsapp_contacts.last_seen_at cannot serve
   * here: its single write is reached from both recordInboundMessage AND
   * queueOutboundTemplateMessage, and the outbound one fires at queue time.
   *
   * Matched digits-only because the two sides are stored in three incompatible
   * formats (see phone.ts). This also spans the duplicate contact rows the format
   * split has already created — a staff-created "+85291234567" and an
   * inbound-created "85291234567" are distinct rows under
   * whatsapp_contacts_provider_phone_uidx, and max() across both is the answer we
   * want.
   *
   * The regexp_replace expression must stay character-identical to
   * whatsapp_contacts_phone_digits_idx (migration 0021) or the planner will not
   * use the index.
   */
  async function lastInboundAtForPhoneDigits(phoneDigits: string): Promise<string | null> {
    // An empty string would match EVERY contact whose phone_e164 and whatsapp_id
    // are both digitless — coalesce(...) yields '' for those — and max() would then
    // return an unrelated contact's timestamp, silently opening the window for the
    // wrong person. toPhoneDigits returns null rather than "" precisely so callers
    // can avoid this, but the type signature cannot enforce it.
    if (phoneDigits === "") return null;

    const rows = await sql<{ last_inbound_at: string | Date | null }[]>`
      select max(wm.received_at) as last_inbound_at
      from whatsapp_messages wm
      join whatsapp_contacts wc on wc.id = wm.contact_id
      where regexp_replace(coalesce(wc.phone_e164, wc.whatsapp_id), '[^0-9]', '', 'g') = ${phoneDigits}
        and wm.direction = 'inbound'
    `;

    const value = rows[0]?.last_inbound_at ?? null;
    if (value === null) return null;
    return typeof value === "string" ? value : value.toISOString();
  }
```

- [ ] **Step 3: Add it to the returned object**

In the object literal returned by `createWhatsAppRepository`, add immediately after `attachProviderMessageId,` (`:1284`):

```ts
    lastInboundAtForPhoneDigits,
```

- [ ] **Step 4: Write the integration test with REAL producer formats**

This is the test that matters. Fixtures that agree with each other by construction would pass while the feature is inert in production — so it must use WOZTELL's real bare-digit format on one side and the firm's real spaced format on the other.

Add inside the existing `describe.skipIf(!databaseUrl)` block in `src/features/whatsapp/repository.test.ts`, reusing that block's existing fixture helpers:

```ts
  it(
    "resolves the last inbound timestamp across real-world phone formats",
    async () => {
      const repository = repositoryFor();
      // WOZTELL's documented inbound `from` is bare digits with no plus.
      const inboundFrom = "85260903521";
      const receivedAt = "2026-08-26T02:00:00.000Z";

      await repository.recordInboundMessage({
        provider: "woztell",
        providerMessageId: `test-window-${inboundFrom}`,
        channelId: null,
        fromWhatsAppId: inboundFrom,
        fromPhone: inboundFrom,
        contactName: "Window Test",
        messageType: "text",
        body: "Hello",
        receivedAt,
        rawPayload: {},
      });

      // The sweeps enqueue company_contacts.phone verbatim, and the firm's house
      // format is spaced. Exact string equality against phone_e164 would miss.
      const sweepRecipient = "+852 6090 3521";
      const resolved = await repository.lastInboundAtForPhoneDigits(
        sweepRecipient.replace(/\D/g, ""),
      );

      expect(resolved).not.toBeNull();
      expect(new Date(resolved!).toISOString()).toBe(receivedAt);
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "returns null for a number that has never messaged us",
    async () => {
      const repository = repositoryFor();
      expect(await repository.lastInboundAtForPhoneDigits("85299999999")).toBeNull();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );

  it(
    "returns null for an empty digit string rather than matching digitless contacts",
    async () => {
      const repository = repositoryFor();
      expect(await repository.lastInboundAtForPhoneDigits("")).toBeNull();
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );
```

`repositoryFor()` (`:34`) and `INTEGRATION_TEST_TIMEOUT_MS` (`:18`) are that file's existing helpers, and the `describe.skipIf(!databaseUrl)("WhatsApp repository", …)` block starts at `:251`. Read the surrounding tests and match their fixture-construction and cleanup conventions; confirm the new rows are covered by the existing teardown, and extend it if not.

- [ ] **Step 5: Run the integration test against the real database**

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/kossilon_test DATABASE_SSL=false npx vitest run src/features/whatsapp/repository.test.ts
```
Expected: PASS, including both new tests. `DATABASE_SSL=false` is required — without it the connection hangs indefinitely against the non-TLS container.

Run it a second time to confirm no fixture leakage.

- [ ] **Step 6: Correct the fixture that would mask this bug**

`src/features/whatsapp/repository.test.ts` has an existing inbound test using `from: "+85261234567"` — a plus-prefixed value **WOZTELL never sends** — chosen so its own `phone_e164` assertion would be meaningful. It directly contradicts `woztell-fixtures.ts`'s stated rule ("if a fixture and the code disagree, the code is wrong") and would hide exactly the format bug this task exists to fix.

Change that `from` to the bare-digit form and update its `phone_e164` assertion to match. Re-run the file; if any other assertion depends on the plus, fix it rather than reverting.

- [ ] **Step 7: Tear down and commit**

```bash
docker rm -f kossilon-test-pg
git add src/features/whatsapp/repository.ts src/features/whatsapp/repository.test.ts
git commit -m "feat: resolve last inbound timestamp by digits-only phone match"
```

---

### Task 6: `WoztellSendMode` replaces the templateName inference

**Files:**
- Modify: `src/features/whatsapp/woztell.ts`
- Modify: `src/features/whatsapp/woztell.test.ts`

- [ ] **Step 1: Replace the outbound types**

In `src/features/whatsapp/woztell.ts`, replace `WoztellOutboundMessage` (`:11-18`) with:

```ts
export type WoztellSendMode =
  | { kind: "text"; body: string }
  | {
      kind: "template";
      elementName: string;
      languageCode: string;
      components: readonly WoztellTemplateComponent[];
    };

export type WoztellOutboundMessage = {
  toPhone: string;
  mode: WoztellSendMode;
};
```

`toPhone` stays outside the union: it addresses the envelope's `recipientId` (`:38`), a sibling of `response`, not a member of it. `toWhatsAppId` is deleted — it was declared and populated but read nowhere.

- [ ] **Step 2: Rewrite `woztellResponseElement`**

Replace `:67-81` entirely:

```ts
/**
 * The TEXT-vs-TEMPLATE choice is WhatsApp's 24-hour session window rule, resolved
 * in dispatchDue (which owns the clock and the contact lookup) and handed here
 * already decided. This function used to infer it from whether a templateName was
 * passed, which had nothing to do with the actual rule.
 */
function woztellResponseElement(mode: WoztellSendMode): Record<string, unknown> {
  if (mode.kind === "template") {
    return {
      type: "TEMPLATE",
      elementName: mode.elementName,
      languageCode: mode.languageCode,
      components: mode.components,
    };
  }

  return { type: "TEXT", text: mode.body };
}
```

- [ ] **Step 3: Update the call inside `sendWoztellMessage`**

At `:39`, change:

```ts
        response: [woztellResponseElement(input)],
```
to:
```ts
        response: [woztellResponseElement(input.mode)],
```

- [ ] **Step 4: Update all five test call sites**

`src/features/whatsapp/woztell.test.ts` calls `sendWoztellMessage` at `:172`, `:190`, `:221`, `:234`, `:252`. Each passes a `WoztellOutboundMessage`; convert each to the new shape. The two byte-exact wire assertions are at `:176-180` (TEXT) and `:201-208` (TEMPLATE) — they assert the *output*, which is unchanged, so only the inputs move. For example the TEXT case becomes:

```ts
await sendWoztellMessage(
  config,
  { toPhone: "+852 9000 0000", mode: { kind: "text", body: "Reminder body" } },
  fetchImpl,
);
```

and the TEMPLATE case:

```ts
await sendWoztellMessage(
  config,
  {
    toPhone: "+852 9000 0000",
    mode: {
      kind: "template",
      elementName: "annual_return_manual_reminder",
      languageCode: "zh_HK",
      components: [],
    },
  },
  fetchImpl,
);
```

Read each site and preserve its existing intent and assertions exactly; only the input shape changes.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/features/whatsapp/woztell.test.ts`
Expected: PASS. The `:176-180` and `:201-208` wire assertions must pass **unchanged** — if either needed editing, the refactor altered the wire payload and is wrong.

- [ ] **Step 6: Commit**

```bash
git add src/features/whatsapp/woztell.ts src/features/whatsapp/woztell.test.ts
git commit -m "feat: take an explicit send mode instead of inferring it from templateName"
```

---

### Task 7: Transport context type

**Files:**
- Modify: `src/features/notifications/types.ts`

- [ ] **Step 1: Add the two new types and widen `dispatch`**

In `src/features/notifications/types.ts`, add near the `NotificationTransport` declaration (`:48-50`):

```ts
import type { WoztellSendMode } from "@/features/whatsapp/woztell";

/** Resolves a contact's last inbound message time from a digits-only phone number. */
export type LastInboundResolver = (phoneDigits: string) => Promise<string | null>;

/**
 * Per-dispatch context resolved by dispatchDue. Optional so local, simulated, and
 * resend transports keep their single-parameter implementations unchanged.
 */
export type NotificationDispatchContext = {
  whatsAppSendMode?: WoztellSendMode;
};
```

and change the transport's method signature (`:48-50`) to:

```ts
export type NotificationTransport = {
  dispatch(
    notification: NotificationOutboxRecord,
    context?: NotificationDispatchContext,
  ): Promise<NotificationDispatchResult>;
};
```

The record type is `NotificationOutboxRecord` (`:29`) and the return type is `NotificationDispatchResult` — both already declared in this file. Only the added parameter changes.

- [ ] **Step 2: Verify the other transports still compile**

Run: `npm run typecheck`
Expected: PASS. `local-transport.ts`, `simulated-transport.ts`, and `resend-transport.ts` each declare `async dispatch(notification)` with one parameter — TypeScript permits an implementation with fewer parameters than its target signature, so none of them changes.

- [ ] **Step 3: Commit**

```bash
git add src/features/notifications/types.ts
git commit -m "feat: add an optional dispatch context for the WhatsApp send mode"
```

---

### Task 8: Resolve the send mode in `dispatchDue`

**Files:**
- Modify: `src/features/notifications/dispatcher.ts`

- [ ] **Step 1: Add the resolver option**

In `src/features/notifications/dispatcher.ts`, extend `NotificationDispatcherOptions` (`:17-19`). Add the new member — leave the existing `whatsAppRepository` `Pick` **narrow**, so the three test literals at `:143`, `:159`, `:177` keep compiling:

```ts
export type NotificationDispatcherOptions = {
  whatsAppRepository?: Pick<WhatsAppRepository, "attachProviderMessageId">;
  /**
   * Supplied only in live provider mode (see runtime-dispatch.ts). Its absence
   * means "do not resolve", which keeps local and simulated dispatch byte-identical
   * to their previous behaviour.
   */
  lastInboundResolver?: LastInboundResolver;
};
```

- [ ] **Step 2: Add the mode resolver**

Add this module-level function to `dispatcher.ts`, above `createNotificationDispatcher`:

```ts
/**
 * Chooses TEXT or TEMPLATE on WhatsApp's actual rule. Runs here rather than in the
 * transport because this is the layer that owns the clock: dispatchDue's `now` is
 * the cron's intended tick, and a transport calling new Date() would introduce a
 * second clock inside one dispatch run.
 */
async function resolveWhatsAppSendMode(
  notification: NotificationOutboxRecord,
  now: string,
  lastInboundResolver: LastInboundResolver,
): Promise<WoztellSendMode> {
  const payload = notificationPayload(notification);
  const body = typeof payload.body === "string" ? payload.body : undefined;
  if (!body) throw new Error("WhatsApp notification is missing a message body.");

  const phoneDigits = toPhoneDigits(notification.recipient);
  const lastInboundAt = phoneDigits ? await lastInboundResolver(phoneDigits) : null;

  // Inside the window the composed body is sent even when the caller supplied a
  // template name — the TEMPLATE branch drops the body on the wire, which is how an
  // actively-engaged client used to lose their case-specific reminder.
  if (isWithinSessionWindow(lastInboundAt, now)) {
    return { kind: "text", body };
  }

  const components = Array.isArray(payload.templateComponents)
    ? (payload.templateComponents as WoztellTemplateComponent[])
    : [];

  const templateName = typeof payload.templateName === "string" ? payload.templateName : undefined;
  if (templateName) {
    return {
      kind: "template",
      elementName: templateName,
      languageCode: typeof payload.languageCode === "string" ? payload.languageCode : "en",
      components,
    };
  }

  const fallback = fallbackTemplateFor(notification.notificationType);
  if (!fallback) {
    throw Object.assign(
      new Error(
        `WhatsApp notification ${notification.notificationType} is outside the 24-hour session window and has no template to fall back to.`,
      ),
      { code: "whatsapp_no_fallback_template" },
    );
  }

  return {
    kind: "template",
    elementName: fallback.templateName,
    languageCode: fallback.languageCode,
    components: [],
  };
}
```

Add the imports it needs at the top of the file:

```ts
import { toPhoneDigits } from "@/features/whatsapp/phone";
import { isWithinSessionWindow } from "@/features/whatsapp/session-window";
import { fallbackTemplateFor } from "@/features/whatsapp/fallback-templates";
import type { WoztellSendMode } from "@/features/whatsapp/woztell";
import type { LastInboundResolver, NotificationDispatchContext } from "./types";
```

- [ ] **Step 3: Call it from `dispatchDue`**

In `dispatchDue`, replace the dispatch call at `:42` (`const result = await transport.dispatch(notification);`) with:

```ts
          const context: NotificationDispatchContext | undefined =
            notification.channel === "whatsapp" && options.lastInboundResolver
              ? {
                  whatsAppSendMode: await resolveWhatsAppSendMode(
                    notification,
                    now,
                    options.lastInboundResolver,
                  ),
                }
              : undefined;
          const result = await transport.dispatch(notification, context);
```

A resolver rejection (transient DB error) propagates into the existing catch and burns one attempt, which then retries and self-heals. That is deliberately preferred over degrading to a template: the composed body survives a short delay rather than being silently replaced.

- [ ] **Step 4: Log dispatch failures**

Still in `dispatchDue`, inside the existing `catch` block (`:72-93`), immediately after `errorCode` is computed, add:

```ts
          // The only screen that reads notification_outbox filters on
          // idempotency_key like 'follow-up:%', so sweep failures are otherwise
          // invisible — and redactExpired nulls last_error_code/message at
          // retention, putting the evidence on a 90-day fuse. A permanently
          // unapproved fallback template would surface only as an aggregate count.
          console.error("notification dispatch failed", {
            id: notification.id,
            notificationType: notification.notificationType,
            channel: notification.channel,
            errorCode,
          });
```

- [ ] **Step 5: Forward the context through the WOZTELL transport**

Replace `createWoztellNotificationTransport`'s `dispatch` (`:105-126`) with:

```ts
    async dispatch(notification, context) {
      if (notification.channel !== "whatsapp")
        throw new Error(`Unsupported notification channel: ${notification.channel}.`);
      if (!notification.recipient) throw new Error("WhatsApp notification is missing a recipient.");

      // Resolved by dispatchDue, which owns the clock. Its absence means the
      // dispatcher was mis-wired — fail loudly rather than silently reverting to
      // un-windowed sends.
      const mode = context?.whatsAppSendMode;
      if (!mode) {
        throw Object.assign(
          new Error("WhatsApp dispatch is missing a resolved session-window send mode."),
          { code: "whatsapp_send_mode_missing" },
        );
      }

      return sendWoztellMessage(config, { toPhone: notification.recipient, mode }, fetchImpl);
    },
```

- [ ] **Step 6: Forward the context through the composite router**

This is the step whose omission would break every live WhatsApp send. `dispatchDue` holds this router, not the WOZTELL transport. At `:148-149`, change:

```ts
    async dispatch(notification) {
      if (notification.channel === "whatsapp") return whatsappTransport.dispatch(notification);
```
to:
```ts
    async dispatch(notification, context) {
      if (notification.channel === "whatsapp")
        return whatsappTransport.dispatch(notification, context);
```

Leave the email branch (`:156`) unchanged — it ignores the context.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/features/notifications/dispatcher.ts
git commit -m "feat: resolve the WhatsApp session window in dispatchDue"
```

---

### Task 9: Gate the resolver to live mode

**Files:**
- Modify: `src/features/notifications/runtime-dispatch.ts`
- Modify: `src/features/notifications/dispatcher.test.ts`
- Modify: `src/features/notifications/runtime-dispatch.test.ts`

- [ ] **Step 1: Inject the resolver, gated**

`runtime-dispatch.ts:67` constructs the WhatsApp repository **unconditionally for every provider mode**, unlike `config`/`resendConfig`, which are gated at `:40-41`. Left ungated, the resolver would run a DB query for every whatsapp row in local and simulated mode, and a transient DB error would burn a retry attempt on sends that previously always succeeded.

In `dispatchDueNotificationsWithDependencies`, change the `createNotificationDispatcher` options (`:47-49`) to:

```ts
    return await createNotificationDispatcher(repository, transport, {
      whatsAppRepository,
      // Gated exactly as config/resendConfig are above: local and simulated modes
      // keep their previous behaviour, with no window lookup at all.
      lastInboundResolver:
        providerMode === "live" && whatsAppRepository
          ? (phoneDigits) => whatsAppRepository.lastInboundAtForPhoneDigits(phoneDigits)
          : undefined,
    }).dispatchDue(data.now, data.limit);
```

Read the surrounding code first — `providerMode` and `whatsAppRepository` are both already in scope at that point (`:36-41`).

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Fix the two live-composite tests**

`src/features/notifications/dispatcher.test.ts:200-222` and `:245-279` dispatch live-mode WhatsApp through the composite router with **no second argument** (the dispatch calls are at `:218-220` and `:274-278`). They now hit the *no-send-mode* throw, so changing their payloads does not help — each must pass a context:

```ts
await transport.dispatch(
  notification({ channel: "whatsapp", recipient: "+85290000000", payload: { body: "hi" } }),
  { whatsAppSendMode: { kind: "text", body: "hi" } },
);
```

Read each test and adapt to its actual local variable names, preserving its original assertions.

- [ ] **Step 4: Fix the exact-match transport assertion**

`src/features/notifications/runtime-dispatch.test.ts:110-114` asserts an **exact** object match on the `createTransport` call and breaks on any added key. (`:145-147` and `:180-184` use `objectContaining` and survive.) Change `:110-114` to `expect.objectContaining({...})` with its existing keys.

- [ ] **Step 5: Run the notifications suites**

Run: `npx vitest run src/features/notifications/`
Expected: PASS, all files.

- [ ] **Step 6: Commit**

```bash
git add src/features/notifications/runtime-dispatch.ts src/features/notifications/dispatcher.test.ts src/features/notifications/runtime-dispatch.test.ts
git commit -m "feat: gate session window resolution to live provider mode"
```

---

### Task 10: Dispatcher decision-table tests

**Files:**
- Modify: `src/features/notifications/dispatcher.test.ts`

- [ ] **Step 1: Write tests for all seven states**

Add a new `describe` block. Each test builds a dispatcher with a stub `lastInboundResolver` and a transport spy, then asserts the exact `WoztellSendMode` handed to the transport:

```ts
describe("WhatsApp session window resolution", () => {
  const now = "2026-08-26T12:00:00.000Z";
  const insideWindow = "2026-08-26T11:00:00.000Z";
  const outsideWindow = "2026-08-24T11:00:00.000Z";

  function dispatcherWith(options: {
    lastInboundAt: string | null;
    notificationType?: string;
    payload?: Record<string, unknown>;
  }) {
    const dispatch = vi.fn(async () => ({ providerMessageId: "wamid.1" }));
    const record = notification({
      channel: "whatsapp",
      recipient: "+852 6090 3521",
      notificationType: options.notificationType ?? "annual_return_reminder_1_month",
      payload: options.payload ?? { body: "composed body" },
    });
    const dispatcher = createNotificationDispatcher(
      repository([record]),
      { dispatch },
      { lastInboundResolver: async () => options.lastInboundAt },
    );
    return { dispatch, dispatcher };
  }

  it("sends TEXT inside the window", async () => {
    const { dispatch, dispatcher } = dispatcherWith({ lastInboundAt: insideWindow });
    await dispatcher.dispatchDue(now);
    expect(dispatch.mock.calls[0][1]).toEqual({
      whatsAppSendMode: { kind: "text", body: "composed body" },
    });
  });

  it("sends TEXT inside the window even when a template name was supplied", async () => {
    const { dispatch, dispatcher } = dispatcherWith({
      lastInboundAt: insideWindow,
      payload: { body: "composed body", templateName: "annual_return_manual_reminder" },
    });
    await dispatcher.dispatchDue(now);
    expect(dispatch.mock.calls[0][1]?.whatsAppSendMode).toMatchObject({ kind: "text" });
  });

  it("uses the supplied template outside the window", async () => {
    const { dispatch, dispatcher } = dispatcherWith({
      lastInboundAt: outsideWindow,
      payload: {
        body: "composed body",
        templateName: "annual_return_manual_reminder",
        languageCode: "zh_HK",
      },
    });
    await dispatcher.dispatchDue(now);
    expect(dispatch.mock.calls[0][1]?.whatsAppSendMode).toEqual({
      kind: "template",
      elementName: "annual_return_manual_reminder",
      languageCode: "zh_HK",
      components: [],
    });
  });

  it("falls back to the mapped re-engagement template outside the window", async () => {
    const { dispatch, dispatcher } = dispatcherWith({ lastInboundAt: outsideWindow });
    await dispatcher.dispatchDue(now);
    expect(dispatch.mock.calls[0][1]?.whatsAppSendMode).toEqual({
      kind: "template",
      elementName: "annual_return_reengagement",
      languageCode: "zh_HK",
      components: [],
    });
  });

  it("treats a contact who has never messaged us as outside the window", async () => {
    const { dispatch, dispatcher } = dispatcherWith({ lastInboundAt: null });
    await dispatcher.dispatchDue(now);
    expect(dispatch.mock.calls[0][1]?.whatsAppSendMode).toMatchObject({ kind: "template" });
  });

  it("fails the dispatch when outside the window with no template mapped", async () => {
    const { dispatch, dispatcher } = dispatcherWith({
      lastInboundAt: outsideWindow,
      notificationType: "unmapped_type",
    });
    const summary = await dispatcher.dispatchDue(now);
    expect(dispatch).not.toHaveBeenCalled();
    expect(summary.retried + summary.permanentlyFailed).toBe(1);
  });

  it("does not resolve at all when no resolver is supplied", async () => {
    const dispatch = vi.fn(async () => ({ providerMessageId: "wamid.1" }));
    const record = notification({
      channel: "whatsapp",
      recipient: "+852 6090 3521",
      payload: { body: "hi" },
    });
    const dispatcher = createNotificationDispatcher(
      repository([record]),
      { dispatch },
      {},
    );
    await dispatcher.dispatchDue(now);
    expect(dispatch.mock.calls[0][1]).toBeUndefined();
  });
});
```

Both helpers used above already exist in that file: `notification(overrides)` at `:9` and `repository(rows)` at `:32`. Read them before writing, and match how the existing tests build a record and assert on the dispatch summary. Do not invent new infrastructure.

- [ ] **Step 2: Run the tests**

Run: `npx vitest run src/features/notifications/dispatcher.test.ts`
Expected: PASS, all seven new tests plus the existing ones.

- [ ] **Step 3: Commit**

```bash
git add src/features/notifications/dispatcher.test.ts
git commit -m "test: cover every session window decision state"
```

---

### Task 11: Runbook entry for the template-approval dependency

**Files:**
- Modify: `docs/runbooks/firm-deployment.md`

- [ ] **Step 1: Add the checklist**

No automated gate can verify template approval — `verify:firm` is offline by construction and reports whatsapp as `blocked`. This runbook entry is the only enforcement that exists, so it names the literal strings.

Add to `docs/runbooks/firm-deployment.md`, near the existing migration/SLA-policy setup notes:

```markdown
### WhatsApp re-engagement templates (P2-3)

Outside WhatsApp's 24-hour session window, free-form text is rejected and an
approved template is required. Both of the following must be approved in the
WOZTELL/Meta dashboard, in `zh_HK`, before automated reminders can reach a client
who has gone quiet:

- [ ] `annual_return_reengagement`
- [ ] `service_subscription_reengagement`

Both are no-variable templates — they prompt the client to reply, which reopens the
window; they cannot name the client or the case. Their names are code constants in
`src/features/whatsapp/fallback-templates.ts`; changing one here requires changing
it there.

If a template is missing or unapproved, WOZTELL rejects the send and the failure is
logged by the dispatcher as `notification dispatch failed` with the notification
type and error code. Nothing in CI or `verify:firm` can detect this — it is a
dashboard-side fact.
```

Read the file first and match its existing heading levels and tone.

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/firm-deployment.md
git commit -m "docs: record the WhatsApp re-engagement template approval dependency"
```

---

### Task 12: Full verification sweep

**Files:** none (verification only).

- [ ] **Step 1: Full local suite**

Run: `npm run test`
Expected: all pass; DB-integration tests skip without `TEST_DATABASE_URL`.

- [ ] **Step 2: Typecheck, build, lint**

Run: `npm run typecheck && npm run build && npm run lint`
Expected: clean. One pre-existing unrelated `react-refresh/only-export-components` warning in `src/routes/work-queue.tsx` is expected.

- [ ] **Step 3: `verify:firm`**

Run: `npm run verify:firm -- --dry-run`
Expected: PASS.

- [ ] **Step 4: Full suite against a real database**

```bash
docker run -d --name kossilon-test-pg -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=kossilon_test -p 5432:5432 postgres:17-alpine
DATABASE_URL=postgres://postgres:postgres@localhost:5432/kossilon_test DATABASE_SSL=false bun scripts/db-migrate.ts
DATABASE_URL=postgres://postgres:postgres@localhost:5432/kossilon_test DATABASE_SSL=false bun scripts/db-seed-annual-return.ts
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/kossilon_test DATABASE_SSL=false npm run test
```
Expected: all pass with zero `TEST_DATABASE_URL`-gated skips. `DATABASE_SSL=false` is mandatory; omitting it hangs indefinitely.

Note: a transient failure in `src/features/annual-return/repository.test.ts` count assertions caused by a concurrent WhatsApp fixture is a known pre-existing test-isolation race, not a regression — re-run to confirm before investigating.

- [ ] **Step 5: Confirm the index is actually used**

With the container still running:

```bash
docker exec kossilon-test-pg psql -U postgres -d kossilon_test -c "explain select max(wm.received_at) from whatsapp_messages wm join whatsapp_contacts wc on wc.id = wm.contact_id where regexp_replace(coalesce(wc.phone_e164, wc.whatsapp_id), '[^0-9]', '', 'g') = '85260903521' and wm.direction = 'inbound';"
```
Expected: the plan references `whatsapp_contacts_phone_digits_idx`. On a near-empty table Postgres may prefer a sequential scan regardless — if so, note it and rely on Task 4's existence check rather than editing the query to force a match.

Tear down: `docker rm -f kossilon-test-pg`

- [ ] **Step 6: Confirm demo mode is untouched**

Run: `git diff --name-only main...HEAD | grep -E "src/lib/.*-store\.ts|demo-.*\.tsx"`
Expected: no matches. This plan touches no demo-mode file.

- [ ] **Step 7: Push, open a PR, confirm CI green**

Requires the user's explicit go-ahead before pushing or opening a PR. Once approved:

```bash
git push -u origin codex/whatsapp-session-window
gh pr create --title "feat: P2-3 WhatsApp 24-hour session window handling" --body "See docs/superpowers/specs/2026-08-26-whatsapp-session-window-design.md"
```

Then confirm CI's `verify` job specifically reports `SUCCESS` via `gh pr view <n> --json statusCheckRollup` — not merely that the PR merged — before treating this item as done.
