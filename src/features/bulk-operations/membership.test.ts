import { expect, it, vi } from "vitest";
import { readSnapshotMembership } from "./membership";
it("keeps filtered snapshot controls usable above the per-request5000 membership bound", async () => {
  const ids = Array.from(
    { length: 5001 },
    (_, i) => `40000000-0000-0000-0000-${String(i + 1).padStart(12, "0")}`,
  );
  const read = vi.fn(async (input: { data: { snapshotId: string; ids: string[] } }) => {
    if (input.data.ids.length > 5000) throw new Error("strict RPC limit");
    return { ids: input.data.ids.filter((id) => id !== ids[0]) };
  });
  const result = await readSnapshotMembership("60000000-0000-0000-0000-000000000001", ids, read);
  expect(result.ids).toHaveLength(5000);
  expect(result.ids).not.toContain(ids[0]);
  expect(read.mock.calls.every(([c]) => c.data.ids.length <= 5000)).toBe(true);
});
