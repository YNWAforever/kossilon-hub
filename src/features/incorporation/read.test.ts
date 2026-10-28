import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import { getIncorporationCaseForActor, listIncorporationCasesForActor } from "./read";
import type { IncorporationCase } from "./types";

const actor: AuthenticatedActor = {
  authUserId: "auth-a",
  userId: "user-a",
  role: "Staff",
  teamId: "team-a",
  active: true,
};
const record: IncorporationCase = {
  id: "case-a",
  teamId: "team-a",
  teamName: "Team A",
  ownerId: "user-a",
  ownerName: "Staff A",
  proposedCompanyNameEn: "New Venture Limited",
  proposedCompanyNameZh: "新創有限公司",
  proposedRegisteredOffice: "1 Test Street, Hong Kong",
  proposedCompanySecretary: "Test Secretary",
  registeredCapital: 10000,
  businessNature: "Trading",
  status: "Intake",
  targetCompletionDate: "2026-11-01",
  companyId: null,
  completedAt: null,
  createdAt: "2026-10-23T00:00:00.000Z",
  checklist: [],
};
function repository() {
  return {
    listCases: vi.fn(async () => [record]),
    getCaseTeamId: vi.fn(async (): Promise<string | null> => "team-a"),
    getCase: vi.fn(async (): Promise<IncorporationCase | null> => record),
  };
}

describe("actor-scoped incorporation reads", () => {
  it.each(["Staff", "Manager"] as const)(
    "passes %s team scope alongside search/page filters",
    async (role) => {
      const repo = repository();
      await expect(
        listIncorporationCasesForActor(
          { ...actor, role },
          {
            q: "新創",
            limit: 10,
            offset: 20,
            ownerId: "user-b",
          },
          { repository: repo },
        ),
      ).resolves.toEqual([record]);
      expect(repo.listCases).toHaveBeenCalledWith(
        { kind: "team", teamId: "team-a" },
        { q: "新創", limit: 10, offset: 20, ownerId: "user-b" },
      );
    },
  );

  it("passes explicit all-team Admin scope, also when narrowing a query", async () => {
    const repo = repository();
    const admin = { ...actor, role: "Admin" as const, teamId: null };
    await listIncorporationCasesForActor(admin, {}, { repository: repo });
    expect(repo.listCases).toHaveBeenLastCalledWith({ kind: "all" }, {});
    await listIncorporationCasesForActor(admin, { teamId: "team-b" }, { repository: repo });
    expect(repo.listCases).toHaveBeenLastCalledWith({ kind: "team", teamId: "team-b" }, {});
  });

  it.each([
    { role: "Client" },
    { active: false },
    { teamId: null },
    { role: "Manager", teamId: null },
    { role: "Admin", active: false },
  ] satisfies Partial<AuthenticatedActor>[])(
    "rejects invalid actor %j without repository reads",
    async (overrides) => {
      const repo = repository();
      const denied = { ...actor, ...overrides };
      await expect(
        listIncorporationCasesForActor(denied, {}, { repository: repo }),
      ).rejects.toThrow(/^Forbidden:/);
      await expect(
        getIncorporationCaseForActor(denied, record.id, { repository: repo }),
      ).rejects.toThrow(/^Forbidden:/);
      expect(repo.listCases).not.toHaveBeenCalled();
      expect(repo.getCaseTeamId).not.toHaveBeenCalled();
      expect(repo.getCase).not.toHaveBeenCalled();
    },
  );

  it("rejects a requested foreign team even with an owner assignment filter", async () => {
    const repo = repository();
    await expect(
      listIncorporationCasesForActor(
        actor,
        {
          teamId: "team-b",
          ownerId: actor.userId!,
          q: "secret",
          offset: 100,
        },
        { repository: repo },
      ),
    ).rejects.toThrow(/^Forbidden:/);
    expect(repo.listCases).not.toHaveBeenCalled();
  });

  it("reads an allowed case using the same scope as the list", async () => {
    const repo = repository();
    await expect(
      getIncorporationCaseForActor(actor, record.id, { repository: repo }),
    ).resolves.toBe(record);
    expect(repo.getCase).toHaveBeenCalledWith(record.id, { kind: "team", teamId: "team-a" });
  });

  it("rejects foreign detail before hydrating its checklist", async () => {
    const repo = repository();
    repo.getCaseTeamId.mockResolvedValue("team-b");
    await expect(
      getIncorporationCaseForActor(actor, record.id, { repository: repo }),
    ).rejects.toThrow(/^Forbidden:/);
    expect(repo.getCase).not.toHaveBeenCalled();
  });

  it("rechecks the returned case if its team changes after the scope lookup", async () => {
    const repo = repository();
    repo.getCase.mockResolvedValue({ ...record, teamId: "team-b" });
    await expect(
      getIncorporationCaseForActor(actor, record.id, { repository: repo }),
    ).rejects.toThrow(/^Forbidden:/);
  });

  it("returns null for a missing case without fetching a checklist", async () => {
    const repo = repository();
    repo.getCaseTeamId.mockResolvedValue(null);
    await expect(
      getIncorporationCaseForActor(actor, "missing", { repository: repo }),
    ).resolves.toBeNull();
    expect(repo.getCase).not.toHaveBeenCalled();
  });

  it("returns null if the case disappears between lookup and hydration", async () => {
    const repo = repository();
    repo.getCase.mockResolvedValue(null);
    await expect(
      getIncorporationCaseForActor(actor, record.id, { repository: repo }),
    ).resolves.toBeNull();
  });

  it("preserves repository errors", async () => {
    const repo = repository();
    repo.getCaseTeamId.mockRejectedValue(new Error("connection reset"));
    await expect(
      getIncorporationCaseForActor(actor, record.id, { repository: repo }),
    ).rejects.toThrow("connection reset");
  });
});
