import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentAnnualReturnActorId } from "./session";

const STAFF_ACTOR_ID = "20000000-0000-0000-0000-000000000003";
const requireStaffActor = vi.hoisted(() => vi.fn());

vi.mock("@/features/auth/neon-auth-server", () => ({ requireStaffActor }));

describe("annual return session actor", () => {
  beforeEach(() => {
    requireStaffActor.mockReset();
  });

  it("derives the actor id from a verified staff session", async () => {
    requireStaffActor.mockResolvedValue({
      authUserId: "auth-staff-1",
      userId: STAFF_ACTOR_ID,
      role: "Staff",
      teamId: null,
      active: true,
    });
    const request = new Request("https://example.test/annual-returns");

    await expect(getCurrentAnnualReturnActorId(request)).resolves.toBe(STAFF_ACTOR_ID);
    expect(requireStaffActor).toHaveBeenCalledWith(request, {});
  });

  it("fails closed when staff authorization is denied", async () => {
    requireStaffActor.mockRejectedValue(new Error("Unauthorized: verified session required."));

    await expect(
      getCurrentAnnualReturnActorId(new Request("https://example.test/annual-returns")),
    ).rejects.toThrow(/unauthorized/i);
  });
});
