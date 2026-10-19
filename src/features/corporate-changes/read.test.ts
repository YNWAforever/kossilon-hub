import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedActor } from "@/features/auth/types";
import { CorporateChangeRequestNotFoundError } from "./errors";
import { corporateChangeListTeamScope, getCorporateChangeRequestForActor } from "./read";
import type { CorporateChangeRequestDetail } from "./types";

const requestId = "11111111-1111-4111-8111-111111111111";
const request = { id: requestId, companyId: "company-1" } as CorporateChangeRequestDetail;

function actor(overrides: Partial<AuthenticatedActor> = {}): AuthenticatedActor {
  return {
    authUserId: "auth-1",
    userId: "user-1",
    role: "Staff",
    teamId: "team-a",
    active: true,
    ...overrides,
  };
}

function repository(teamId = "team-a", found = true) {
  return {
    getRequest: vi.fn(async () => {
      if (!found) throw new CorporateChangeRequestNotFoundError();
      return request;
    }),
    getCompanyTeamId: vi.fn(async () => teamId),
  };
}

describe("getCorporateChangeRequestForActor", () => {
  it("returns a request whose company belongs to the staff member's team", async () => {
    await expect(
      getCorporateChangeRequestForActor(actor(), requestId, { repository: repository() }),
    ).resolves.toBe(request);
  });

  // The list already hid other teams' requests; the detail read did not, so
  // any staff member could open one by its URL.
  it("refuses a request for another team's company", async () => {
    await expect(
      getCorporateChangeRequestForActor(actor(), requestId, {
        repository: repository("team-b"),
      }),
    ).rejects.toThrow(/^Forbidden: /);
  });

  it("lets an Admin read any team's request", async () => {
    await expect(
      getCorporateChangeRequestForActor(actor({ role: "Admin", teamId: null }), requestId, {
        repository: repository("team-b"),
      }),
    ).resolves.toBe(request);
  });

  it("reports a request that does not exist as null rather than a failure", async () => {
    await expect(
      getCorporateChangeRequestForActor(actor(), requestId, {
        repository: repository("team-a", false),
      }),
    ).resolves.toBeNull();
  });

  it("still surfaces any other failure", async () => {
    const failing = repository();
    failing.getRequest.mockRejectedValue(new Error("connection reset"));

    await expect(
      getCorporateChangeRequestForActor(actor(), requestId, { repository: failing }),
    ).rejects.toThrow("connection reset");
  });
});

describe("corporateChangeListTeamScope", () => {
  it("lets an Admin list every team", () => {
    expect(corporateChangeListTeamScope(actor({ role: "Admin", teamId: null }))).toBeUndefined();
  });

  it("limits anyone else to their own team", () => {
    expect(corporateChangeListTeamScope(actor())).toBe("team-a");
  });

  // A staff member with no team used to get an unscoped list — every team's
  // requests — while opening any one of them was refused.
  it("refuses a staff member with no team rather than listing every team", () => {
    expect(() => corporateChangeListTeamScope(actor({ teamId: null }))).toThrow(/^Forbidden: /);
  });
});
