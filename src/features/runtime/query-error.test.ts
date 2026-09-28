import { describe, expect, it } from "vitest";
import { safeRequestId } from "./query-error";

describe("safeRequestId", () => {
  it("shows only a bounded support identifier, never a thrown SQL or provider message", () => {
    expect(safeRequestId({ requestId: "req_AbC123456" })).toBe("req_AbC123456");
    expect(safeRequestId(new Error("postgres://secret"))).toBeNull();
    expect(safeRequestId({ requestId: "secret\n<script>" })).toBeNull();
    expect(safeRequestId({ requestId: "x".repeat(300) })).toBeNull();
  });
});
