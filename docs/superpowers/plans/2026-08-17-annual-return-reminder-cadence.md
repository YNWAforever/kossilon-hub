# Automated Annual-Return Reminder Cadence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically send annual-return reminders at 1 month / 2 weeks / 1 week before a case's filing deadline, in Traditional Chinese, via WhatsApp (falling back to email), with no staff action required.

**Architecture:** A new `evaluateReminders` pass on `AnnualReturnRepository`, wired into the existing 5-minute maintenance cron the same way `evaluateEscalations` already is. A dedicated event table gates each milestone to fire exactly once per case, mirroring the proven `escalation_events` pattern. `buildReminderDraft` is rewritten in Traditional Chinese and shared by the new automated path and the two existing manual paths.

**Tech Stack:** TypeScript strict, Vitest, Postgres via `postgres.js` tagged-template SQL, the existing `notification_outbox`/P0-6 dispatch pipeline.

---

## Context you need before task 1

**Source of truth:** `docs/superpowers/specs/2026-08-17-annual-return-reminder-cadence-design.md` — read it for the full reasoning. This plan pulls in everything needed to implement it, verified against the current repo.

**This depends on P0-6** (live email transport, already merged to `main` — `getResendConfig`, the Resend transport, and composite channel routing in `createNotificationTransport` all exist and are wired through `dispatchDueNotificationsOnServer`). Nothing in this plan touches that work; it's a prerequisite, not part of this branch.

**`buildReminderDraft` has five call sites, not two.** Grep confirms:
1. `src/features/annual-return/whatsapp-reminders.ts:67` (production — the manual "send reminder now" flow; has a real `recipientName` in scope)
2. `src/features/annual-return/whatsapp-reminders.test.ts:62,111` (tests, direct calls)
3. `src/features/annual-return/follow-ups.ts:149` (production — the follow-up drafts list; recipient may be unresolved, since a draft is generated even for cases with no persisted recipient yet)
4. `src/features/annual-return/follow-ups.test.ts:93,110,120,139` (tests, indirect via `deriveProductionFollowUpDrafts`)
5. `src/features/annual-return/server-fns.ts:508` (production — `buildAnnualReturnReminderDraft`, a preview-only server fn with **no recipient at all**, only a `caseId`)
6. `src/features/annual-return/workflow.test.ts:199,205` (tests, direct calls)

Every one of these needs updating in Task 3 or it won't compile. Call sites 3 and 5 have no specific contact name available — they pass a generic `"貴公司"` (a natural Cantonese/Chinese business honorific meaning roughly "your esteemed company," used when addressing a company rather than a named individual) rather than `null`, keeping `buildReminderDraft`'s `contactName` parameter a plain required `string` with no internal null-handling branch.

**Reuse `daysBetween`, don't reinvent date math.** `src/features/annual-return/workflow.ts` already exports `daysBetween(startDate, endDate): number`, and `riskForCase` in the same file already uses the identical 30/14/7-day thresholds this feature needs, for a different purpose (risk-level coloring). Use `daysBetween` in both `buildReminderDraft` (Task 3) and the new `dueMilestone` (Task 2) rather than writing new `Date.parse` arithmetic — it already handles date-only parsing correctly and matches the file's own convention.

**`lockWritableCase` throws; the new pass needs a version that doesn't.** Every existing mutation in `repository.ts` (`assignOwner`, `addNote`, `updateStatus`, `recordReminder`, etc.) calls `lockWritableCase(tx, caseId)`, which throws if the case isn't found/writable — correct for a single-case, actor-driven mutation where "not writable" is an error. `evaluateReminders` processes many cases in a loop and must *skip* an ineligible one, not abort the whole batch — exactly how `evaluateEscalations` in `src/features/work-items/repository.ts` already handles this (`getWorkItem(tx, id, true)` returns `null`, caller does `if (!item) return;`). Task 4 extracts `lockWritableCase`'s query into a new `tryLockWritableCase` that returns `null` instead of throwing, with `lockWritableCase` becoming a thin wrapper — a small, behavior-preserving refactor of a heavily-used helper. Verify every existing caller of `lockWritableCase` still passes unchanged after this.

**`recordReminder` cannot be reused for automated sends.** It requires and authorizes a human `actorId` via `assertActorCanMutateLockedCase`, which a cron pass has no way to satisfy. `evaluateReminders` does its own equivalent `reminders_sent`/`current_status` update directly (Task 4), and writes to `timeline_events` only — not `annual_return_audit_events` (`writeAuditEvent`), which is actor-scoped and reserved for staff actions per its existing usage throughout this file.

**`company_contacts` has no dedicated repository method to reuse.** It's owned by `src/features/clients/repository.ts`, which only exposes list/create/update operations, not a single "get primary contact" getter. `repository.ts` already reads other features' tables directly with inline SQL (joins to `companies`, `documents`, `payments`) rather than routing through their owning repositories — Task 4 does the same: a small, self-contained `select name, email, phone from company_contacts where company_id = $1 and is_primary = true limit 1`.

**Repository integration tests need `TEST_DATABASE_URL`.** `repository.test.ts`, `cron.test.ts`, and `maintenance.test.ts` are read in full in their respective tasks below — follow their exact existing fixture/mocking conventions. Some of `repository.test.ts` is a `TEST_DATABASE_URL`-gated integration suite (`const databaseUrl = process.env.TEST_DATABASE_URL`); Task 4's new tests belong in that same file, following its `createMutableAnnualReturnFixture` pattern. These will not run in an environment without that variable set — that's expected and matches every other repository integration test in this codebase.

All paths below are relative to the repo root. Work on branch `codex/annual-return-reminder-cadence` (already created off `main`, already has the design spec committed).

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `db/migrations/0012_annual_return_reminder_events.sql` | Create | New event table, gates each milestone to fire once per case |
| `src/server/db/schema.sql` | Modify | Reference copy of the new table, matching this repo's schema/migration sync convention |
| `src/features/annual-return/reminder-cadence.ts` | Create | `ReminderMilestone` type + `dueMilestone` pure function |
| `src/features/annual-return/reminder-cadence.test.ts` | Create | Tests for `dueMilestone` in isolation |
| `src/features/annual-return/workflow.ts` | Modify | `buildReminderDraft` rewritten in Traditional Chinese, gains `contactName`/`today` params |
| `src/features/annual-return/workflow.test.ts` | Modify | Updated for the new signature and Chinese content |
| `src/features/annual-return/whatsapp-reminders.ts` | Modify | Threads `today` through to `buildReminderDraft` |
| `src/features/annual-return/whatsapp-reminders.test.ts` | Modify | Updated call sites |
| `src/features/annual-return/follow-ups.ts` | Modify | Threads `today` through; supplies the generic-contact fallback |
| `src/features/annual-return/follow-ups.test.ts` | Modify | Updated call sites |
| `src/features/annual-return/follow-up-server-fns.ts` | Modify | Supplies `hongKongBusinessDate()` at both call sites |
| `src/features/annual-return/server-fns.ts` | Modify | Supplies `hongKongBusinessDate()` and the generic-contact fallback for the preview server fn |
| `src/features/annual-return/repository.ts` | Modify | New `evaluateReminders` method; `tryLockWritableCase` extraction |
| `src/features/annual-return/repository.test.ts` | Modify | New `evaluateReminders` integration tests |
| `src/server/cron.ts` | Modify | New `evaluateAnnualReturnReminders` step in the maintenance pipeline |
| `src/server/cron.test.ts` | Modify | Updated call-order assertion |
| `src/server/maintenance.ts` | Modify | Wires the real `AnnualReturnRepository` through |
| `src/server/maintenance.test.ts` | Modify | Updated dependency fixture |

---

## Task 1: `annual_return_reminder_events` migration

**Files:**
- Create: `db/migrations/0012_annual_return_reminder_events.sql`
- Modify: `src/server/db/schema.sql`

### Step 1: Write the migration

Create `db/migrations/0012_annual_return_reminder_events.sql`:

```sql
-- evaluateReminders (src/features/annual-return/repository.ts) needs a permanent
-- record of which milestone reminders have already fired per case, independent of
-- notification_outbox — those rows get redacted after retention_until (see
-- redactExpired in src/features/notifications/outbox.ts), so deriving "already
-- sent" from the outbox would silently forget and re-send once a row aged out.
-- Mirrors escalation_events, which solves the identical problem for SLA warnings
-- and breaches.
create table if not exists annual_return_reminder_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references annual_return_cases(id),
  milestone text not null check (milestone in ('1_month', '2_week', '1_week')),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (case_id, milestone)
);
```

**Correction (found in code review, fixed before Task 4 began):** the block above originally also had `on delete cascade` on `case_id`, plus a separate `create index ... (case_id)`. Both were removed: cascade contradicted this table's own stated durability rationale (see the comment above) and its closest sibling, `annual_return_audit_events`, deliberately has no `on delete` clause; and the standalone index was redundant with the index the `unique (case_id, milestone)` constraint already creates (whose leading column is `case_id`, already serving single-column lookups on it).

### Step 2: Add the same table to `schema.sql`

Read `src/server/db/schema.sql` first to find where `annual_return_audit_events` and other annual-return event tables are defined, and add the identical `create table`/`create index` block there, matching this file's existing role as a reference document kept in sync with migrations (see the comment already in that file explaining this convention).

### Step 3: Verify

Run: `npx tsc --noEmit`
Expected: clean (this task adds no TypeScript).

### Step 4: Commit

```bash
git add db/migrations/0012_annual_return_reminder_events.sql src/server/db/schema.sql
git commit -m "feat(annual-return): add reminder milestone event tracking table"
```

---

## Task 2: `dueMilestone` — milestone selection

**Files:**
- Create: `src/features/annual-return/reminder-cadence.ts`
- Create: `src/features/annual-return/reminder-cadence.test.ts`

### Step 1: Write the failing tests

Create `src/features/annual-return/reminder-cadence.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { dueMilestone } from "./reminder-cadence";

describe("dueMilestone", () => {
  it("returns null when no milestone has come due yet", () => {
    expect(dueMilestone("2026-09-12", "2026-08-01", [])).toBeNull();
  });

  it("fires 1_month exactly 30 days out", () => {
    expect(dueMilestone("2026-09-12", "2026-08-13", [])).toBe("1_month");
  });

  it("fires 2_week once 1_month has already fired", () => {
    expect(dueMilestone("2026-09-12", "2026-08-29", ["1_month"])).toBe("2_week");
  });

  it("fires 1_week once 1_month and 2_week have already fired", () => {
    expect(dueMilestone("2026-09-12", "2026-09-05", ["1_month", "2_week"])).toBe("1_week");
  });

  it("does not re-fire a milestone that has already fired", () => {
    expect(dueMilestone("2026-09-12", "2026-08-13", ["1_month"])).toBeNull();
  });

  it("skips straight to the most urgent applicable milestone for a late-created case", () => {
    // 5 days before the deadline: only 1_week's 7-day window applies. 2_week (14d)
    // and 1_month (30d) are both already "in range" numerically, but the loop
    // returns on the first (most urgent) match, so neither is ever considered.
    expect(dueMilestone("2026-09-12", "2026-09-07", [])).toBe("1_week");
  });

  it("still fires 1_week for an overdue case with nothing recorded yet", () => {
    expect(dueMilestone("2026-09-12", "2026-09-20", [])).toBe("1_week");
  });

  it("returns null once every milestone has fired, even if overdue", () => {
    expect(dueMilestone("2026-09-12", "2026-09-20", ["1_month", "2_week", "1_week"])).toBeNull();
  });
});
```

Run: `npm run test -- src/features/annual-return/reminder-cadence.test.ts`
Expected: FAIL — the module does not exist yet.

### Step 2: Implement it

Create `src/features/annual-return/reminder-cadence.ts`:

```typescript
import { daysBetween } from "./workflow";

export type ReminderMilestone = "1_month" | "2_week" | "1_week";

export const REMINDER_MILESTONES: readonly ReminderMilestone[] = ["1_month", "2_week", "1_week"];

const MILESTONE_OFFSET_DAYS: Record<ReminderMilestone, number> = {
  "1_month": 30,
  "2_week": 14,
  "1_week": 7,
};

// Most urgent first: walking this order and returning the first due-and-unfired
// match means a case that becomes eligible late (e.g. created 10 days before its
// deadline) jumps straight to the nearest applicable milestone — 1_month and
// 2_week are never fired for it, with no separate "moot" bookkeeping needed.
const MILESTONES_BY_URGENCY: readonly ReminderMilestone[] = ["1_week", "2_week", "1_month"];

export function dueMilestone(
  filingDueDate: string,
  today: string,
  firedMilestones: readonly ReminderMilestone[],
): ReminderMilestone | null {
  const daysRemaining = daysBetween(today, filingDueDate);

  for (const milestone of MILESTONES_BY_URGENCY) {
    if (daysRemaining <= MILESTONE_OFFSET_DAYS[milestone]) {
      return firedMilestones.includes(milestone) ? null : milestone;
    }
  }

  return null;
}
```

**Correctness note (found in code review, fixed before this plan was executed):** the first draft of this function continued past an already-fired milestone to check the next, less-urgent one — meaning a case that became eligible late would fire `1_week`, then on the very next cron tick fire `2_week` too, then `1_month`, cascading through all three within about 15 minutes. The fix above finds the single most-urgent NUMERICALLY-due milestone first, regardless of fired status, and returns `null` immediately if that one already fired — it never falls through to consider a less-urgent milestone once the most-urgent applicable one is resolved either way.

### Step 3: Run the tests

Run: `npm run test -- src/features/annual-return/reminder-cadence.test.ts`
Expected: PASS, all 8 cases.

### Step 4: Verify

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm run lint`
Expected: clean, exit code checked directly.

### Step 5: Commit

```bash
git add src/features/annual-return/reminder-cadence.ts src/features/annual-return/reminder-cadence.test.ts
git commit -m "feat(annual-return): add milestone selection for the reminder cadence"
```

---

## Task 3: Traditional Chinese `buildReminderDraft` + thread through every caller

**Files:**
- Modify: `src/features/annual-return/workflow.ts`
- Modify: `src/features/annual-return/workflow.test.ts`
- Modify: `src/features/annual-return/whatsapp-reminders.ts`
- Modify: `src/features/annual-return/whatsapp-reminders.test.ts`
- Modify: `src/features/annual-return/follow-ups.ts`
- Modify: `src/features/annual-return/follow-ups.test.ts`
- Modify: `src/features/annual-return/follow-up-server-fns.ts`
- Modify: `src/features/annual-return/server-fns.ts`

This task changes `buildReminderDraft`'s signature, which breaks compilation everywhere it's called until every site below is updated. Do all of it as one task — an intermediate commit where only some callers compile isn't a usable state.

### Step 1: Write the failing test for the new signature and content

Read `src/features/annual-return/workflow.test.ts` in full first (it already defines `baseCase` and `readyCase` fixtures — reuse them).

Replace the existing `buildReminderDraft` tests:

```typescript
  it("builds a staff-copyable WhatsApp reminder draft", () => {
    expect(buildReminderDraft(baseCase)).toContain("Harbour Trading Ltd");
    expect(buildReminderDraft(baseCase)).toContain("2026-08-12");
    expect(buildReminderDraft(baseCase)).toContain("Signed NAR1 form");
  });

  it("does not ask for outstanding items when required documents are complete", () => {
    expect(buildReminderDraft(readyCase)).not.toContain("outstanding items");
  });
```

with:

```typescript
  it("builds a staff-copyable Traditional Chinese reminder draft", () => {
    const draft = buildReminderDraft(baseCase, "Ada Chan", "2026-07-13");
    expect(draft).toContain("Ada Chan");
    expect(draft).toContain("Harbour Trading Ltd");
    expect(draft).toContain("2026-08-12");
    expect(draft).toContain("Signed NAR1 form");
    expect(draft).toContain("距離現時尚餘 30 天");
  });

  it("does not ask for outstanding items when required documents are complete", () => {
    const draft = buildReminderDraft(readyCase, "Ada Chan", "2026-07-13");
    expect(draft).not.toContain("我們已為貴公司準備申報文件");
    expect(draft).toContain("貴公司提供的文件已經齊備");
  });
```

Run: `npm run test -- src/features/annual-return/workflow.test.ts -t "reminder draft"`
Expected: FAIL — `buildReminderDraft` still has its old signature and English content.

### Step 2: Rewrite `buildReminderDraft`

In `src/features/annual-return/workflow.ts`, replace:

```typescript
export function buildReminderDraft(case_: AnnualReturnCase): string {
  const missingItems = case_.checklist.filter(
    (item) => item.required && item.status !== "Verified",
  );
  const missingItemList = missingItems.map((item) => `- ${item.itemLabel}`).join("\n");

  const missingSection =
    missingItemList.length > 0
      ? `We are still waiting for:\n${missingItemList}`
      : "All required documents are recorded. We will continue preparing the filing.";
  const closing =
    missingItems.length > 0
      ? "Please send the outstanding items as soon as possible so we can avoid late filing risk."
      : "We will continue preparing the filing and follow up if anything else is needed.";

  return [
    `Hello, this is Kossilon following up on the annual return for ${case_.companyName}.`,
    `The filing deadline is ${case_.filingDueDate}.`,
    missingSection,
    closing,
    "Thank you.",
  ].join("\n\n");
}
```

with:

```typescript
export function buildReminderDraft(
  case_: AnnualReturnCase,
  contactName: string,
  today: string,
): string {
  const missingItems = case_.checklist.filter(
    (item) => item.required && item.status !== "Verified",
  );
  const daysRemaining = daysBetween(today, case_.filingDueDate);

  const missingSection =
    missingItems.length > 0
      ? [
          "我們已為貴公司準備申報文件，現需要您提供以下資料以便如期遞交：",
          ...missingItems.map((item) => `- ${item.itemLabel}`),
          "",
          "如所有文件已齊備，我們會即時安排遞交，並在完成後把回條發送給您。",
        ].join("\n")
      : "貴公司提供的文件已經齊備，我們將繼續為貴公司準備及跟進申報事宜。";

  return [
    `${contactName} 您好，我是高仕輪企業服務。`,
    `提提您，${case_.companyName} 的周年申報表（NAR1）申報限期為 ${case_.filingDueDate}，距離現時尚餘 ${daysRemaining} 天。`,
    missingSection,
    "請留意：若周年申報表在申報日起計 42 天後才遞交，會按逾期時間產生罰款，最低 HK$870，最高 HK$3,480。",
    "如有任何疑問，歡迎隨時聯絡我們。",
    "高仕輪企業服務",
  ].join("\n\n");
}
```

`daysBetween` is already defined earlier in this same file — no new import needed.

### Step 3: Fix `whatsapp-reminders.ts`

Read `src/features/annual-return/whatsapp-reminders.ts` in full first.

Add `today: string` to `BuildAnnualReturnWhatsAppReminderRequestInput`:

```typescript
export type BuildAnnualReturnWhatsAppReminderRequestInput = {
  case_: AnnualReturnCase;
  actorId: string;
  recipientName: string;
  recipientPhone: string;
  today: string;
};
```

Update `buildAnnualReturnWhatsAppReminderRequest` to destructure and pass it through:

```typescript
export function buildAnnualReturnWhatsAppReminderRequest({
  case_,
  actorId,
  recipientName,
  recipientPhone,
  today,
}: BuildAnnualReturnWhatsAppReminderRequestInput): AnnualReturnWhatsAppReminderRequest {
  const draftBody = buildReminderDraft(case_, recipientName, today);
  ...
```

(Leave the rest of the function body — the `return { annualReturnReminder: {...}, whatsAppMessage: {...} }` block — unchanged; only the `draftBody` computation line changes.)

`QueueAnnualReturnWhatsAppReminderInput` is `BuildAnnualReturnWhatsAppReminderRequestInput & {...}`, so it inherits `today` automatically — no separate edit needed there, and `queueAnnualReturnWhatsAppReminder`'s existing `{ annualReturnRepository, whatsAppRepository, ...input }` destructure already forwards `today` into `buildAnnualReturnWhatsAppReminderRequest(input)` unchanged.

### Step 4: Fix `whatsapp-reminders.test.ts`

Read the file in full first (it defines `harbourCase` and `actorId` at the top — reuse them).

Update the two direct `buildReminderDraft` calls to pass the new arguments:

```typescript
    const draftBody = buildReminderDraft(harbourCase, "Ada Director", "2026-07-13");
```

(replaces `const draftBody = buildReminderDraft(harbourCase);`)

```typescript
      body: buildReminderDraft(harbourCase, "Ada Director", "2026-07-13"),
```

(replaces `body: buildReminderDraft(harbourCase),` inside the `message` fixture object)

Add `today: "2026-07-13"` to both `buildAnnualReturnWhatsAppReminderRequest`/`queueAnnualReturnWhatsAppReminder` input objects (there are two — one in `"builds matching annual-return reminder and WhatsApp queue requests"`, one in `"queues the WhatsApp message before recording the compliance reminder"`), alongside the existing `case_`/`actorId`/`recipientName`/`recipientPhone` fields.

### Step 5: Fix `follow-ups.ts`

Read `src/features/annual-return/follow-ups.ts` in full first — it already imports `buildReminderDraft` from `./workflow`.

Add a `today: string` parameter to `deriveProductionFollowUpDrafts`, and pass a contact-name fallback into `buildReminderDraft`:

```typescript
export function deriveProductionFollowUpDrafts(
  cases: readonly AnnualReturnCase[],
  state: PersistedFollowUpState,
  today: string,
): ProductionFollowUpDraft[] {
```

Inside the function, replace:

```typescript
      messagePreview: buildReminderDraft(caseItem),
```

with:

```typescript
      messagePreview: buildReminderDraft(caseItem, recipient?.recipientName ?? "貴公司", today),
```

(`recipient` is already resolved a few lines above this in the existing loop body — this is the only line that changes.)

### Step 6: Fix `follow-ups.test.ts`

Read the file in full first. Add a third `today` argument (e.g. `"2026-07-14"`) to all four `deriveProductionFollowUpDrafts` calls:

```typescript
    const drafts = deriveProductionFollowUpDrafts([caseItem], state(), "2026-07-14");
```

```typescript
    const drafts = deriveProductionFollowUpDrafts([caseItem], state({ recipients: [] }), "2026-07-14");
```

```typescript
    const drafts = deriveProductionFollowUpDrafts(
      [{ ...caseItem, currentStatus: "Filed" }],
      state(),
      "2026-07-14",
    );
```

```typescript
    const drafts = deriveProductionFollowUpDrafts(
      [caseItem],
      state({
        deliveries: [
          { idempotencyKey: stableFollowUpIdempotencyKey(annualIdentity), status: "pending" },
          { idempotencyKey: stableFollowUpIdempotencyKey(documentIdentity), status: "sent" },
          { idempotencyKey: stableFollowUpIdempotencyKey(paymentIdentity), status: "failed" },
        ],
      }),
      "2026-07-14",
    );
```

None of these tests assert on `messagePreview`'s exact content, so no other changes are needed in this file.

### Step 7: Fix `follow-up-server-fns.ts`

Read the file in full first. Add `hongKongBusinessDate` to its imports from `./workflow` (it does not currently import anything from that module):

```typescript
import { hongKongBusinessDate } from "./workflow";
```

Update both call sites of `deriveProductionFollowUpDrafts`:

```typescript
  return deriveProductionFollowUpDrafts(authorizedCases, state, hongKongBusinessDate());
```

```typescript
  const draft = deriveProductionFollowUpDrafts([currentCase], state, hongKongBusinessDate()).find(
```

### Step 8: Fix `server-fns.ts`

Read the file in full first. It already imports `buildReminderDraft, completionBlockers, isAllowedStatusTransition` from `./workflow` (line 20) — add `hongKongBusinessDate` to that same import:

```typescript
import {
  buildReminderDraft,
  completionBlockers,
  hongKongBusinessDate,
  isAllowedStatusTransition,
} from "./workflow";
```

In the `buildAnnualReturnReminderDraft` server fn (this is a preview-only endpoint with no recipient in scope — only `caseId`), replace:

```typescript
      return { draftBody: buildReminderDraft(case_) };
```

with:

```typescript
      return { draftBody: buildReminderDraft(case_, "貴公司", hongKongBusinessDate()) };
```

Also fix `queueAnnualReturnWhatsAppReminderMessageForActor`'s call into `queueAnnualReturnWhatsAppReminder`, which now requires `today`:

```typescript
  const result = await queueAnnualReturnWhatsAppReminder({
    annualReturnRepository: dependencies.annualReturnRepository,
    whatsAppRepository: dependencies.whatsAppRepository,
    case_: caseItem,
    actorId,
    recipientName: data.recipientName,
    recipientPhone: data.recipientPhone,
    today: hongKongBusinessDate(),
  });
```

`server-fns.authorization.test.ts` tests `buildAnnualReturnReminderDraft` for authorization scoping only (it never asserts on `draftBody`'s content), so it needs no changes.

### Step 9: Run all the tests

Run: `npm run test -- src/features/annual-return`
Expected: PASS, all tests in the whole `annual-return` feature directory (this touches enough call sites that a broader sweep is worth it, not just the individual files changed).

### Step 10: Verify

Run: `npx tsc --noEmit`
Expected: clean — this is the real proof every call site was actually found and fixed.

Run: `npm run lint`
Expected: clean, exit code checked directly.

### Step 11: Commit

```bash
git add src/features/annual-return/workflow.ts src/features/annual-return/workflow.test.ts \
  src/features/annual-return/whatsapp-reminders.ts src/features/annual-return/whatsapp-reminders.test.ts \
  src/features/annual-return/follow-ups.ts src/features/annual-return/follow-ups.test.ts \
  src/features/annual-return/follow-up-server-fns.ts src/features/annual-return/server-fns.ts
git commit -m "feat(annual-return): rewrite the reminder draft in Traditional Chinese"
```

---

## Task 4: `evaluateReminders` on `AnnualReturnRepository`

**Files:**
- Modify: `src/features/annual-return/repository.ts`
- Modify: `src/features/annual-return/repository.test.ts`

### Step 1: Extract `tryLockWritableCase`

Read `src/features/annual-return/repository.ts` in full first — this is a large file; every existing mutation (`assignOwner`, `addNote`, `updateStatus`, `recordReminder`, `updateChecklistItem`, `updatePayment`, `updateFilingProof`) depends on `lockWritableCase` behaving exactly as it does today.

Replace the current `lockWritableCase`:

```typescript
  async function lockWritableCase(
    tx: TransactionSqlClient,
    caseId: string,
  ): Promise<LockedCaseRow> {
    const rows = await tx<LockedCaseRow[]>`
      select
        arc.id,
        arc.company_id,
        c.company_name,
        c.assigned_team_id as company_team_id,
        arc.current_status,
        arc.owner_id,
        arc.reviewer_id,
        arc.filing_reference,
        arc.confirmation_document_id
      from annual_return_cases arc
      join companies c on c.id = arc.company_id
      where arc.id = ${caseId}
        and arc.locked_at is null
        and arc.completed_at is null
        and arc.current_status <> 'Completed'
      for update
    `;

    assertSingleMutatedRow(rows, COMPLETED_CASE_LOCKED_MESSAGE);
    return rows[0];
  }
```

with:

```typescript
  async function tryLockWritableCase(
    tx: TransactionSqlClient,
    caseId: string,
  ): Promise<LockedCaseRow | null> {
    const rows = await tx<LockedCaseRow[]>`
      select
        arc.id,
        arc.company_id,
        c.company_name,
        c.assigned_team_id as company_team_id,
        arc.current_status,
        arc.owner_id,
        arc.reviewer_id,
        arc.filing_reference,
        arc.confirmation_document_id
      from annual_return_cases arc
      join companies c on c.id = arc.company_id
      where arc.id = ${caseId}
        and arc.locked_at is null
        and arc.completed_at is null
        and arc.current_status <> 'Completed'
      for update
    `;

    return rows[0] ?? null;
  }

  async function lockWritableCase(
    tx: TransactionSqlClient,
    caseId: string,
  ): Promise<LockedCaseRow> {
    const lockedCase = await tryLockWritableCase(tx, caseId);
    if (!lockedCase) throw new Error(COMPLETED_CASE_LOCKED_MESSAGE);
    return lockedCase;
  }
```

This is a pure extraction — identical SQL, identical throw behavior for every existing caller.

Run: `npm run test -- src/features/annual-return/repository.test.ts`
Expected: PASS, unchanged, if `TEST_DATABASE_URL` is set in this environment. If it is not set, this suite is skipped — that's expected; confirm at minimum that `npx tsc --noEmit` is clean, proving every existing caller of `lockWritableCase` still type-checks.

Commit this extraction on its own before continuing:

```bash
git add src/features/annual-return/repository.ts
git commit -m "refactor(annual-return): extract a non-throwing tryLockWritableCase"
```

### Step 2: Write the failing tests for `evaluateReminders`

Read `src/features/annual-return/repository.test.ts` in full first — note its `createMutableAnnualReturnFixture({ sequence, currentStatus, ... })` helper (inserts a `companies` row and an `annual_return_cases` row with `filing_due_date` hardcoded to `'2026-08-12'`, plus supporting `documents`/checklist/payment rows), its `repositoryFor(today)` helper, `sqlForTests()`, and whatever `describe.skipIf(!databaseUrl)` structure wraps the file — match it exactly. Use fixture `sequence` numbers not already used elsewhere in this file (check the existing sequences in use first; the examples below use 24-28, adjust if those collide).

Add a new `describe` block:

```typescript
describe("evaluateReminders", () => {
  it("sends a milestone reminder to the primary contact and enqueues a WhatsApp notification", async () => {
    const fixture = await createMutableAnnualReturnFixture({ sequence: 24 });
    const sql = sqlForTests();
    await sql`
      insert into company_contacts (company_id, name, role, email, phone, is_primary)
      values (${fixture.companyId}, 'Ada Contact', 'Director', 'ada@example.test', '+85291234567', true)
    `;
    const repository = repositoryFor("2026-07-13"); // 30 days before the fixture's 2026-08-12 due date

    const result = await repository.evaluateReminders();

    expect(result).toEqual({ sent: 1, skipped: 0 });

    const eventRows = await sql<{ milestone: string }[]>`
      select milestone from annual_return_reminder_events where case_id = ${fixture.caseId}
    `;
    expect(eventRows).toEqual([{ milestone: "1_month" }]);

    const outboxRows = await sql<
      { channel: string; notification_type: string; recipient: string }[]
    >`
      select channel, notification_type, recipient from notification_outbox
      where company_id = ${fixture.companyId}
    `;
    expect(outboxRows).toEqual([
      {
        channel: "whatsapp",
        notification_type: "annual_return_reminder_1_month",
        recipient: "+85291234567",
      },
    ]);

    const updatedCase = await repository.getCase(fixture.caseId);
    expect(updatedCase?.remindersSent).toBe(1);
    expect(updatedCase?.currentStatus).toBe("Client reminder sent");

    const timelineRows = await sql<{ event_type: string; actor_type: string }[]>`
      select event_type, actor_type from timeline_events where case_id = ${fixture.caseId}
    `;
    expect(timelineRows).toEqual([{ event_type: "annual_return_reminder_sent", actor_type: "system" }]);
  }, INTEGRATION_TEST_TIMEOUT_MS);

  it("does not send a duplicate reminder for a milestone that already fired", async () => {
    const fixture = await createMutableAnnualReturnFixture({ sequence: 25 });
    const sql = sqlForTests();
    await sql`
      insert into company_contacts (company_id, name, role, email, phone, is_primary)
      values (${fixture.companyId}, 'Ada Contact', 'Director', 'ada@example.test', '+85291234567', true)
    `;
    const repository = repositoryFor("2026-07-13");

    await repository.evaluateReminders();
    const secondResult = await repository.evaluateReminders();

    expect(secondResult).toEqual({ sent: 0, skipped: 0 });
    const outboxRows = await sql`
      select id from notification_outbox where company_id = ${fixture.companyId}
    `;
    expect(outboxRows).toHaveLength(1);
  }, INTEGRATION_TEST_TIMEOUT_MS);

  it("chooses email when the primary contact has no phone", async () => {
    const fixture = await createMutableAnnualReturnFixture({ sequence: 26 });
    const sql = sqlForTests();
    await sql`
      insert into company_contacts (company_id, name, role, email, phone, is_primary)
      values (${fixture.companyId}, 'Ada Contact', 'Director', 'ada@example.test', null, true)
    `;
    const repository = repositoryFor("2026-07-13");

    await repository.evaluateReminders();

    const outboxRows = await sql<{ channel: string; recipient: string }[]>`
      select channel, recipient from notification_outbox where company_id = ${fixture.companyId}
    `;
    expect(outboxRows).toEqual([{ channel: "email", recipient: "ada@example.test" }]);
  }, INTEGRATION_TEST_TIMEOUT_MS);

  it("skips and logs a timeline event when no primary contact exists", async () => {
    const fixture = await createMutableAnnualReturnFixture({ sequence: 27 });
    const sql = sqlForTests();
    const repository = repositoryFor("2026-07-13");

    const result = await repository.evaluateReminders();

    expect(result).toEqual({ sent: 0, skipped: 1 });
    const outboxRows = await sql`
      select id from notification_outbox where company_id = ${fixture.companyId}
    `;
    expect(outboxRows).toHaveLength(0);
    const timelineRows = await sql<{ event_type: string }[]>`
      select event_type from timeline_events where case_id = ${fixture.caseId}
    `;
    expect(timelineRows).toEqual([{ event_type: "annual_return_reminder_skipped" }]);
  }, INTEGRATION_TEST_TIMEOUT_MS);

  it("never evaluates a Filed or Completed case", async () => {
    const fixture = await createMutableAnnualReturnFixture({
      sequence: 28,
      currentStatus: "Filed",
    });
    const sql = sqlForTests();
    await sql`
      insert into company_contacts (company_id, name, role, email, phone, is_primary)
      values (${fixture.companyId}, 'Ada Contact', 'Director', 'ada@example.test', '+85291234567', true)
    `;
    const repository = repositoryFor("2026-07-13");

    const result = await repository.evaluateReminders();

    expect(result).toEqual({ sent: 0, skipped: 0 });
  }, INTEGRATION_TEST_TIMEOUT_MS);
});
```

Run: `npm run test -- src/features/annual-return/repository.test.ts -t "evaluateReminders"`
Expected: FAIL — `evaluateReminders` does not exist on the repository yet. (If `TEST_DATABASE_URL` is not set, this suite skips entirely rather than failing — in that case, confirm the FAIL by temporarily checking `npx tsc --noEmit` reports `evaluateReminders` as missing from the type, then proceed; you will not get a red/green signal from the test runner itself in that environment.)

### Step 3: Implement `evaluateReminders`

In `src/features/annual-return/repository.ts`, add to the imports:

```typescript
import { enqueueNotification } from "@/features/notifications/outbox";
import { dueMilestone, type ReminderMilestone } from "./reminder-cadence";
```

Add `buildReminderDraft` to the existing `./workflow` import:

```typescript
import {
  buildReminderDraft,
  daysBetween,
  hongKongBusinessDate,
  isAllowedStatusTransition,
  riskForCase,
} from "./workflow";
```

Add `evaluateReminders(now?: string): Promise<{ sent: number; skipped: number }>;` to the `AnnualReturnRepository` type, after `assertCanMutateCase`:

```typescript
export type AnnualReturnRepository = {
  listCases(filters: CaseFilters): Promise<AnnualReturnCase[]>;
  getCase(id: string): Promise<AnnualReturnCase | null>;
  dashboardMetrics(
    today: string,
    currentUserId: string,
    scope?: CaseFilters,
  ): Promise<AnnualReturnDashboardMetrics>;
  assertCanMutateCase(caseId: string, actorId: string, action: AnnualReturnAction): Promise<void>;
  evaluateReminders(now?: string): Promise<{ sent: number; skipped: number }>;
  updateStatus(
    caseId: string,
    nextStatus: AnnualReturnStatus,
    actorId: string,
  ): Promise<AnnualReturnCase>;
  assignOwner(input: AssignAnnualReturnOwnerInput): Promise<AnnualReturnCase>;
  listNotes(caseId: string): Promise<AnnualReturnCaseNote[]>;
  addNote(input: AddAnnualReturnCaseNoteInput): Promise<AnnualReturnCaseNote>;
  recordReminder(input: RecordAnnualReturnReminderInput): Promise<AnnualReturnCase>;
  updateChecklistItem(input: UpdateAnnualReturnChecklistItemInput): Promise<AnnualReturnCase>;
  updatePayment(input: UpdateAnnualReturnPaymentInput): Promise<AnnualReturnCase>;
  updateFilingProof(input: UpdateAnnualReturnFilingProofInput): Promise<AnnualReturnCase>;
  close(): Promise<void>;
};
```

Add the implementation, right after `assertCanMutateCase`'s implementation (before `close`):

```typescript
  async function evaluateReminders(
    now: string = readToday(),
  ): Promise<{ sent: number; skipped: number }> {
    const candidates = await listCasesForToday({ limit: DASHBOARD_METRICS_SCAN_LIMIT }, now);
    const openCases = candidates.filter(
      (case_) => case_.currentStatus !== "Filed" && case_.currentStatus !== "Completed",
    );

    let sent = 0;
    let skipped = 0;

    for (const case_ of openCases) {
      const outcome = await withTransaction(sql, async (tx) => {
        const lockedCase = await tryLockWritableCase(tx, case_.id);
        if (!lockedCase) return null;

        const firedRows = await tx<{ milestone: ReminderMilestone }[]>`
          select milestone from annual_return_reminder_events where case_id = ${case_.id}
        `;
        const milestone = dueMilestone(
          case_.filingDueDate,
          now,
          firedRows.map((row) => row.milestone),
        );
        if (!milestone) return null;

        const insertedEvent = await tx<{ id: string }[]>`
          insert into annual_return_reminder_events (case_id, milestone, occurred_at)
          values (${case_.id}, ${milestone}, ${now})
          on conflict (case_id, milestone) do nothing
          returning id
        `;
        if (!insertedEvent[0]) return null;

        const contactRows = await tx<{ name: string; email: string | null; phone: string | null }[]>`
          select name, email, phone from company_contacts
          where company_id = ${lockedCase.company_id} and is_primary = true
          limit 1
        `;
        const contact = contactRows[0];

        if (!contact) {
          await tx`
            insert into timeline_events (
              company_id, case_id, event_type, actor_type, actor_id, description, metadata
            ) values (
              ${lockedCase.company_id}, ${case_.id}, 'annual_return_reminder_skipped',
              'system', null, 'Automated reminder skipped: no primary contact on file.',
              ${tx.json({ milestone, reason: "no_primary_contact" })}
            )
          `;
          return "skipped" as const;
        }

        const channel: "whatsapp" | "email" = contact.phone ? "whatsapp" : "email";
        const recipient = contact.phone ?? contact.email;
        if (!recipient) throw new Error("Primary contact has neither phone nor email.");

        await enqueueNotification(tx, {
          companyId: lockedCase.company_id,
          channel,
          notificationType: `annual_return_reminder_${milestone}`,
          recipient,
          payload: {
            caseId: case_.id,
            milestone,
            subject: `「${case_.companyName}」周年申報表提醒 — 請於 ${case_.filingDueDate} 前提供文件`,
            body: buildReminderDraft(case_, contact.name, now),
          },
        });

        await tx`
          update annual_return_cases
          set reminders_sent = reminders_sent + 1,
              current_status = case
                when current_status = 'Upcoming' then 'Client reminder sent'
                else current_status
              end,
              updated_at = now()
          where id = ${case_.id}
        `;

        await tx`
          insert into timeline_events (
            company_id, case_id, event_type, actor_type, actor_id, description, metadata
          ) values (
            ${lockedCase.company_id}, ${case_.id}, 'annual_return_reminder_sent',
            'system', null, 'Automated reminder sent.',
            ${tx.json({ milestone, channel })}
          )
        `;

        return "sent" as const;
      });

      if (outcome === "sent") sent += 1;
      else if (outcome === "skipped") skipped += 1;
    }

    return { sent, skipped };
  }
```

Add `evaluateReminders` to the returned object at the end of `createAnnualReturnRepository`:

```typescript
  return {
    listCases,
    getCase,
    dashboardMetrics,
    assertCanMutateCase,
    evaluateReminders,
    assignOwner,
    listNotes,
    addNote,
    updateStatus,
    recordReminder,
    updateChecklistItem,
    updatePayment,
    updateFilingProof,
    close,
  };
```

### Step 4: Run the tests

Run: `npm run test -- src/features/annual-return/repository.test.ts`
Expected: PASS, all cases including every pre-existing test in the file (if `TEST_DATABASE_URL` is set) — this proves the `tryLockWritableCase` extraction from Step 1 didn't break any existing mutation.

### Step 5: Verify

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm run lint`
Expected: clean, exit code checked directly.

### Step 6: Commit

```bash
git add src/features/annual-return/repository.ts src/features/annual-return/repository.test.ts
git commit -m "feat(annual-return): add the automated reminder evaluation pass"
```

---

## Task 5: Wire `evaluateReminders` through the maintenance cron

**Files:**
- Modify: `src/server/cron.ts`
- Modify: `src/server/cron.test.ts`
- Modify: `src/server/maintenance.ts`
- Modify: `src/server/maintenance.test.ts`

### Step 1: Write the failing test for the new pipeline step

Read `src/server/cron.test.ts` in full first (it's short — one test, asserting call order via a `calls` array).

Replace the whole test body:

```typescript
import { describe, expect, it, vi } from "vitest";
import { runScheduledMaintenance } from "./cron";

describe("scheduled maintenance", () => {
  it("evaluates escalations and reminders, dispatches a bounded batch, and cleans expired uploads", async () => {
    const calls: string[] = [];
    const result = await runScheduledMaintenance(
      "2026-07-12T00:00:00.000Z",
      {
        evaluateEscalations: vi.fn(async () => {
          calls.push("escalations");
          return { warnings: 1, breaches: 2 };
        }),
        evaluateAnnualReturnReminders: vi.fn(async () => {
          calls.push("annual-return-reminders");
          return { sent: 1, skipped: 0 };
        }),
        dispatchDue: vi.fn(async (_now, limit) => {
          calls.push(`dispatch:${limit}`);
          return { claimed: 1, sent: 1, retried: 0, permanentlyFailed: 0, superseded: 0 };
        }),
        cleanupExpiredUploads: vi.fn(async () => {
          calls.push("uploads");
          return { expired: 3 };
        }),
        failStrandedNotifications: vi.fn(async () => {
          calls.push("stranded");
          return { failed: 2 };
        }),
        redactNotifications: vi.fn(async () => {
          calls.push("redact");
          return { redacted: 4 };
        }),
      },
      { dispatchLimit: 7 },
    );
    expect(result).toMatchObject({
      escalations: { warnings: 1, breaches: 2 },
      annualReturnReminders: { sent: 1, skipped: 0 },
      dispatch: { sent: 1 },
      uploads: { expired: 3 },
      notifications: { strandedFailed: 2, redacted: 4 },
    });
    expect(calls).toEqual([
      "escalations",
      "annual-return-reminders",
      "stranded",
      "dispatch:7",
      "uploads",
      "redact",
    ]);
  });
});
```

Run: `npm run test -- src/server/cron.test.ts`
Expected: FAIL — `runScheduledMaintenance` doesn't accept `evaluateAnnualReturnReminders` yet, and the result has no `annualReturnReminders` field.

### Step 2: Implement the `cron.ts` change

Replace `src/server/cron.ts` in full:

```typescript
import type { DispatchSummary } from "@/features/notifications/types";

export type ScheduledMaintenanceDependencies = {
  evaluateEscalations(now: string): Promise<{ warnings: number; breaches: number }>;
  evaluateAnnualReturnReminders(now: string): Promise<{ sent: number; skipped: number }>;
  dispatchDue(now: string, limit: number): Promise<DispatchSummary>;
  cleanupExpiredUploads(now: string): Promise<{ expired: number }>;
  failStrandedNotifications(now: string): Promise<{ failed: number }>;
  redactNotifications(now: string): Promise<{ redacted: number }>;
};

export type ScheduledMaintenanceResult = {
  now: string;
  escalations: { warnings: number; breaches: number };
  annualReturnReminders: { sent: number; skipped: number };
  dispatch: DispatchSummary;
  uploads: { expired: number };
  notifications: { strandedFailed: number; redacted: number };
};

export async function runScheduledMaintenance(
  now: string,
  dependencies: ScheduledMaintenanceDependencies,
  options: { dispatchLimit?: number } = {},
): Promise<ScheduledMaintenanceResult> {
  const escalations = await dependencies.evaluateEscalations(now);
  const annualReturnReminders = await dependencies.evaluateAnnualReturnReminders(now);
  // Before dispatch: a row stranded on its final attempt is unreclaimable and
  // unredactable, so it is finalised here rather than sitting invisible forever.
  const stranded = await dependencies.failStrandedNotifications(now);
  const dispatch = await dependencies.dispatchDue(now, options.dispatchLimit ?? 50);
  const uploads = await dependencies.cleanupExpiredUploads(now);
  // Last: redaction is housekeeping, and running it after the dispatch pass means
  // a row settled in this same run is not considered until the next.
  const redaction = await dependencies.redactNotifications(now);
  return {
    now,
    escalations,
    annualReturnReminders,
    dispatch,
    uploads,
    notifications: { strandedFailed: stranded.failed, redacted: redaction.redacted },
  };
}
```

### Step 3: Run the `cron.ts` test

Run: `npm run test -- src/server/cron.test.ts`
Expected: PASS.

### Step 4: Write the failing test for `maintenance.ts`

Read `src/server/maintenance.ts` and `src/server/maintenance.test.ts` in full first.

In `maintenance.test.ts`, add a `createAnnualReturnRepository` entry to the `dependencies()` fixture:

```typescript
function dependencies(
  overrides: Partial<FirmMaintenanceDependencies> = {},
): FirmMaintenanceDependencies {
  return {
    createWorkItemRepository: () => ({
      evaluateEscalations: vi.fn(async () => ({ warnings: 1, breaches: 2 })),
      close: vi.fn(async () => {}),
    }),
    createAnnualReturnRepository: () => ({
      evaluateReminders: vi.fn(async () => ({ sent: 1, skipped: 0 })),
      close: vi.fn(async () => {}),
    }),
    dispatchDue: vi.fn(async () => ({
      claimed: 4,
      sent: 3,
      retried: 1,
      permanentlyFailed: 0,
      superseded: 0,
    })),
    createDocumentRepository: () => ({
      expireUploads: vi.fn(async () => [{ objectKey: "a" }, { objectKey: "b" }]),
      close: vi.fn(async () => {}),
    }),
    createDocumentStorage: () => ({ delete: vi.fn(async () => {}) }),
    createOutboxRepository: () => ({
      failStranded: vi.fn(async () => ({ failed: 2 })),
      redactExpired: vi.fn(async () => ({ redacted: 5 })),
      close: vi.fn(async () => {}),
    }),
    ...overrides,
  };
}
```

Update the first test's assertion to include the new field:

```typescript
    expect(result).toEqual({
      now: "2026-07-26T00:00:00.000Z",
      escalations: { warnings: 1, breaches: 2 },
      annualReturnReminders: { sent: 1, skipped: 0 },
      dispatch: { claimed: 4, sent: 3, retried: 1, permanentlyFailed: 0, superseded: 0 },
      uploads: { expired: 2 },
      notifications: { strandedFailed: 2, redacted: 5 },
    });
```

Update the `"closes both repositories even when a pass throws"` test to also verify the new repository closes:

```typescript
  it("closes every repository even when a pass throws", async () => {
    const closeWorkItems = vi.fn(async () => {});
    const closeAnnualReturns = vi.fn(async () => {});
    const closeDocuments = vi.fn(async () => {});

    // Escalation evaluation runs first, so its failure is the case that would
    // leak a Postgres connection for every later pass as well.
    await expect(
      runFirmMaintenanceWithDependencies(
        { now: "2026-07-26T00:00:00.000Z" },
        dependencies({
          createWorkItemRepository: () => ({
            evaluateEscalations: vi.fn(async () => {
              throw new Error("sla sweep failed");
            }),
            close: closeWorkItems,
          }),
          createAnnualReturnRepository: () => ({
            evaluateReminders: vi.fn(async () => ({ sent: 0, skipped: 0 })),
            close: closeAnnualReturns,
          }),
          createDocumentRepository: () => ({
            expireUploads: vi.fn(async () => []),
            close: closeDocuments,
          }),
        }),
      ),
    ).rejects.toThrow("sla sweep failed");

    expect(closeWorkItems).toHaveBeenCalledTimes(1);
    expect(closeAnnualReturns).toHaveBeenCalledTimes(1);
    expect(closeDocuments).toHaveBeenCalledTimes(1);
  });
```

Run: `npm run test -- src/server/maintenance.test.ts`
Expected: FAIL — `FirmMaintenanceDependencies` doesn't have `createAnnualReturnRepository` yet.

### Step 5: Implement the `maintenance.ts` change

Replace `src/server/maintenance.ts` in full:

```typescript
import { z } from "zod";

import type { DispatchSummary } from "@/features/notifications/types";
import { runScheduledMaintenance, type ScheduledMaintenanceResult } from "./cron";

/**
 * Actor-free assembly of the periodic maintenance passes.
 *
 * `runScheduledMaintenance` in ./cron.ts has always been pure and tested, but
 * nothing ever called it: `wrangler.template.jsonc` declares a 5-minute cron
 * while the Worker exposed only `fetch`, so SLA escalations were never
 * evaluated, the notification outbox was never dispatched, and expired upload
 * intents were never reclaimed.
 *
 * This module supplies the missing half — the real repositories and storage —
 * without going through `server-fns.ts`. Those handlers all derive an actor
 * from the incoming request (`requireStaffActor`, and an Admin check on
 * `cleanupExpiredUploads`), which a scheduler has no way to satisfy. Trigger
 * mechanisms stay out of here deliberately, so the same entrypoint serves the
 * Cloudflare `cloudflare:scheduled` nitro hook, a platform cron route, or an
 * operator running it by hand.
 */

const inputSchema = z
  .object({
    now: z.string().datetime(),
    dispatchLimit: z.number().int().min(1).max(500).optional(),
  })
  .strict();

export type FirmMaintenanceInput = { now: string; dispatchLimit?: number };

type MaintenanceWorkItemRepository = {
  evaluateEscalations(now?: string): Promise<{ warnings: number; breaches: number }>;
  close(): Promise<void>;
};

type MaintenanceAnnualReturnRepository = {
  evaluateReminders(now?: string): Promise<{ sent: number; skipped: number }>;
  close(): Promise<void>;
};

type MaintenanceDocumentRepository = {
  expireUploads(now: string): Promise<readonly { objectKey: string }[]>;
  close(): Promise<void>;
};

type MaintenanceOutboxRepository = {
  failStranded(now: string): Promise<{ failed: number }>;
  redactExpired(now: string): Promise<{ redacted: number }>;
  close(): Promise<void>;
};

export type FirmMaintenanceDependencies = {
  createWorkItemRepository(): MaintenanceWorkItemRepository;
  createAnnualReturnRepository(): MaintenanceAnnualReturnRepository;
  dispatchDue(input: { now: string; limit: number }): Promise<DispatchSummary>;
  createDocumentRepository(): MaintenanceDocumentRepository;
  createDocumentStorage(): { delete(objectKey: string): Promise<void> };
  createOutboxRepository(): MaintenanceOutboxRepository;
};

const DEFAULT_DISPATCH_LIMIT = 50;

export async function runFirmMaintenanceWithDependencies(
  input: FirmMaintenanceInput,
  dependencies: FirmMaintenanceDependencies,
): Promise<ScheduledMaintenanceResult> {
  const data = inputSchema.parse(input);

  // All four repositories open a Postgres connection eagerly, so they are
  // created up front and closed in one `finally`. Closing them inside each
  // pass would leak whichever connection the failing pass had already opened.
  const workItems = dependencies.createWorkItemRepository();
  const annualReturns = dependencies.createAnnualReturnRepository();
  const documents = dependencies.createDocumentRepository();
  const outbox = dependencies.createOutboxRepository();

  try {
    return await runScheduledMaintenance(
      data.now,
      {
        evaluateEscalations: (now) => workItems.evaluateEscalations(now),
        evaluateAnnualReturnReminders: (now) => annualReturns.evaluateReminders(now),
        dispatchDue: (now, limit) => dependencies.dispatchDue({ now, limit }),
        cleanupExpiredUploads: async (now) => {
          const expired = await documents.expireUploads(now);
          const storage = dependencies.createDocumentStorage();
          await Promise.all(expired.map((intent) => storage.delete(intent.objectKey)));
          return { expired: expired.length };
        },
        failStrandedNotifications: (now) => outbox.failStranded(now),
        redactNotifications: (now) => outbox.redactExpired(now),
      },
      { dispatchLimit: data.dispatchLimit ?? DEFAULT_DISPATCH_LIMIT },
    );
  } finally {
    await Promise.all([
      workItems.close(),
      annualReturns.close(),
      documents.close(),
      outbox.close(),
    ]);
  }
}

/**
 * Production wiring. Imports are deferred so this module stays loadable from
 * tests and offline validators that have no database binding.
 */
export async function runFirmMaintenance(
  input: FirmMaintenanceInput,
): Promise<ScheduledMaintenanceResult> {
  const [
    workItemsModule,
    annualReturnModule,
    documentsModule,
    dispatchModule,
    documentServerFnsModule,
    providerModeModule,
    runtimeEnvModule,
    outboxModule,
  ] = await Promise.all([
    import("@/features/work-items/repository"),
    import("@/features/annual-return/repository"),
    import("@/features/documents/repository"),
    import("@/features/notifications/runtime-dispatch"),
    import("@/features/documents/server-fns"),
    import("@/server/provider-mode"),
    import("@/server/runtime-env"),
    import("@/features/notifications/outbox"),
  ]);

  return runFirmMaintenanceWithDependencies(input, {
    createWorkItemRepository: () => workItemsModule.createWorkItemRepository(),
    createAnnualReturnRepository: () => annualReturnModule.createAnnualReturnRepository(),
    createDocumentRepository: () => documentsModule.createDocumentRepository(),
    createOutboxRepository: () => outboxModule.createNotificationOutboxRepository(),
    dispatchDue: (dispatchInput) => dispatchModule.dispatchDueNotificationsOnServer(dispatchInput),
    createDocumentStorage: () => {
      // Live mode throws without a real bucket, so resolve the binding the same
      // way the request-scoped document context does.
      const providerMode = providerModeModule.currentProviderMode();
      return documentServerFnsModule.createDocumentStorageForProviderMode(
        providerMode,
        providerMode === "live" ? runtimeEnvModule.getFirmRuntimeEnv().documentsBucket : undefined,
      );
    },
  });
}
```

### Step 6: Run the tests

Run: `npm run test -- src/server/maintenance.test.ts src/server/cron.test.ts`
Expected: PASS, all cases including every pre-existing test in both files.

### Step 7: Verify

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm run lint`
Expected: clean, exit code checked directly.

### Step 8: Commit

```bash
git add src/server/cron.ts src/server/cron.test.ts src/server/maintenance.ts src/server/maintenance.test.ts
git commit -m "feat(annual-return): wire the reminder cadence into the maintenance cron"
```

---

## Task 6: Full verification sweep

**Files:** none modified.

- [x] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [x] **Step 2: Lint**

Run: `npm run lint`
Expected: clean. Confirm the exit code directly (run it unpiped, or check `$?` immediately after) — a piped `tail`/`head` summary reports the pipe's own exit code, not lint's.

- [x] **Step 3: Full suite**

Run: `npm run test`
Expected: PASS, with a total no lower than this branch's baseline before Task 1. If `TEST_DATABASE_URL` is not set in this environment, Task 4's new `evaluateReminders` tests (and every other repository integration test) will report as skipped, not failed — that is the expected, pre-existing behavior for this test suite, not a regression.

- [x] **Step 4: Confirm the migration is syntactically sound**

If a local test database is available (`TEST_DATABASE_URL` set), run `npm run db:migrate` (per `CLAUDE.md`, via Bun) against it and confirm migration `0012` applies cleanly. If not available in this environment, at minimum confirm the SQL in `db/migrations/0012_annual_return_reminder_events.sql` matches `src/server/db/schema.sql`'s copy exactly.

- [x] **Step 5: Confirm every `buildReminderDraft` call site was actually found**

Run: `grep -rn "buildReminderDraft(" src/ --include=*.ts | grep -v ".test.ts"`
Expected: every production call site listed passes three arguments (`case_`, a contact name, and `today`) — none should still show the old single-argument form. Also run the same grep including test files, and confirm every one compiles (already proven by Step 1's clean `tsc`, but worth eyeballing that none were silently skipped).

- [ ] **Step 6: Commit and open the PR**

```bash
git push -u origin codex/annual-return-reminder-cadence
```

---

## Acceptance: what "done" means

The suite proves the milestone selection logic, the Chinese content, and the evaluation pass's database interactions are correct in isolation (where `TEST_DATABASE_URL` is available) or by type-checking (where it isn't). It cannot prove a WhatsApp message or email actually arrives at a real client's phone — that's the same class of gap P0-6 and the WOZTELL work both flagged for their own live verification. Before trusting this in production:

1. With a real `company_contacts` primary contact and valid WOZTELL/Resend credentials, let a real case cross a milestone threshold (or call `evaluateReminders` manually against a test case) and confirm the client actually receives the Traditional Chinese message, on the channel their contact record implies.
2. Confirm a second cron tick against the same case does not re-send.
3. Confirm the existing manual "send reminder now" button and the follow-up drafts list both still work end-to-end in the UI, now showing Chinese content.

## Out of scope

Per-case opt-out/suppression flag, translating checklist item labels, cross-channel retry-on-failure, any new staff-facing UI, and doc 03's long-form annex (fee schedule, FAQ, penalty table) — all explicitly declined during design. See the design spec's own "Out of scope" section for the full reasoning on each.
