import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nextRetryAt, notificationIdempotencyKey, processingReclaimCutoff } from "./outbox";

describe("notification outbox contracts", () => {
  it("builds stable identity keys", () => {
    const input = {
      companyId: "company-1",
      workItemId: "work-1",
      channel: "whatsapp",
      notificationType: "sla_warning",
      recipient: "+85290000000",
    };
    expect(notificationIdempotencyKey(input)).toBe(notificationIdempotencyKey({ ...input }));
    expect(notificationIdempotencyKey(input)).not.toBe(
      notificationIdempotencyKey({ ...input, notificationType: "sla_breach" }),
    );
  });

  it("uses bounded exponential retry delays", () => {
    const now = "2026-07-12T00:00:00.000Z";
    expect(nextRetryAt(1, now)).toBe("2026-07-12T00:01:00.000Z");
    expect(nextRetryAt(2, now)).toBe("2026-07-12T00:02:00.000Z");
    expect(nextRetryAt(99, now)).toBe("2026-07-12T01:00:00.000Z");
  });
});

/**
 * claimDue used to select only 'pending' and 'failed', and markSent/markRetry are
 * the only things that move a row out of 'processing'. A Worker killed between
 * the claim and either of those — CPU limit, eviction, deploy — stranded the row
 * forever, and the SLA escalation it carried simply never arrived, with no error
 * anywhere to notice.
 */
describe("stranded outbox rows become claimable again", () => {
  const source = readFileSync(new URL("./outbox.ts", import.meta.url), "utf8");

  it("puts the reclaim cutoff a fixed window behind now", () => {
    expect(processingReclaimCutoff("2026-07-12T01:00:00.000Z")).toBe("2026-07-12T00:45:00.000Z");
  });

  it("leaves a window long enough not to double-send a slow dispatch", () => {
    const now = "2026-07-12T01:00:00.000Z";
    const windowMs = Date.parse(now) - Date.parse(processingReclaimCutoff(now));

    expect(windowMs).toBeGreaterThanOrEqual(5 * 60_000);
    expect(windowMs).toBeLessThanOrEqual(60 * 60_000);
  });

  it("claims processing rows older than the cutoff alongside pending and failed", () => {
    expect(source).toContain("status = 'processing' and updated_at <=");
    expect(source).toContain("processingReclaimCutoff(now)");
  });

  // attempt_count is incremented at claim time, so a row that strands on every
  // attempt still exhausts max_attempts rather than looping forever.
  it("keeps the attempt cap on the reclaim path", () => {
    // Sliced to claimDue specifically: failStranded and redactExpired also use
    // `for update skip locked`, so an index-based slice spans the wrong query.
    const claimQuery = source.slice(
      source.indexOf("async claimDue"),
      source.indexOf("async markSent"),
    );

    expect(claimQuery).toContain("attempt_count < max_attempts");
    expect(claimQuery.indexOf("attempt_count < max_attempts")).toBeLessThan(
      claimQuery.indexOf("status = 'processing'"),
    );
  });

  it("has an index for the reclaim branch", () => {
    const migration = readFileSync(
      new URL("../../../db/migrations/0009_reclaim_stranded_outbox_rows.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain("notification_outbox_stranded_idx");
    expect(migration).toContain("where status = 'processing'");
  });
});

/**
 * The fixture-origin guard was a SEPARATE statement run just before the claim, and
 * the five-minute cron holds no lease. Two overlapping ticks, or a reminder
 * enqueued in the window between the cancel pass and the claim, produced a
 * fixture-origin row that the cancel had already swept past and the claim happily
 * took — and a claimed row is one dispatch away from a real client's phone.
 *
 * Origin therefore has to be a predicate of the claim itself. The cancel pass
 * stays: it is what settles those rows so they stop being retried forever.
 */
describe("claimDue refuses fixture-origin rows on its own", () => {
  const source = readFileSync(new URL("./outbox.ts", import.meta.url), "utf8");
  const claimQuery = source.slice(
    source.indexOf("async claimDue"),
    source.indexOf("async cancelFixtureOriginNotifications"),
  );

  it("filters on company data origin inside the claim", () => {
    expect(claimQuery).toContain("data_origin <> 'client'");
    expect(claimQuery).toContain("company_id not in (select id from companies");
  });

  /**
   * companies_data_origin_idx is PARTIAL, `where data_origin <> 'client'`, so the
   * index can only answer "which companies are fixtures". A positive predicate
   * (`= 'client'`) would have to seq-scan companies on every cron tick.
   */
  it("phrases the predicate so the partial index can serve it", () => {
    expect(claimQuery).not.toContain("data_origin = 'client'");
  });

  it("refuses any row that already carries a dispatch marker", () => {
    expect(claimQuery).toContain("dispatch_started_attempt is null");
  });

  it("keeps the cancel pass that settles those rows", () => {
    expect(source).toContain("cancelFixtureOriginNotifications");
    expect(source).toContain("last_error_code = 'fixture-origin'");
  });
});

/**
 * retention_until was written on every insert and read back on every row while
 * nothing ever acted on it, so notification_outbox grew without bound — carrying
 * recipient addresses and message bodies indefinitely.
 *
 * The schema was built for REDACTION, not deletion: `redacted_at`, a check
 * constraint spelling out the redacted shape, and a partial index on
 * (retention_until) where redacted_at is null whose only purpose is finding rows
 * due for it. An earlier draft of this work deleted the rows outright, which
 * would have destroyed the firm's record that a statutory reminder was ever sent.
 */
describe("outbox retention redacts rather than deletes", () => {
  const source = readFileSync(new URL("./outbox.ts", import.meta.url), "utf8");
  const redact = source.slice(
    source.indexOf("async redactExpired"),
    source.indexOf("async close()"),
  );

  it("keeps the row and strips the personal data", () => {
    expect(redact).toContain("update notification_outbox");
    expect(redact).not.toContain("delete from");
    for (const column of [
      "redacted_at = now()",
      "recipient = null",
      "payload = null",
      "provider_message_id = null",
      "last_error_code = null",
      "last_error_message = null",
    ]) {
      expect(redact, `redaction does not clear ${column}`).toContain(column);
    }
  });

  // notification_outbox_redaction_check requires exactly this set to be null
  // alongside a non-null redacted_at; missing one makes every update fail.
  it("clears precisely the columns the check constraint requires", () => {
    const migration = readFileSync(
      new URL(
        "../../../db/migrations/0006_production_assignment_sla_foundation.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const constraint = migration.slice(
      migration.indexOf("notification_outbox_redaction_check"),
      migration.indexOf("create table document_upload_intents"),
    );

    for (const column of [
      "recipient",
      "payload",
      "provider_message_id",
      "last_error_code",
      "last_error_message",
    ]) {
      expect(constraint, `constraint does not mention ${column}`).toContain(column);
      expect(redact, `redaction does not clear ${column}`).toContain(`${column} = null`);
    }
  });

  it("only touches rows past their retention date", () => {
    expect(redact).toContain("retention_until <=");
  });

  it("never redacts a notification still awaiting delivery", () => {
    expect(redact).toContain("status in ('sent', 'cancelled')");
    expect(redact).toContain("status = 'failed' and attempt_count >= max_attempts");
    expect(redact).not.toContain("status = 'pending'");
    expect(redact).not.toContain("status = 'processing'");
  });

  // Matching the partial index predicate is what lets this use
  // notification_outbox_retention_idx instead of scanning, and it also stops the
  // pass from rewriting rows it already redacted.
  it("skips rows it has already redacted, matching the partial index", () => {
    expect(redact).toContain("redacted_at is null");
  });

  it("bounds the work it does in one cron tick", () => {
    expect(redact).toContain("limit ${limit}");
    expect(redact).toContain("for update skip locked");
  });

  it("is driven by the scheduled maintenance pass", () => {
    const cron = readFileSync(new URL("../../server/cron.ts", import.meta.url), "utf8");
    const maintenance = readFileSync(
      new URL("../../server/maintenance.ts", import.meta.url),
      "utf8",
    );

    expect(cron).toContain("redactNotifications");
    expect(maintenance).toContain("outbox.redactExpired(now)");
  });
});

/**
 * `provider_message_id is null` on a sent row meant three unrelated things —
 * never dispatched, redacted after retention, or a simulated/local dispatch — and
 * only the first two had something positive to read (`status`, `redacted_at`).
 * The third was inferable only by elimination, and only because both live
 * transports happen to throw rather than return an empty id. `simulated` is a
 * deployed mode against a real database and VITE_PROVIDER_MODE can flip on the
 * same database over time, after which the historical rows are unreadable.
 */
describe("outbox records how a dispatch was delivered", () => {
  const source = readFileSync(new URL("./outbox.ts", import.meta.url), "utf8");
  const types = readFileSync(new URL("./types.ts", import.meta.url), "utf8");
  const migration = readFileSync(
    new URL("../../../db/migrations/0022_notification_outbox_delivery.sql", import.meta.url),
    "utf8",
  );
  const schema = readFileSync(new URL("../../server/db/schema.sql", import.meta.url), "utf8");

  it("writes the delivery alongside the provider id on the terminal send", () => {
    const markSent = source.slice(
      source.indexOf("async markSent"),
      source.indexOf("async markRetry"),
    );

    expect(markSent).toContain("delivery = ${input.delivery}");
    expect(markSent).toContain("provider_message_id = ${input.providerMessageId}");
  });

  // Nullable on purpose: rows written before 0022 genuinely are unknown, and a
  // default would hand an auditor a value that looks like evidence and is not.
  it("adds a nullable column whose check tolerates the unknown rows", () => {
    expect(migration).toContain("alter table notification_outbox add column delivery text");
    expect(migration).not.toMatch(/delivery text[^;]*not null/);
    expect(migration).toContain("delivery is null or delivery in");
  });

  /**
   * TypeScript cannot see the CHECK constraint, and Postgres cannot see the
   * union, so nothing but this compares them. A third spelling anywhere means
   * every simulated send is rejected by the database at dispatch time.
   */
  it("uses the same vocabulary as the dispatch result the transports produce", () => {
    const result = types.slice(
      types.indexOf("export type NotificationDispatchResult"),
      types.indexOf("export type NotificationDelivery"),
    );
    const fromTypes = [...result.matchAll(/delivery: "([a-z_]+)"/g)].map((match) => match[1]);
    const constraint = /delivery in \(([^)]*)\)/.exec(migration)?.[1] ?? "";
    const fromMigration = [...constraint.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);

    expect(fromTypes).toEqual(["provider", "simulated"]);
    expect(fromMigration.slice().sort()).toEqual(fromTypes.slice().sort());
  });

  /**
   * Pre-fix rows are self-describing — the simulated and local transports used to
   * mint 'simulated:<channel>:<id>' and 'local:<id>' into this very column — so
   * they can be classified with certainty rather than guessed at.
   */
  it("backfills only the rows that identify themselves", () => {
    expect(migration).toContain("provider_message_id like 'simulated:%'");
    expect(migration).toContain("provider_message_id like 'local:%'");
    expect(migration).toContain("where provider_message_id is not null");
  });

  /**
   * A migration-only change drifts permanently and a schema.sql-only change never
   * reaches production. verify:firm compares `create table` names only, so it
   * cannot catch a column that exists in one file and not the other — this can.
   */
  it("carries the same column in the canonical schema", () => {
    // Scoped to the table's own create block rather than the whole file: schema.sql
    // is the reference a reader consults, so a `delivery` column declared anywhere
    // else in it would satisfy a file-wide search while still leaving the reader of
    // notification_outbox unable to see it.
    const createBlock = schema.slice(
      schema.indexOf("create table if not exists notification_outbox ("),
    );
    const columns = createBlock.slice(0, createBlock.indexOf("\n);"));

    expect(columns).toContain("delivery text check");
    expect(columns).toContain("delivery is null or delivery in ('provider', 'simulated')");
    expect(columns).not.toMatch(/delivery text[^,]*not null/);
  });
});

/**
 * The marker is only half a fix on its own. It has to be WRITTEN before the
 * transport call, CLEARED by every terminal write (or the row is stuck after a
 * perfectly ordinary retry), REFUSED by the claim, and ESCALATED by something —
 * otherwise "never re-send" degrades into "never deliver, silently".
 */
describe("the dispatch marker is written, cleared and escalated", () => {
  const source = readFileSync(new URL("./outbox.ts", import.meta.url), "utf8");
  const migration = readFileSync(
    new URL("../../../db/migrations/0034_notification_outbox_dispatch_marker.sql", import.meta.url),
    "utf8",
  );
  const schema = readFileSync(new URL("../../server/db/schema.sql", import.meta.url), "utf8");

  it("writes the marker fenced on the attempt it belongs to", () => {
    const markStarted = source.slice(
      source.indexOf("async markDispatchStarted"),
      source.indexOf("async markSent"),
    );
    expect(markStarted).toContain("set dispatch_started_attempt = ${input.attemptCount}");
    expect(markStarted).toContain("status = 'processing'");
  });

  /**
   * The fence above means the update can match zero rows -- another run reclaimed
   * the row, so its attempt_count has moved on. That returned normally and the
   * caller sent the message unmarked, which is the one thing this whole mechanism
   * exists to prevent. Like every other fenced write here, it reports whether it
   * actually landed.
   */
  it("reports whether the marker was actually applied", () => {
    const markStarted = source.slice(
      source.indexOf("async markDispatchStarted"),
      source.indexOf("async markSent"),
    );
    expect(markStarted).toContain("returning id");
    expect(markStarted).toContain("rows.length === 1");
  });

  it("clears the marker on every terminal write", () => {
    for (const name of ["markSent", "markRetry", "markFailed"]) {
      const start = source.indexOf(`async ${name}(id`);
      const body = source.slice(start, start + 1400);
      expect(body, `${name} leaves the marker behind`).toContain("dispatch_started_attempt = null");
    }
  });

  /**
   * Without this the row is not re-sent and also never settled: claimDue refuses
   * it forever and redactExpired skips 'processing'. "Escalate for a human"
   * requires a terminal state and an error code to search for.
   */
  it("escalates a marked stranded row instead of leaving it invisible", () => {
    const stranded = source.slice(
      source.indexOf("async failStranded"),
      source.indexOf("async redactExpired"),
    );
    expect(stranded).toContain("dispatch_outcome_unknown");
    expect(stranded).toContain("dispatch_started_attempt is not null");
    // Not gated on the attempt budget: the hazard is the unknown outcome, which
    // exists on the first attempt just as much as on the last.
    expect(stranded).toContain("attempt_count >= max_attempts");
  });

  /**
   * A provider-accepted send that could not be recorded is settled with markFailed
   * from a row that may have attempts left. Without spending the budget, `failed`
   * plus `next_attempt_at = now` is a row claimDue takes on the very next tick --
   * a second copy of a statutory reminder -- and one redactExpired never settles,
   * so the recipient's phone number outlives retention.
   */
  it("can spend the attempt budget on a failure that must never be retried", () => {
    const start = source.indexOf("async markFailed(id");
    const markFailed = source.slice(start, start + 1600);

    expect(markFailed).toContain("spendAttempts");
    expect(markFailed).toContain("max_attempts");
  });

  it("carries the column in the migration and in the canonical schema", () => {
    expect(migration.replace(/\s+/g, " ")).toContain(
      "alter table notification_outbox add column if not exists dispatch_started_attempt integer",
    );
    const createBlock = schema.slice(
      schema.indexOf("create table if not exists notification_outbox ("),
    );
    expect(createBlock.slice(0, createBlock.indexOf("\n);"))).toContain(
      "dispatch_started_attempt integer",
    );
  });
});

describe("manual dispatch does not take its clock from the caller", () => {
  const source = readFileSync(new URL("./runtime-dispatch.ts", import.meta.url), "utf8");

  // A caller-supplied `now` chooses which notifications look due: a future value
  // claims ones that are not, a past value hides ones that are.
  it("derives now on the server and keeps it out of the input schema", () => {
    expect(source).toContain("manualDispatchInputSchema");
    expect(source).toContain("const now = new Date().toISOString()");

    const schema = source.slice(
      source.indexOf("const manualDispatchInputSchema"),
      source.indexOf("export const dispatchDueNotifications"),
    );
    expect(schema).not.toContain("now:");
  });
});

describe("notificationIdempotencyKey", () => {
  /**
   * The recurring-reminder defect, stated as a test.
   *
   * The default key is company + workItem + channel + type + recipient. For an
   * annual-return reminder the type carries only the milestone, and no workItem
   * is passed -- so the same company's reminder for the SAME milestone in a
   * different year produced a byte-identical key. `on conflict do nothing`
   * matched the previous year's spent row, no message was queued, and the sweep
   * counted it as sent.
   *
   * This pins the shape so the collision is visible here rather than in
   * production two years later. Both recurring sweeps now pass an explicit,
   * period-scoped key instead.
   */
  it("carries no period at all, so a recurring sweep must supply its own key", () => {
    // This used to call the function twice with byte-identical arguments and
    // assert the two matched, which is key(X) === key(X) -- true of any
    // function, and blind to the defect it was named for. The signature has no
    // period argument to vary, so the only honest way to pin "this key cannot
    // separate years" is to pin the whole string it produces.
    expect(
      notificationIdempotencyKey({
        companyId: "company-1",
        channel: "whatsapp",
        notificationType: "annual_return_reminder_1_month",
        recipient: "+85291234567",
      }),
    ).toBe("notification:company-1:none:whatsapp:annual_return_reminder_1_month:+85291234567");

    // Every segment is stable across years. A caller that wants year 2 to be a
    // different row has to put the period in one of them itself -- which is
    // what both recurring sweeps now do, via notificationType.
    expect(
      notificationIdempotencyKey({
        companyId: "company-1",
        channel: "whatsapp",
        notificationType: "annual_return_reminder_1_month:2027",
        recipient: "+85291234567",
      }),
    ).not.toBe(
      notificationIdempotencyKey({
        companyId: "company-1",
        channel: "whatsapp",
        notificationType: "annual_return_reminder_1_month:2026",
        recipient: "+85291234567",
      }),
    );
  });

  it("separates different milestones, recipients and channels", () => {
    const base = {
      companyId: "company-1",
      channel: "whatsapp" as const,
      notificationType: "annual_return_reminder_1_month",
      recipient: "+85291234567",
    };
    const keys = new Set([
      notificationIdempotencyKey(base),
      notificationIdempotencyKey({ ...base, notificationType: "annual_return_reminder_3_days" }),
      notificationIdempotencyKey({ ...base, recipient: "+85299999999" }),
      notificationIdempotencyKey({ ...base, channel: "email" }),
    ]);
    expect(keys.size).toBe(4);
  });
});
