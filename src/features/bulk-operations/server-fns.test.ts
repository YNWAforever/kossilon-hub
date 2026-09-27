import { describe, expect, it, vi } from "vitest";
import { bulkOperationCsv, withAuthorizedBulkRepository } from "./server-fns";
import type { createBulkOperationRepository } from "./repository";
import type { BulkOperationView } from "./types";

describe("T09 bulk status export", () => {
  it("exports 1000 progress rows without CSV formulas or customer payload", () => {
    const view: BulkOperationView = {
      id: "operation-1",
      action: "assign",
      state: "running",
      createdBy: "user-1",
      createdAt: "2026-09-27T02:00:00.000Z",
      counts: {
        pending: 100,
        running: 0,
        succeeded: 899,
        skipped: 0,
        conflict: 0,
        forbidden: 0,
        failed: 1,
        "needs-reconciliation": 0,
        cancelled: 0,
      },
      items: Array.from({ length: 1000 }, (_, index) => ({
        itemId: `item-${index}`,
        resourceId: `resource-${index}`,
        state:
          index < 100
            ? ("pending" as const)
            : index === 100
              ? ("failed" as const)
              : ("succeeded" as const),
        reasonCode: index === 100 ? '=HYPERLINK("https://private.example")' : null,
        revisionBefore: 1,
        revisionAfter: index > 100 ? 2 : null,
        auditRef: null,
      })),
    };
    const csv = bulkOperationCsv(view);
    expect(csv.trimEnd().split("\r\n")).toHaveLength(1001);
    expect(csv).toContain("resource-999");
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toContain('"=HYPERLINK');
    expect(csv).not.toContain("customer payload");
  });
  it("derives a verified staff actor before opening a bulk repository", async () => {
    const createRepository = vi.fn() as unknown as typeof createBulkOperationRepository;
    const requireActor = vi.fn(async () => {
      throw new Error("Unauthorized: verified session required.");
    });
    await expect(
      withAuthorizedBulkRepository(async () => "unsafe", {
        request: new Request("https://example.test/bulk"),
        requireActor,
        createRepository,
      }),
    ).rejects.toThrow(/unauthorized/i);
    expect(createRepository).not.toHaveBeenCalled();
  });
});
