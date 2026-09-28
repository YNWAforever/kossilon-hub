import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { nextRetryAt, notificationIdempotencyKey } from "./outbox";

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
    expect(redact).toContain("status in ('draft', 'sent', 'cancelled')");
    expect(redact).toContain(
      "status = case when status = 'draft' then 'cancelled' else status end",
    );
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
