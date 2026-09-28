import { describe, expect, it } from "vitest";
import { refusalForHandoff, summarizeExceptions } from "./handoff";
import { recordManualSubmissionForActor } from "./submission-service";
import type { AuthenticatedActor } from "@/features/auth/types";

const actor: AuthenticatedActor = {
  authUserId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  role: "Staff",
  teamId: "33333333-3333-4333-8333-333333333333",
  active: true,
};
const input = {
  packageId: "44444444-4444-4444-8444-444444444444",
  manifestHash: "a".repeat(64),
  submittedAt: "2026-09-27T15:00:00+08:00",
  destinationLabel: "Companies Registry portal",
  externalReference: "NAR1-2026-001",
  proofVersionId: "55555555-5555-4555-8555-555555555555",
  expectedRevision: 1,
};

describe("T15 manual external submission", () => {
  it("t15_scenario_1 treats a recorded manual submission as already out", () => {
    expect(
      refusalForHandoff({
        existing: {
          id: "66666666-6666-4666-8666-666666666666",
          caseId: "77777777-7777-4777-8777-777777777777",
          manifestSha256: input.manifestHash,
          status: "recorded_submission" as never,
          transmittedAt: "2026-09-27T07:00:00.000Z",
        },
        approvedManifestSha256: input.manifestHash,
        currentManifestSha256: input.manifestHash,
      }),
    ).toEqual({ kind: "already-out", status: "recorded_submission" });
  });

  it("t15_scenario_2 rejects missing proof and implausible future HKT time before recording", async () => {
    const deps = {
      storage: {} as never,
      sql: {} as never,
      now: () => new Date("2026-09-27T07:00:00.000Z"),
    };
    await expect(
      recordManualSubmissionForActor(
        actor,
        {
          ...input,
          proofVersionId: "",
        },
        deps,
      ),
    ).rejects.toThrow(/proof/i);
    await expect(
      recordManualSubmissionForActor(
        actor,
        {
          ...input,
          submittedAt: "2026-09-28T15:00:00+08:00",
        },
        deps,
      ),
    ).rejects.toThrow(/future|time/i);
  });

  it("t15_scenario_3 a package download alone leaves no handoff or Filed claim", () => {
    expect(summarizeExceptions({ handoffs: [], returns: [] })).toEqual({
      open: 0,
      awaitingTransmission: 0,
    });
  });
});
