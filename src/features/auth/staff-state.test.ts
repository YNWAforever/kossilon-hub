import { describe, expect, it, vi } from "vitest";
import {
  lockActiveStaffUser,
  readActiveStaffUser,
  StaffStateUnavailableError,
} from "./staff-state";

// Inert query boundary: these tests never construct a DB client.
type Query = Parameters<typeof readActiveStaffUser>[0];
describe("staff state failures stay distinguishable from storage failures", () => {
  it("identifies a confirmed missing active consistent profile", async () => {
    const query = vi.fn().mockResolvedValue([]) as unknown as Query;
    await expect(readActiveStaffUser(query, "synthetic-user")).rejects.toBeInstanceOf(
      StaffStateUnavailableError,
    );
  });
  it.each([false, true])(
    "preserves an unknown DB failure without turning it into ineligibility: lock=%s",
    async (locked) => {
      const failure = Object.assign(new Error("Synthetic connection unavailable"), {
        code: "08006",
      });
      const query = vi.fn((parts: TemplateStringsArray) =>
        parts[0].includes("select u.id") ? Promise.reject(failure) : undefined,
      ) as unknown as Query;
      await expect(
        locked
          ? lockActiveStaffUser(
              query as Parameters<typeof lockActiveStaffUser>[0],
              "synthetic-user",
            )
          : readActiveStaffUser(query, "synthetic-user"),
      ).rejects.toBe(failure);
    },
  );
  it("returns the persisted access state unchanged", async () => {
    const row = { id: "synthetic-user", role: "Manager", team_id: "synthetic-team" };
    const query = vi.fn().mockResolvedValue([row]) as unknown as Query;
    await expect(readActiveStaffUser(query, row.id)).resolves.toBe(row);
  });
});
