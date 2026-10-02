import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import {
  assertHandoffRuntimeMode,
  runHandoffCommandForActor,
  exportApprovedHandoffForActor,
} from "./handoff-server-fns";
const actor: AuthenticatedActor = {
  userId: "11111111-1111-4111-8111-111111111111",
  authUserId: "synthetic-actor",
  role: "Staff",
  teamId: null,
  active: true,
};
const id = "22222222-2222-4222-8222-222222222222";
describe("manual handoff server boundary", () => {
  it("refuses demo and nonstaff before repository operations and rejects caller authority", () => {
    expect(() => assertHandoffRuntimeMode("local")).toThrow(/read-only/);
    expect(() => assertHandoffRuntimeMode("live")).not.toThrow();
    const repo = { approve: vi.fn() } as unknown as Parameters<typeof runHandoffCommandForActor>[2];
    const input = {
      command: "approve",
      caseId: id,
      expectedVersion: "version",
      manifestSha256: "a".repeat(64),
    };
    expect(() => runHandoffCommandForActor({ ...actor, role: "Client" }, input, repo)).toThrow(
      /staff/i,
    );
    expect(() =>
      runHandoffCommandForActor(actor, { ...input, approvedBy: actor.userId }, repo),
    ).toThrow();
    expect(repo.approve).not.toHaveBeenCalled();
  });
  it("does not record export when byte download fails or package version changes", async () => {
    const payload = JSON.stringify({
      manifest: {
        entries: [
          { documentId: id, documentVersionId: actor.userId, contentSha256: "a".repeat(64) },
        ],
      },
      paymentEvidence: null,
    });
    const repo = {
      approvedExport: vi.fn().mockResolvedValue({ id, manifestPayload: payload }),
      recordExport: vi.fn(),
    };
    await expect(
      exportApprovedHandoffForActor(
        actor,
        { handoffId: id, expectedVersion: "v" },
        {
          repository: repo,
          readVersion: async () => {
            throw new Error("Quarantine or unavailable R2");
          },
        },
      ),
    ).rejects.toThrow(/Quarantine/);
    expect(repo.recordExport).not.toHaveBeenCalled();
    const noBytes = JSON.stringify({ manifest: { entries: [] }, paymentEvidence: null });
    repo.approvedExport.mockResolvedValue({ id, manifestPayload: noBytes });
    repo.recordExport.mockRejectedValue(
      Object.assign(new Error("Version changed"), { statusCode: 409 }),
    );
    await expect(
      exportApprovedHandoffForActor(
        actor,
        { handoffId: id, expectedVersion: "v" },
        { repository: repo, readVersion: vi.fn() },
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});
