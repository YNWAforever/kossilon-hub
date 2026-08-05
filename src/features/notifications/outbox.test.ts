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
    const claimQuery = source.slice(
      source.indexOf("select * from notification_outbox"),
      source.indexOf("for update skip locked"),
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
