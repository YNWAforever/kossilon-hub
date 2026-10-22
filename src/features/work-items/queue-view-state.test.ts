import { describe, expect, it } from "vitest";
import { queueReturnPath, queueViewSearch } from "./queue-view-state";
import { caseReturnPath } from "@/features/annual-return/daily-view-state";
import { defaultParseSearch } from "@tanstack/react-router";

describe("UC124 work queue URL and safe return", () => {
  it("round-trips search, owner, SLA, status, priority, sort and the third-page boundary", () => {
    const state = queueViewSearch({
      view: "team",
      q: "覆核文件 香港",
      owner: "20000000-0000-0000-0000-000000000001",
      sla: "warning",
      status: "blocked",
      priority: "high",
      sort: "priority",
      cursor: '{"third":"page"}',
    });
    const path = queueReturnPath(state);
    expect(caseReturnPath(path)).toBe(path);
    expect(
      queueViewSearch(defaultParseSearch(new URL(path, "https://local.invalid").search)),
    ).toEqual(state);
  });
  it("round-trips a real JSON cursor and a numeric search through the actual router parser", () => {
    const cursor = JSON.stringify({
      scope: "scope",
      rank: 1,
      due: "2026-10-23 01:00:00.123456+00",
      priority: 50,
      id: "50000000-0000-0000-0000-000000000001",
      version: 1,
    });
    const state = queueViewSearch({ view: "team", q: "123", cursor });
    const decoded = queueViewSearch(
      defaultParseSearch(new URL(queueReturnPath(state), "https://local.invalid").search),
    );
    expect(decoded.q).toBe("123");
    expect(decoded.cursor).toBe(cursor);
    expect(queueViewSearch(defaultParseSearch("?q=123")).q).toBe("123");
  });
  it.each(["?view=team&q=a&q=b", "?owner=all&owner=unassigned", "?status=open&status=blocked"])(
    "rejects repeated filters instead of widening %s",
    (raw) => {
      expect(queueViewSearch(defaultParseSearch(raw)).contextError).toBe(true);
    },
  );
  it.each([
    "https://outside.invalid/work-queue",
    "//outside.invalid",
    "/%2foutside.invalid",
    "/settings",
    "/work-queue-other",
  ])("rejects unsafe or unrelated return %s", (value) => {
    expect(caseReturnPath(value)).toBe("/annual-returns");
  });
  it("bounds URL fields and discards malformed cursor and authority values", () => {
    const state = queueViewSearch({
      q: "a".repeat(500),
      owner: ["a", "b"],
      view: "all-teams",
      cursor: "x".repeat(8193),
      status: "Completed",
      sort: "injected",
    });
    expect(state.q).toHaveLength(120);
    expect(state).toMatchObject({ view: "mine", owner: "all", status: "all", sort: "deadline" });
    expect(state.cursor).toBeUndefined();
  });
});
