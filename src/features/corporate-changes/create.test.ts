import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import { createCorporateChangeRequestForActor } from "./create";
const actor: AuthenticatedActor = {
  authUserId: "QA-UC166-Staff-A",
  userId: "f7337fb9-0166-4166-8166-000000000010",
  teamId: "f7337fb9-0166-4166-8166-000000000020",
  role: "Staff",
  active: true,
};
const data = {
  changeType: "share_transfer",
  companyId: "f7337fb9-0166-4166-8166-000000000001",
  quotedFee: 2500,
  transferorShareholdingId: "f7337fb9-0166-4166-8166-000000000002",
  transfereeShareholdingId: null,
  transfereeNewShareholderName: "QA Holder",
  transfereeNewShareholderAddress: null,
  sharesTransferred: 10,
  consideration: 0,
  stampDutyAmount: 0,
};
function repository(teamId: string | null = actor.teamId) {
  return { getCompanyTeamId: vi.fn(async () => teamId!), createRequest: vi.fn() };
}
describe("UC166 create rejects before any write", () => {
  it.each([
    { transfereeNewShareholderName: null },
    { transfereeNewShareholderName: "   " },
    { transfereeShareholdingId: "f7337fb9-0166-4166-8166-000000000003" },
    ...[0, -1, 1.5, NaN, Infinity, 2147483648].map((sharesTransferred) => ({ sharesTransferred })),
  ])("invalid %j performs no repository IO", async (override) => {
    const repo = repository();
    await expect(
      createCorporateChangeRequestForActor(actor, { ...data, ...override }, { repository: repo }),
    ).rejects.toHaveProperty("name", "ZodError");
    expect(repo.getCompanyTeamId).not.toHaveBeenCalled();
    expect(repo.createRequest).not.toHaveBeenCalled();
  });
  it.each([{ role: "Client" as const }, { active: false }, { teamId: null }, { userId: null }])(
    "refuses actor %j before repository IO",
    async (override) => {
      const repo = repository();
      await expect(
        createCorporateChangeRequestForActor({ ...actor, ...override }, data, { repository: repo }),
      ).rejects.toThrow(/^Forbidden:/);
      expect(repo.getCompanyTeamId).not.toHaveBeenCalled();
      expect(repo.createRequest).not.toHaveBeenCalled();
    },
  );
  it("refuses another team's company without writing", async () => {
    const repo = repository("f7337fb9-0166-4166-8166-000000000021");
    await expect(
      createCorporateChangeRequestForActor(actor, data, { repository: repo }),
    ).rejects.toThrow(/^Forbidden:/);
    expect(repo.createRequest).not.toHaveBeenCalled();
  });
  it("uses the actual actor, strips supplied identity and normalizes before writing", async () => {
    const repo = repository();
    repo.createRequest.mockResolvedValue({ id: "QA-UC166" });
    await expect(
      createCorporateChangeRequestForActor(
        actor,
        { ...data, actorId: "spoof", role: "Admin", transfereeNewShareholderName: "  QA Holder  " },
        { repository: repo },
      ),
    ).resolves.toMatchObject({ id: "QA-UC166" });
    expect(repo.createRequest).toHaveBeenCalledTimes(1);
    expect(repo.createRequest).toHaveBeenCalledWith({ ...data, actorId: actor.userId });
  });
  it("Admin positive control can create across teams", async () => {
    const repo = repository("f7337fb9-0166-4166-8166-000000000021");
    await createCorporateChangeRequestForActor({ ...actor, role: "Admin", teamId: null }, data, {
      repository: repo,
    });
    expect(repo.createRequest).toHaveBeenCalledTimes(1);
  });
});
