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
    expect(schema).toContain("-- from 0022_notification_outbox_delivery.sql");
    expect(schema).toContain(
      "alter table notification_outbox add column if not exists delivery text",
    );
    expect(schema).toContain("delivery is null or delivery in ('provider', 'simulated')");
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
