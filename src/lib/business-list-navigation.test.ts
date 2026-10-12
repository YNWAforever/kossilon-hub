import { expect, it } from "vitest";
import { safeListReturnTo } from "./list-navigation";
it("preserves bounded business-list query/history/anchor and rejects foreign or invalid return targets", () => {
  const own =
    "/incorporation?q=%E4%B8%AD%E6%96%87&history=true&sort=recent&view=mine&anchor=11111111-1111-4111-8111-111111111111";
  expect(safeListReturnTo(own)).toBe(own);
  const changes =
    "/corporate-changes?status=Documents+pending&due=none&companyId=22222222-2222-4222-8222-222222222222";
  expect(safeListReturnTo(changes)).toBe(changes);
  for (const bad of [
    "/incorporation?history=maybe",
    "/corporate-changes?owner=someone",
    "/incorporation?returnTo=https://evil.test",
    "https://evil.test/incorporation",
    "/corporate-changes?limit=100",
  ])
    expect(safeListReturnTo(bad)).toBe("/today");
});
