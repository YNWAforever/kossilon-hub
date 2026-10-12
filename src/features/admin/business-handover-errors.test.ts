import { it, expect, vi } from "vitest";
import { transferStaffBusinessHandoverForActor } from "./server-fns";
import { BusinessHandoverRejection } from "./business-handover-errors";
it("returns definite pre-write refusal while preserving real unknown errors and rejecting non-Admin actors", async () => {
  const id = "11111111-1111-4111-8111-111111111111",
    actor = {
      userId: id,
      authUserId: "synthetic-boundary",
      role: "Admin" as const,
      teamId: null,
      active: true,
    },
    input = {
      userId: id,
      expectedVersion: 1,
      recipientId: id,
      operationId: id,
      item: { kind: "incorporation" as const, id, version: "a".repeat(32) },
    },
    repository = {
      transferBusinessHandover: vi
        .fn()
        .mockRejectedValue(new BusinessHandoverRejection("staff_version_conflict")),
    };
  expect(await transferStaffBusinessHandoverForActor(actor, input, repository)).toMatchObject({
    state: "rejected",
    reason: "staff_version_conflict",
  });
  repository.transferBusinessHandover.mockRejectedValue(Error("SQL transport uncertain"));
  await expect(transferStaffBusinessHandoverForActor(actor, input, repository)).rejects.toThrow(
    "SQL transport uncertain",
  );
  repository.transferBusinessHandover.mockClear();
  await expect(
    transferStaffBusinessHandoverForActor({ ...actor, role: "Manager" }, input, repository),
  ).rejects.toThrow(/Forbidden/);
  expect(repository.transferBusinessHandover).not.toHaveBeenCalled();
});
