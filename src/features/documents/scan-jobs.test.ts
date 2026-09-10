import { describe, expect, it } from "vitest";
import { nextScanAttemptAt, scanJobIdempotencyKey, scanProcessingReclaimCutoff } from "./scan-jobs";

const INTENT = "30000000-0000-4000-8000-000000000001";
const CHECKSUM = "a".repeat(64);
const OTHER_CHECKSUM = "b".repeat(64);
const NOW = "2026-09-10T12:00:00.000Z";

describe("scanJobIdempotencyKey", () => {
  it("is stable for the same intent and content", () => {
    expect(scanJobIdempotencyKey({ intentId: INTENT, checksum: CHECKSUM })).toBe(
      scanJobIdempotencyKey({ intentId: INTENT, checksum: CHECKSUM, reason: "initial" }),
    );
  });

  // The checksum is in the key so a replacement upload gets its own job instead
  // of colliding with the old one and being silently dropped by the conflict
  // clause.
  it("differs when the content differs", () => {
    expect(scanJobIdempotencyKey({ intentId: INTENT, checksum: CHECKSUM })).not.toBe(
      scanJobIdempotencyKey({ intentId: INTENT, checksum: OTHER_CHECKSUM }),
    );
  });

  // A genuine re-scan of an already-verdicted file must not collide with that
  // file's original job, or the legacy backfill would insert nothing.
  it("separates a rescan from the original job for the same content", () => {
    expect(
      scanJobIdempotencyKey({ intentId: INTENT, checksum: CHECKSUM, reason: "rescan" }),
    ).not.toBe(scanJobIdempotencyKey({ intentId: INTENT, checksum: CHECKSUM, reason: "initial" }));
  });

  it("matches the key shape migration 0023 backfills", () => {
    expect(scanJobIdempotencyKey({ intentId: INTENT, checksum: CHECKSUM })).toBe(
      `scan:${INTENT}:${CHECKSUM}`,
    );
    expect(scanJobIdempotencyKey({ intentId: INTENT, checksum: CHECKSUM, reason: "rescan" })).toBe(
      `scan:${INTENT}:${CHECKSUM}:rescan`,
    );
  });
});

describe("nextScanAttemptAt", () => {
  it("backs off exponentially from one minute", () => {
    expect(nextScanAttemptAt(1, NOW)).toBe("2026-09-10T12:01:00.000Z");
    expect(nextScanAttemptAt(2, NOW)).toBe("2026-09-10T12:02:00.000Z");
    expect(nextScanAttemptAt(3, NOW)).toBe("2026-09-10T12:04:00.000Z");
  });

  it("caps the delay at one hour so a stuck job still retries daily-ish, not never", () => {
    expect(nextScanAttemptAt(50, NOW)).toBe("2026-09-10T13:00:00.000Z");
  });

  it("treats a zero or negative attempt as the first attempt", () => {
    expect(nextScanAttemptAt(0, NOW)).toBe(nextScanAttemptAt(1, NOW));
    expect(nextScanAttemptAt(-5, NOW)).toBe(nextScanAttemptAt(1, NOW));
  });
});

describe("scanProcessingReclaimCutoff", () => {
  // Longer than the outbox's 15 minutes: a scan submits bytes to a provider and
  // can legitimately take minutes, where a dispatch takes seconds.
  it("reclaims a job stranded in processing for more than thirty minutes", () => {
    expect(scanProcessingReclaimCutoff(NOW)).toBe("2026-09-10T11:30:00.000Z");
  });
});
