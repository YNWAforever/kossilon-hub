import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import { createClientForActor, createClientSchema } from "./server-fns";

const actor: AuthenticatedActor = {
  userId: "20000000-0000-4000-8000-000000000001",
  authUserId: "synthetic-client-create-admin",
  role: "Admin",
  teamId: "10000000-0000-4000-8000-000000000001",
  active: true,
};
const valid = {
  companyName: "Synthetic UC135–137",
  crNumber: "1200042",
  brNumber: "12345678-000-07-27-A",
  incorporationDate: "2020-01-01",
  annualReturnBasisDate: "2026-01-01",
  registeredOffice: "Synthetic office",
  companySecretary: "Synthetic secretary",
  ownerId: actor.userId!,
  teamId: actor.teamId!,
  contacts: [],
};
describe("UC135–137 client creation command", () => {
  it.each(["companyName", "registeredOffice", "companySecretary"] as const)(
    "UC135 rejects whitespace-only required %s before repository calls",
    async (field) => {
      const repository = { createClient: vi.fn() };
      await expect(
        createClientForActor(actor, { ...valid, [field]: " \t " }, repository),
      ).rejects.toMatchObject({
        issues: expect.arrayContaining([expect.objectContaining({ path: [field] })]),
      });
      expect(repository.createClient).not.toHaveBeenCalled();
    },
  );
  it.each([
    "companyName",
    "registeredOffice",
    "companySecretary",
    "crNumber",
    "brNumber",
    "incorporationDate",
    "annualReturnBasisDate",
    "ownerId",
    "teamId",
  ] as const)("UC135 rejects empty %s at its field", (field) => {
    const parsed = createClientSchema.safeParse({ ...valid, [field]: "" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) expect(parsed.error.issues.map((i) => i.path[0])).toContain(field);
  });
  it("UC137 normalizes full certificate and CR before writing, with trusted actor attribution", async () => {
    const saved = { id: crypto.randomUUID() };
    const repository = { createClient: vi.fn().mockResolvedValue(saved) };
    const result = await createClientForActor(
      actor,
      {
        ...valid,
        crNumber: " f001 2345 ",
        brNumber: " 1234 5678-000-07-27-a ",
        actorId: "untrusted",
      } as typeof valid,
      repository,
    );
    expect(result).toBe(saved);
    expect(repository.createClient).toHaveBeenCalledExactlyOnceWith({
      ...valid,
      crNumber: "F0012345",
      brNumber: "12345678-000",
      actorId: actor.userId,
    });
  });
  it.each([
    { ...actor, active: false },
    { ...actor, role: "Client" as const },
    { ...actor, userId: null },
    { ...actor, role: "Staff" as const, teamId: null },
    { ...actor, role: "Manager" as const, teamId: "10000000-0000-4000-8000-000000000002" },
  ])("rejects an unauthorized supplied actor before writing: %j", async (denied) => {
    const repository = { createClient: vi.fn() };
    await expect(createClientForActor(denied, valid, repository)).rejects.toThrow(/^Forbidden:/);
    expect(repository.createClient).not.toHaveBeenCalled();
  });
});
