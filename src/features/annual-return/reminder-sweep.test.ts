import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseAnnualReturnReminderKey } from "./reminder-idempotency-key";

/**
 * evaluateReminders is DB-backed, so these assert on the SHAPE of the sweep's SQL
 * rather than on its behaviour — the behavioural assertions live in the
 * database-backed half of repository.test.ts. Ordering inside one transaction is
 * exactly the kind of defect a string assertion can catch and a green no-database
 * CI cannot.
 */
const source = readFileSync(new URL("./repository.ts", import.meta.url), "utf8");
const sweep = source.slice(
  source.indexOf("async function evaluateReminders"),
  source.indexOf("async function close()"),
);
// Module scope because two describes below assert on the same reconciler.
const reconcile = source.slice(
  source.indexOf("async function reconcileFailedReminders"),
  source.indexOf("async function evaluateReminders"),
);

/**
 * The milestone row is what stops a client being reminded twice for the same
 * deadline, and it was inserted BEFORE the sweep had decided whether to send at
 * all. The `nothing_outstanding` and `no_primary_contact` branches then returned
 * "skipped" — and committed. The milestone was spent on a reminder that was never
 * sent, so dueMilestone never fired again: add the missing contact a day later and
 * the client still hears nothing before their statutory deadline.
 */
describe("a skipped annual-return milestone is not consumed", () => {
  it("only records the milestone once the sweep has committed to sending", () => {
    const insertMilestone = sweep.indexOf("insert into annual_return_reminder_events");
    expect(insertMilestone).toBeGreaterThan(-1);

    for (const reason of ["nothing_outstanding", "no_primary_contact"]) {
      expect(
        sweep.indexOf(reason),
        `the ${reason} skip still runs after the milestone is spent`,
      ).toBeLessThan(insertMilestone);
    }
  });

  // The other half of the finding: a milestone genuinely sent must still never
  // fire twice, so the insert has to stay ahead of the enqueue and keep its
  // conflict guard.
  it("still spends the milestone before queueing the message", () => {
    const insertMilestone = sweep.indexOf("insert into annual_return_reminder_events");
    expect(insertMilestone).toBeLessThan(sweep.indexOf("enqueueNotification(tx"));
    expect(sweep).toContain("on conflict (case_id, milestone) do nothing");
  });

  /**
   * Not consuming the milestone means the sweep re-evaluates this case every
   * five minutes until the condition clears. Writing an identical timeline event
   * on every tick would bury the case history it is meant to explain, so the skip
   * is recorded once per (case, milestone, reason).
   */
  it("records a repeating skip once rather than on every cron tick", () => {
    expect(sweep).toContain("where not exists");
    expect(sweep).toContain("metadata->>'reason'");
  });
});

/**
 * reminders_sent + 1, current_status 'Client reminder sent' and an
 * "Automated reminder sent." timeline event were all written in the ENQUEUE
 * transaction — before anything had been dispatched, let alone delivered. If the
 * outbox row then failed terminally nothing reconciled it: the milestone row
 * already existed so dueMilestone never fired again, and the case asserted, to
 * staff and to any audit of the firm, that the client had been reminded.
 */
describe("a reminder that never went out stops claiming it did", () => {
  it("exists and is driven by the same cron pass that enqueues", () => {
    expect(reconcile.length).toBeGreaterThan(0);
    expect(sweep).toContain("reconcileFailedReminders(now)");
  });

  it("only acts on outbox rows that can never be sent", () => {
    expect(reconcile).toContain("annual-return-reminder:%");
    expect(reconcile).toContain("attempt_count >= max_attempts");
    expect(reconcile).toContain("'cancelled'");
  });

  it("retracts the claim and says so on the timeline", () => {
    expect(reconcile).toContain("annual_return_reminder_failed");
    expect(reconcile).toContain("reminders_sent = greatest(reminders_sent - 1, 0)");
    expect(reconcile).toContain("'Client reminder sent'");
  });

  /**
   * It runs every five minutes forever, so a second pass over the same row must
   * not decrement the counter again — and the key it matches on has to survive
   * retention redaction, which nulls the payload.
   */
  /**
   * The select is `order by updated_at asc limit 200` over EVERY terminally
   * settled annual-return reminder row, and a reconciled row is not deleted,
   * re-statused or touched -- redactExpired leaves idempotency_key alone, so it
   * matches the prefix forever. Those rows are also the OLDEST, so they sit
   * permanently at the front of the window: past 200 of them, a reminder that
   * fails tomorrow is never in the 200 and its case goes on claiming, to staff and
   * to any audit of the firm, that the client was reminded. The dedupe inside the
   * loop cannot help -- the row never reaches the loop.
   */
  it("excludes rows it has already retracted, so new failures are not starved out", () => {
    const select = reconcile.slice(0, reconcile.indexOf("let retracted"));

    expect(select).toContain("not exists");
    expect(select).toContain("annual_return_reminder_failed");
  });

  it("is idempotent, and keyed on something redaction does not erase", () => {
    expect(reconcile).toContain("where not exists");
    expect(reconcile).toContain("idempotency_key");
    expect(reconcile).not.toContain("payload->>'caseId'");
  });
});

/**
 * The reconciler asserted, as fact, the one thing the outbox calls unknown.
 *
 * failStranded escalates a row whose transport call was begun and whose outcome
 * was never recorded with last_error_code 'dispatch_outcome_unknown' -- "the
 * provider may already have delivered it". Such a row is 'failed' with its
 * attempts spent, so it matched the reconciler's selector exactly, and the case
 * was told in writing that the client had NOT been reminded, with reminders_sent
 * decremented to match. The client may well be holding the message.
 */
describe("an unknown dispatch outcome is recorded as unknown", () => {
  it("keeps the retraction off rows the outbox could not resolve", () => {
    const select = reconcile.slice(0, reconcile.indexOf("for (const row of rows)"));

    expect(select).toContain("last_error_code");
    expect(select).toContain("dispatch_outcome_unknown");
  });

  it("still says something about them, and does not decrement the counter", () => {
    expect(reconcile).toContain("annual_return_reminder_outcome_unknown");

    // The arm itself, not the anti-join in the select that necessarily names the
    // same event type: its LAST mention is the insert that records the outcome,
    // and the retraction arm ahead of it is the only thing allowed to touch the
    // counter.
    const unknownArm = reconcile.slice(
      reconcile.lastIndexOf("annual_return_reminder_outcome_unknown"),
    );
    const decrement = reconcile.indexOf("reminders_sent = greatest(reminders_sent - 1, 0)");

    expect(unknownArm).not.toContain("reminders_sent = greatest");
    expect(decrement).toBeGreaterThan(-1);
  });

  it("dedupes both arms on the same anti-join so neither repeats every tick", () => {
    const select = reconcile.slice(0, reconcile.indexOf("for (const row of rows)"));

    expect(select).toContain("not exists");
    expect(select).toContain("event_type in (");
    expect(select).toContain("annual_return_reminder_outcome_unknown");
  });
});

/**
 * Two key shapes carry the 'annual-return-reminder:' prefix, and the reconciler
 * read segment 3 out of both as "the milestone":
 *
 *   automated  annual-return-reminder:{caseId}:{milestone}:{channel}:{recipient}
 *   manual     annual-return-reminder:{caseId}:{phone}:{remindersSent}
 *
 * For a manual reminder segment 3 is the client's PHONE NUMBER, which was then
 * written into timeline_events.metadata.milestone -- mislabelled, and parked in a
 * table the outbox's 90-day redaction does not reach.
 */
describe("parseAnnualReturnReminderKey", () => {
  const caseId = "11111111-2222-3333-4444-555555555555";

  it("reads the milestone out of an automated key", () => {
    expect(
      parseAnnualReturnReminderKey(`annual-return-reminder:${caseId}:1_week:whatsapp:+85291234567`),
    ).toEqual({ caseId, milestone: "1_week" });
  });

  it("never reports a milestone for a manual key, whose segment 3 is a phone number", () => {
    const phone = "+85291234567";
    const parsed = parseAnnualReturnReminderKey(`annual-return-reminder:${caseId}:${phone}:2`);

    expect(parsed).toEqual({ caseId, milestone: null });
    // The reconciler builds the event's metadata out of this and nothing else,
    // so "no recipient identifier can reach the timeline" is exactly this.
    expect(JSON.stringify(parsed)).not.toContain("85291234567");
    // Everything BUT the case id, which is the one identifier the timeline is
    // supposed to carry and which is itself a digit-heavy uuid.
    const { caseId: _caseId, ...rest } = parsed ?? {};
    expect(JSON.stringify(rest)).not.toMatch(/\d{6,}/);
  });

  /**
   * Belt and braces against a third shape appearing: a five-segment key whose
   * segment 3 is not a milestone we know is still not a milestone.
   */
  it("refuses a segment that is not one of the milestones", () => {
    expect(
      parseAnnualReturnReminderKey(
        `annual-return-reminder:${caseId}:+85291234567:whatsapp:+85291234567`,
      ),
    ).toEqual({ caseId, milestone: null });
  });

  /**
   * `${row.case_id}::uuid` was the FIRST statement of every sweep transaction. A
   * producer using this prefix with a non-UUID second segment therefore threw
   * before anything else ran -- and because the row is settled it never goes
   * away, so the reminder sweep would die on that row on every five-minute tick,
   * forever. The same failure the cancelFixtureOriginNotifications comment warns
   * about.
   */
  it("rejects a key whose case id is not a uuid rather than letting the cast throw", () => {
    expect(
      parseAnnualReturnReminderKey("annual-return-reminder:not-a-uuid:1_week:whatsapp:x"),
    ).toBe(null);
    expect(parseAnnualReturnReminderKey("annual-return-reminder:")).toBe(null);
    expect(parseAnnualReturnReminderKey("follow-up:abc")).toBe(null);
  });
});
