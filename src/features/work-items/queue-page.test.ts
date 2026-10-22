import { describe, expect, it, vi } from "vitest";
import { listWorkQueueInputSchema, queueFiltersForActor } from "./server-fns";
import { createWorkItemRepository } from "./repository";
import type { SqlClient } from "@/server/db/client";

describe("R16 / R28 bounded authorized queue", () => {
  it("accepts the full safe filter contract and preserves filters after actor scoping", () => {
    const input = listWorkQueueInputSchema.parse({
      view: "team",
      q: "覆核文件",
      workType: "document_review",
      priority: "high",
      status: "blocked",
      limit: 50,
    });
    expect(
      queueFiltersForActor(
        {
          authUserId: "auth-a",
          userId: "20000000-0000-0000-0000-000000000001",
          role: "Manager",
          teamId: "10000000-0000-0000-0000-000000000001",
          active: true,
        },
        input,
      ),
    ).toMatchObject({
      q: "覆核文件",
      workType: "document_review",
      priority: "high",
      statuses: ["blocked"],
      teamId: "10000000-0000-0000-0000-000000000001",
    });
  });
  it("rejects inactive actors before any queue access", () => {
    expect(() =>
      queueFiltersForActor(
        { authUserId: "auth", userId: "user", role: "Admin", teamId: null, active: false },
        { view: "team" },
      ),
    ).toThrow(/inactive/i);
  });
  it("UC132 uses the same Chinese, original title and company search vocabulary", async () => {
    const { workItemSearchNeedles, matchesWorkItemSearch } = await import("./queue-query");
    const item = {
      title: "Review document: NAR1",
      workType: "document_review",
      companyName: "香港測試公司",
    };
    for (const q of ["覆核文件", "Review document", "香港測試"])
      expect(matchesWorkItemSearch(item, q)).toBe(true);
    expect(
      matchesWorkItemSearch({ ...item, title: "Custom task", workType: "custom" }, "覆核文件"),
    ).toBe(false);
    expect(workItemSearchNeedles("董事登記冊")).toContain("register of directors");
    expect(matchesWorkItemSearch(item, "%")).toBe(false);
  });
  it("bounds SQL before hydration and emits a cursor only when another row exists", async () => {
    const query = vi.fn(async (_parts: TemplateStringsArray, ..._values: unknown[]) => []);
    const repo = createWorkItemRepository({ sql: query as unknown as SqlClient });
    expect(await repo.listQueuePage({ limit: 50, q: "覆核文件" })).toEqual({
      items: [],
      nextCursor: null,
    });
    const [parts, ...values] = query.mock.calls[0] as unknown as [
      TemplateStringsArray,
      ...unknown[],
    ];
    expect(parts.join("?")).toMatch(/limit/i);
    expect(values).toContain(51);
    expect(values).toContainEqual(["%覆核文件%", "%Review document%"]);
    expect(query).toHaveBeenCalledOnce();
  });
});
