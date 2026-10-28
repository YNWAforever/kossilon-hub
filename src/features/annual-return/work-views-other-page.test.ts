import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import { otherWorkPageForActor, type OtherWorkPageRepository } from "./work-views-other-page";

const actor: AuthenticatedActor = {
  authUserId: "auth-a",
  userId: "staff-a",
  active: true,
  role: "Staff",
  teamId: "team-a",
};
const source = {
  business: "incorporation" as const,
  id: "11111111-1111-4111-8111-111111111111",
  companyName: "Local company",
  ownerId: "staff-a",
  ownerName: "Ada",
  reviewerId: null,
  reviewerName: null,
  dueDate: "2026-10-22",
  status: "Documents pending",
  statusAt: null,
  completedAt: null,
  requiredCount: 1,
  missingLabels: ["CDD"],
  receivedCount: 0,
  sortKey: "2026-10-22",
};
function repository(rows = [source]): OtherWorkPageRepository {
  return { list: vi.fn(async () => rows) };
}
describe("scoped bounded Today read boundary", () => {
  it("passes R14 team scope to the read and returns domain links with a bounded continuation", async () => {
    const repo = repository([source, { ...source, id: "22222222-2222-4222-8222-222222222222" }]);
    const page = await otherWorkPageForActor(
      actor,
      { view: "chaseToday", limit: 1 },
      repo,
      "2026-10-23",
    );
    expect(repo.list).toHaveBeenCalledWith(
      expect.objectContaining({
        incorporationScope: { kind: "team", teamId: "team-a" },
        corporateTeamId: "team-a",
        limit: 2,
      }),
    );
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].target).toBe("/incorporation/$id");
    expect(page.nextCursor).toEqual(expect.any(String));
  });
  it.each([
    { ...actor, role: "Client" as const },
    { ...actor, active: false },
    { ...actor, teamId: null },
    { ...actor, userId: null },
  ])("refuses unauthorized identity before any read", async (identity) => {
    const repo = repository();
    await expect(
      otherWorkPageForActor(identity, { view: "chaseToday" }, repo, "2026-10-23"),
    ).rejects.toThrow("Forbidden");
    expect(repo.list).not.toHaveBeenCalled();
  });
  it("rejects malformed and cross-actor cursors before any read", async () => {
    const repo = repository([source, source]);
    const page = await otherWorkPageForActor(
      actor,
      { view: "chaseToday", limit: 1 },
      repo,
      "2026-10-23",
    );
    const next = repository();
    await expect(
      otherWorkPageForActor(actor, { view: "chaseToday", cursor: "invalid" }, next, "2026-10-23"),
    ).rejects.toThrow("cursor");
    await expect(
      otherWorkPageForActor(
        { ...actor, authUserId: "other" },
        { view: "chaseToday", cursor: page.nextCursor! },
        next,
        "2026-10-23",
      ),
    ).rejects.toThrow("cursor");
    expect(next.list).not.toHaveBeenCalled();
  });
  it("rejects oversized pages and client-supplied team scope", async () => {
    const repo = repository();
    await expect(
      otherWorkPageForActor(actor, { view: "chaseToday", limit: 501 }, repo, "2026-10-23"),
    ).rejects.toThrow();
    await expect(
      otherWorkPageForActor(
        actor,
        { view: "chaseToday", teamId: "other" } as never,
        repo,
        "2026-10-23",
      ),
    ).rejects.toThrow();
    expect(repo.list).not.toHaveBeenCalled();
  });
  it("propagates a failed read instead of reporting empty work", async () => {
    const repo = {
      list: vi.fn(async () => {
        throw new Error("read unavailable");
      }),
    };
    await expect(
      otherWorkPageForActor(actor, { view: "chaseToday" }, repo, "2026-10-23"),
    ).rejects.toThrow("read unavailable");
  });
});
