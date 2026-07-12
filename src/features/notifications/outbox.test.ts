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
