import { describe, expect, it } from "vitest";
import { WHATSAPP_SESSION_WINDOW_MS, isWithinSessionWindow } from "./session-window";

const now = "2026-08-26T12:00:00.000Z";
const nowMs = Date.parse(now);

function isoAgo(ms: number): string {
  return new Date(nowMs - ms).toISOString();
}

describe("isWithinSessionWindow", () => {
  it("treats a contact who has never messaged us as outside the window", () => {
    expect(isWithinSessionWindow(null, now)).toBe(false);
  });

  it("treats a message from one minute ago as inside", () => {
    expect(isWithinSessionWindow(isoAgo(60_000), now)).toBe(true);
  });

  it("treats a message just under 24 hours old as inside", () => {
    expect(isWithinSessionWindow(isoAgo(WHATSAPP_SESSION_WINDOW_MS - 1000), now)).toBe(true);
  });

  it("treats a message exactly 24 hours old as OUTSIDE (exclusive boundary)", () => {
    expect(isWithinSessionWindow(isoAgo(WHATSAPP_SESSION_WINDOW_MS), now)).toBe(false);
  });

  it("treats a message just over 24 hours old as outside", () => {
    expect(isWithinSessionWindow(isoAgo(WHATSAPP_SESSION_WINDOW_MS + 1000), now)).toBe(false);
  });

  it("accepts Date objects on both sides", () => {
    expect(isWithinSessionWindow(new Date(nowMs - 60_000), new Date(nowMs))).toBe(true);
  });

  it("treats a future inbound timestamp as inside (cron tick lags real time)", () => {
    expect(isWithinSessionWindow(new Date(nowMs + 30_000).toISOString(), now)).toBe(true);
  });

  it("fails closed on an unparseable timestamp", () => {
    expect(isWithinSessionWindow("not a date", now)).toBe(false);
    expect(isWithinSessionWindow(isoAgo(60_000), "not a date")).toBe(false);
  });

  it("exports 24 hours in milliseconds", () => {
    expect(WHATSAPP_SESSION_WINDOW_MS).toBe(86_400_000);
  });
});
