import { describe, expect, it } from "vitest";
import { entityIdSchema } from "./entity-id";

const LEGACY_ID = "40000000-0000-0000-0000-000000000002";
const V4_ID = "550e8400-e29b-41d4-a716-446655440000";
const V7_ID = "0194f984-5500-7000-8000-000000000001";

describe("T02 entity ID syntax", () => {
  it("t02_scenario_1 accepts legacy UUID-shaped keys and standard v4/v7 keys", () => {
    expect(entityIdSchema.parse(LEGACY_ID)).toBe(LEGACY_ID);
    expect(entityIdSchema.parse(V4_ID.toUpperCase())).toBe(V4_ID);
    expect(entityIdSchema.parse(V7_ID)).toBe(V7_ID);
  });

  it("t02_scenario_1 rejects malformed, nil, oversized and non-string keys", () => {
    for (const value of [
      "ar-harbour",
      "00000000-0000-0000-0000-000000000000",
      `${V4_ID}extra`,
      V4_ID.replaceAll("-", ""),
      42,
      null,
    ]) {
      expect(entityIdSchema.safeParse(value).success).toBe(false);
    }
  });
});
