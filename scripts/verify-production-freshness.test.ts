import { describe, expect, it } from "vitest";

import { freshnessVerdict } from "./verify-production-freshness";

const sha = "a".repeat(40);

describe("production freshness verdict", () => {
  it("is current only when live equals main", () => {
    expect(freshnessVerdict({ mainSha: sha, liveSha: sha })).toBe("current");
    expect(freshnessVerdict({ mainSha: sha, liveSha: "b".repeat(40) })).toBe("stale");
  });

  it("is unknown when either side is unreadable", () => {
    expect(freshnessVerdict({ mainSha: sha, liveSha: null })).toBe("unknown");
    expect(freshnessVerdict({ mainSha: null, liveSha: sha })).toBe("unknown");
    expect(freshnessVerdict({ mainSha: null, liveSha: null })).toBe("unknown");
  });
});
