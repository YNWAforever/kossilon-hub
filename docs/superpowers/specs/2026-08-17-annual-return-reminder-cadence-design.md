# Automated Annual-Return Reminder Cadence Design

## Problem

`annual_return_cases` reminders are entirely manual today: a staff member clicks "send reminder" (`src/features/annual-return/whatsapp-reminders.ts`), or reviews a follow-up drafts list (`src/features/annual-return/follow-ups.ts`) and sends by hand. Nothing watches the calendar. Per the roadmap (P1-2) and the firm's own reminder-cadence document (`03-周年申報提醒-客戶版.md`), reminders should go out automatically at three fixed points before a case's filing deadline — 1 month, 2 weeks, and 1 week before — without staff having to remember to trigger them, and the message content should be the firm's actual Traditional Chinese client-facing copy rather than the current English placeholder text.

This depends on P0-6 (live email transport, merged in PR #38), since the agreed design sends WhatsApp when possible and falls back to email — both channels needed to actually be wired up in live mode first.

## Architecture

A new pass, `evaluateAnnualReturnReminders`, added to the existing 5-minute maintenance cron — the same mechanism that already runs `evaluateEscalations` (work-item SLA) and `dispatchDueNotificationsOnServer` (the P0-6 notification dispatcher) every tick. No new scheduling infrastructure: idempotency prevents duplicate sends across ticks, the same way SLA escalations already do it.

```
cron tick (every 5 min)
  → evaluateEscalations           (existing)
  → evaluateAnnualReturnReminders (NEW — this design)
  → failStrandedNotifications     (existing)
  → dispatchDue                   (existing — picks up what the two evaluate passes just enqueued)
  → cleanupExpiredUploads         (existing)
  → redactNotifications           (existing)
```

Placed before `dispatchDue`, exactly like `evaluateEscalations`, so a reminder enqueued this tick is dispatched in the same tick.

## Milestone tracking & idempotency

New table, migration `0012_annual_return_reminder_events.sql`, mirroring the existing `escalation_events` table (`src/features/work-items/repository.ts`) that already solves this same problem for SLA warnings/breaches:

```sql
create table if not exists annual_return_reminder_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references annual_return_cases(id) on delete cascade,
  milestone text not null check (milestone in ('1_month', '2_week', '1_week')),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (case_id, milestone)
);

create index if not exists annual_return_reminder_events_case_idx
  on annual_return_reminder_events (case_id);
```

**Why a dedicated table, not a derived check against `notification_outbox`:** outbox rows are redacted after `retentionUntil` (the existing `redactNotifications` maintenance pass). If "has this milestone already fired" were derived by querying the outbox for a matching `notificationType`, that answer would silently become wrong once the row aged out, and a milestone could re-fire. A dedicated table with `unique (case_id, milestone)` and an `on conflict do nothing` insert is a permanent record of "did this business event happen," independent of delivery-queue housekeeping — exactly why `escalation_events` exists as its own table rather than being derived from the outbox.

**Milestone selection — a pure function:**

```typescript
export type ReminderMilestone = "1_month" | "2_week" | "1_week";

const MILESTONE_OFFSET_DAYS: Record<ReminderMilestone, number> = {
  "1_month": 30,
  "2_week": 14,
  "1_week": 7,
};

// Most urgent first — the walk order matters, see below.
const MILESTONES_BY_URGENCY: ReminderMilestone[] = ["1_week", "2_week", "1_month"];

export function dueMilestone(
  filingDueDate: string,
  today: string,
  firedMilestones: readonly ReminderMilestone[],
): ReminderMilestone | null {
  const daysRemaining = Math.round(
    (Date.parse(`${filingDueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      (24 * 60 * 60 * 1000),
  );

  for (const milestone of MILESTONES_BY_URGENCY) {
    if (daysRemaining <= MILESTONE_OFFSET_DAYS[milestone]) {
      return firedMilestones.includes(milestone) ? null : milestone;
    }
  }
  return null;
}
```

Walking from most urgent (`1_week`) to least (`1_month`) and returning based on the *first numerically-due* milestone — firing it if unfired, or returning `null` immediately if it already fired — gives "fire only the most urgent applicable one" for free. A case created 10 days before its deadline has `daysRemaining` already under both the 30-day and 14-day thresholds, but the loop hits `1_week`'s 7-day threshold first, finds it not yet due (10 > 7), and moves on to `2_week` (10 ≤ 14, unfired) and returns that — `1_month` is never considered. Critically, the function must stop at the first numerically-due milestone regardless of whether that one has already fired — an earlier draft kept walking to the next, less-urgent milestone whenever the current one turned out to be already-fired, which meant a case eligible late would fire `1_week` on one tick, then `2_week` on the very next tick, then `1_month` on the one after that, cascading through all three within minutes. Returning `null` as soon as the most-urgent-due milestone is found already-fired — never falling through to a less-urgent one — is what actually makes "a milestone whose window has already passed by the time a case became eligible simply never gets a row" true.

## Recipient resolution & channel selection

Per case, at evaluation time:

```sql
select name, email, phone from company_contacts
where company_id = $1 and is_primary = true
limit 1
```

- **No primary contact found:** skip this case entirely (no notification enqueued, no `annual_return_reminder_events` row inserted — the milestone stays eligible to fire on a later tick once a primary contact exists), and record a `timeline_events` row so the gap is visible to staff without new UI (see below).
- **Primary contact found:** channel is chosen once — WhatsApp if `phone` is set, else email if `email` is set. (`company_contacts_reachable_check` guarantees at least one is set, so this always resolves.) This is a single choice at enqueue time, not a retry-on-failure mechanism — if the chosen channel's send later fails, it fails the same way any other outbox notification fails (retry/fail per `notification_outbox`'s existing semantics), it does not fall over to the other channel.

## Content: Traditional Chinese rewrite

`buildReminderDraft` (`src/features/annual-return/workflow.ts`) is rewritten in Traditional Chinese, replacing the current English text for **all three** existing callers: the manual "send reminder now" flow (`whatsapp-reminders.ts`), the follow-up drafts list (`follow-ups.ts`), and this new automated pass. One template, no drift between manual and automated wording.

Adapted from `03-周年申報提醒-客戶版.md` §一 (the short WhatsApp/email body — not the long-form annex, which stays entirely out of scope). Dropped relative to the source document: the named-colleague greeting (there's no individual staff member behind an automated send) and the "see attachment" reference (there's no attachment mechanism in this notification pipeline — items are already listed inline in the body, which the existing English draft already does the same way).

```typescript
export function buildReminderDraft(
  case_: AnnualReturnCase,
  contactName: string,
  today: string,
): string {
  const missingItems = case_.checklist.filter(
    (item) => item.required && item.status !== "Verified",
  );
  const daysRemaining = Math.round(
    (Date.parse(`${case_.filingDueDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) /
      (24 * 60 * 60 * 1000),
  );

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

Note the signature gains required `contactName` and `today` parameters — `today` is explicit rather than reaching for the wall clock internally, matching this codebase's convention of pure, deterministically-testable domain logic (the same reason `hongKongBusinessDate` exists as an injectable "what is today" helper elsewhere in this file). Both existing manual callers already have a resolved recipient name in scope (`recipientName`) and can call `hongKongBusinessDate()` for `today` the same way other call sites in this feature do; only the call sites change, not their behavior.

The email-fallback subject (read by `resend-transport.ts` from `payload.subject`; WhatsApp ignores it) follows the source document's own subject line: `` `「${case_.companyName}」周年申報表提醒 — 請於 ${case_.filingDueDate} 前提供文件` ``.

**Known tradeoff, confirmed acceptable:** `item.itemLabel` is free text staff enter per case (currently always English — "Signed NAR1", "Director details", etc.), not drawn from a translatable fixed set. The rewritten template's boilerplate is fully Traditional Chinese; the interpolated item names stay whatever language they were entered in. Translating item labels would need a schema change (a lookup table or a parallel column) and is explicitly out of scope for this feature.

## Case updates & audit trail

On a successful send: increment `reminders_sent`, and advance `current_status` from `'Upcoming'` to `'Client reminder sent'` if it's still `'Upcoming'` (leave any other status alone). This mirrors `recordReminder`'s existing bookkeeping in `repository.ts` — but `evaluateAnnualReturnReminders` cannot call `recordReminder` itself, since that function requires and authorizes a human `actorId` via `assertActorCanMutateLockedCase`, which a cron pass has no way to satisfy. The new method does the equivalent field update directly, scoped to just `reminders_sent`/`current_status`, inside the same transaction as the `annual_return_reminder_events` insert.

Both outcomes get a `timeline_events` row — this table already supports `actor_type: 'system'` in its schema (`company_id, case_id, event_type, actor_type, actor_id, description, metadata`), though nothing in the codebase uses that value yet:

- Sent: `event_type: 'annual_return_reminder_sent'`, `actor_type: 'system'`, `actor_id: null`, `metadata: {milestone, channel}`.
- Skipped (no primary contact): `event_type: 'annual_return_reminder_skipped'`, `actor_type: 'system'`, `actor_id: null`, `metadata: {milestone, reason: 'no_primary_contact'}`.

This makes the automated cadence visible in the case's existing timeline UI with zero new screens.

## Repository shape

New method on `AnnualReturnRepository` (`src/features/annual-return/repository.ts`), mirroring `WorkItemRepository.evaluateEscalations`'s shape exactly:

```typescript
evaluateReminders(now?: string): Promise<{ sent: number; skipped: number }>;
```

Wired through `maintenance.ts` (`FirmMaintenanceDependencies` gains `evaluateAnnualReturnReminders`, sourced from a new `MaintenanceAnnualReturnRepository` type, mirroring `MaintenanceWorkItemRepository`) and `cron.ts` (`ScheduledMaintenanceDependencies` gains `evaluateAnnualReturnReminders(now): Promise<{ sent: number; skipped: number }>`, called in `runScheduledMaintenance` right after `evaluateEscalations`).

## Testing

- `dueMilestone` as a pure function: no milestone due yet; each of the three milestones due in the normal sequential case; the late-start catch-up case (skips straight to the most urgent, earlier ones never fire); a milestone already fired (not re-selected); an overdue case with nothing fired yet.
- `buildReminderDraft`'s Chinese output: with outstanding items, with none, at a few different `today`/`filingDueDate` distances (confirming the days-remaining count), and confirming both existing callers (`whatsapp-reminders.ts`, `follow-ups.ts`) still compile and pass with the new `contactName`/`today` parameters.
- `evaluateReminders` against a fake repository/fake clock, mirroring how `evaluateEscalations` is tested today: fires the right milestone, respects the event-table idempotency (calling it twice in the same tick-equivalent only sends once), skips and logs when no primary contact exists, chooses WhatsApp vs. email correctly from contact data, and correctly leaves Filed/Completed cases alone.
- Full suite + `tsc --noEmit` + `lint`, same discipline as P0-6.

## Out of scope

- Per-case opt-out/suppression flag — declined; the only suppression is the existing Filed/Completed check `follow-ups.ts` already has.
- Translating checklist item labels — declined; see the tradeoff noted above.
- Cross-channel retry-on-failure — declined; channel is chosen once per reminder, not retried on the other channel if the send fails.
- Any new staff-facing UI — the existing case timeline (via `timeline_events`) covers visibility.
- Doc 03's long-form annex (fee schedule, FAQ, penalty table detail) — this feature only automates §一, the short message body; the annex was never in scope for the automated cadence.
- Changes to the manual "send reminder now" button's own trigger/authorization flow — only the shared draft content changes, not how or when staff can still send manually.

## Acceptance

1. A case crossing a milestone threshold (in normal sequence, and in the late-created catch-up scenario) gets exactly one reminder per milestone, on the correct channel, in Traditional Chinese, with `reminders_sent`/`current_status` and `timeline_events` updated accordingly.
2. Re-running the evaluation pass against the same case and "now" never sends a duplicate.
3. A Filed or Completed case is never evaluated.
4. A case with no primary contact is skipped and the gap is visible in its timeline, not silently dropped.
5. The existing manual reminder button and follow-up drafts list both still work, now showing the Chinese template.
