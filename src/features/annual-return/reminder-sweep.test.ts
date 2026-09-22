import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * evaluateReminders is DB-backed, so these assert on the SHAPE of the sweep's SQL
 * rather than on its behaviour — the behavioural assertions live in
 * repository.test.ts behind TEST_DATABASE_URL. Ordering inside one transaction is
 * exactly the kind of defect a string assertion can catch and a green no-database
 * CI cannot.
 */
const source = readFileSync(new URL("./repository.ts", import.meta.url), "utf8");
const sweep = source.slice(
  source.indexOf("async function evaluateReminders"),
  source.indexOf("async function close()"),
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
