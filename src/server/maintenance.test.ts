import { describe, expect, it, vi } from "vitest";

import { runFirmMaintenanceWithDependencies } from "./maintenance";
import type { FirmMaintenanceDependencies } from "./maintenance";

function dependencies(
  overrides: Partial<FirmMaintenanceDependencies> = {},
): FirmMaintenanceDependencies {
  return {
    createWorkItemRepository: () => ({
      evaluateEscalations: vi.fn(async () => ({ warnings: 1, breaches: 2 })),
      close: vi.fn(async () => {}),
    }),
    dispatchDue: vi.fn(async () => ({
      claimed: 4,
      sent: 3,
      retried: 1,
      permanentlyFailed: 0,
    })),
    createDocumentRepository: () => ({
      expireUploads: vi.fn(async () => [{ objectKey: "a" }, { objectKey: "b" }]),
      close: vi.fn(async () => {}),
    }),
    createDocumentStorage: () => ({ delete: vi.fn(async () => {}) }),
    createOutboxRepository: () => ({
      redactExpired: vi.fn(async () => ({ redacted: 5 })),
      close: vi.fn(async () => {}),
    }),
    ...overrides,
  };
}

describe("runFirmMaintenanceWithDependencies", () => {
  it("returns the combined result of all three maintenance passes", async () => {
    const result = await runFirmMaintenanceWithDependencies(
      { now: "2026-07-26T00:00:00.000Z", dispatchLimit: 7 },
      dependencies(),
    );

    expect(result).toEqual({
      now: "2026-07-26T00:00:00.000Z",
      escalations: { warnings: 1, breaches: 2 },
      dispatch: { claimed: 4, sent: 3, retried: 1, permanentlyFailed: 0 },
      uploads: { expired: 2 },
      notifications: { redacted: 5 },
    });
  });

  it("passes the dispatch limit through", async () => {
    const dispatchDue = vi.fn(async () => ({
      claimed: 0,
      sent: 0,
      retried: 0,
      permanentlyFailed: 0,
    }));

    await runFirmMaintenanceWithDependencies(
      { now: "2026-07-26T00:00:00.000Z", dispatchLimit: 25 },
      dependencies({ dispatchDue }),
    );

    expect(dispatchDue).toHaveBeenCalledWith({ now: "2026-07-26T00:00:00.000Z", limit: 25 });
  });

  it("deletes the stored object behind every expired upload intent", async () => {
    const remove = vi.fn(async (_objectKey: string) => {});

    await runFirmMaintenanceWithDependencies(
      { now: "2026-07-26T00:00:00.000Z" },
      dependencies({ createDocumentStorage: () => ({ delete: remove }) }),
    );

    expect(remove.mock.calls.map(([key]) => key)).toEqual(["a", "b"]);
  });

  it("closes both repositories even when a pass throws", async () => {
    const closeWorkItems = vi.fn(async () => {});
    const closeDocuments = vi.fn(async () => {});

    // Escalation evaluation runs first, so its failure is the case that would
    // leak a Postgres connection for every later pass as well.
    await expect(
      runFirmMaintenanceWithDependencies(
        { now: "2026-07-26T00:00:00.000Z" },
        dependencies({
          createWorkItemRepository: () => ({
            evaluateEscalations: vi.fn(async () => {
              throw new Error("sla sweep failed");
            }),
            close: closeWorkItems,
          }),
          createDocumentRepository: () => ({
            expireUploads: vi.fn(async () => []),
            close: closeDocuments,
          }),
        }),
      ),
    ).rejects.toThrow("sla sweep failed");

    expect(closeWorkItems).toHaveBeenCalledTimes(1);
    expect(closeDocuments).toHaveBeenCalledTimes(1);
  });

  it("does not swallow a dispatch failure", async () => {
    await expect(
      runFirmMaintenanceWithDependencies(
        { now: "2026-07-26T00:00:00.000Z" },
        dependencies({
          dispatchDue: vi.fn(async () => {
            throw new Error("outbox unavailable");
          }),
        }),
      ),
    ).rejects.toThrow("outbox unavailable");
  });

  it("rejects a non-ISO timestamp rather than passing it to SQL", async () => {
    await expect(
      runFirmMaintenanceWithDependencies({ now: "yesterday" }, dependencies()),
    ).rejects.toThrow();
  });
});
