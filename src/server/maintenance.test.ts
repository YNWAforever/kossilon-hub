import { describe, expect, it, vi } from "vitest";

import { runFirmMaintenanceWithDependencies } from "./maintenance";
import type { FirmMaintenanceDependencies } from "./maintenance";
import { MaintenancePassesFailedError } from "./cron";

function dependencies(
  overrides: Partial<FirmMaintenanceDependencies> = {},
): FirmMaintenanceDependencies {
  return {
    createWorkItemRepository: () => ({
      evaluateEscalations: vi.fn(async () => ({ warnings: 1, breaches: 2 })),
      close: vi.fn(async () => {}),
    }),
    createAnnualReturnRepository: () => ({
      evaluateReminders: vi.fn(async () => ({ sent: 1, skipped: 0 })),
      close: vi.fn(async () => {}),
    }),
    createServiceSubscriptionRepository: () => ({
      evaluateReminders: vi.fn(async () => ({ sent: 1, skipped: 0 })),
      close: vi.fn(async () => {}),
    }),
    dispatchDue: vi.fn(async () => ({
      claimed: 4,
      sent: 3,
      retried: 1,
      permanentlyFailed: 0,
      superseded: 0,
      sentButUnrecorded: 0,
      suppressedFixtureOrigin: 0,
    })),
    createDocumentRepository: () => ({
      expireUploads: vi.fn(async () => [{ objectKey: "a" }, { objectKey: "b" }]),
      listStalledQuarantine: vi.fn(async () => []),
      close: vi.fn(async () => {}),
    }),
    createDocumentStorage: () => ({ delete: vi.fn(async () => {}) }),
    createOutboxRepository: () => ({
      failStranded: vi.fn(async () => ({ failed: 2 })),
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
      // No createScanWorker is supplied here, so the pass reports zeros. Asserted
      // explicitly rather than loosened away: zeros must mean "nothing was
      // scanned", never "everything is clear". `scanner` is what makes that
      // readable -- without it these zeros are identical to a tick where a real
      // scanner ran and found nothing due.
      documentScans: {
        claimed: 0,
        clean: 0,
        rejected: 0,
        retried: 0,
        failed: 0,
        superseded: 0,
        scanner: "not-configured",
      },
      // No createAnalysisWorker here, so the pass reports that it did not run
      // rather than zeros that would read as "analysed, nothing found".
      documentAnalysis: {
        claimed: 0,
        analysed: 0,
        awaitingScan: 0,
        retried: 0,
        failed: 0,
        superseded: 0,
        providerSkipped: 0,
        worker: "not-configured",
      },
      stalledQuarantine: { stalled: 0 },
      annualReturnReminders: { sent: 1, skipped: 0 },
      serviceSubscriptionReminders: { sent: 1, skipped: 0 },
      dispatch: {
        claimed: 4,
        sent: 3,
        retried: 1,
        permanentlyFailed: 0,
        superseded: 0,
        sentButUnrecorded: 0,
        suppressedFixtureOrigin: 0,
      },
      uploads: { expired: 2 },
      notifications: { strandedFailed: 2, redacted: 5 },
      failures: [],
    });
  });

  /**
   * The defect, at the layer where it actually occurred.
   *
   * `createScanWorker?.()` guards an ABSENT factory, not a throwing one, and the
   * production wiring in runFirmMaintenance always supplies the factory. In live
   * mode that factory resolved an R2 binding and a scanner config and threw when
   * either was missing -- the permanent state under
   * BLOCKED_INTEGRATION: malware-scanner-provider. The throw escaped the closure
   * and aborted the tick, so escalateStalledQuarantine, cleanupExpiredUploads and
   * redactNotifications never ran.
   *
   * The old test omitted createScanWorker entirely, which is why the behaviour
   * was certified green: it exercised the absent branch and never the throwing
   * one.
   */
  it("survives a scan worker factory that throws, and still runs the later passes", async () => {
    const expireUploads = vi.fn(async () => [{ objectKey: "a" }]);
    const listStalledQuarantine = vi.fn(async () => []);
    const redactExpired = vi.fn(async () => ({ redacted: 5 }));

    const error = await runFirmMaintenanceWithDependencies(
      { now: "2026-07-26T00:00:00.000Z", dispatchLimit: 7 },
      dependencies({
        createScanWorker: () => {
          throw new Error(
            "Live document scanning requires DOCUMENT_SCANNER_URL and DOCUMENT_SCANNER_API_KEY.",
          );
        },
        createDocumentRepository: () => ({
          expireUploads,
          listStalledQuarantine,
          close: vi.fn(async () => {}),
        }),
        createOutboxRepository: () => ({
          failStranded: vi.fn(async () => ({ failed: 2 })),
          redactExpired,
          close: vi.fn(async () => {}),
        }),
      }),
    ).catch((thrown: unknown) => thrown);

    // The run still fails, so nothing can mistake a broken tick for a clean one.
    expect(error).toBeInstanceOf(MaintenancePassesFailedError);
    const result = (error as MaintenancePassesFailedError).result;

    // Null, not zeros: the pass produced no information at all.
    expect(result.documentScans).toBeNull();
    expect(result.failures).toEqual([
      {
        pass: "drainDocumentScanJobs",
        message:
          "Live document scanning requires DOCUMENT_SCANNER_URL and DOCUMENT_SCANNER_API_KEY.",
      },
    ]);

    // The three passes the throw used to take with it. The old comment on that
    // factory named the first of these as the thing keeping the backlog visible.
    expect(listStalledQuarantine).toHaveBeenCalled();
    expect(expireUploads).toHaveBeenCalled();
    expect(redactExpired).toHaveBeenCalled();
  });

  // Absent and null are different facts -- no scan pass wired at all, versus a
  // caller that looked and found no scanner configured -- but both are honest
  // "not-configured" rather than an error, and neither may fail the run.
  it("treats a scan worker factory that returns null as a disabled capability", async () => {
    const result = await runFirmMaintenanceWithDependencies(
      { now: "2026-07-26T00:00:00.000Z", dispatchLimit: 7 },
      dependencies({ createScanWorker: () => null }),
    );

    expect(result.documentScans).toMatchObject({ claimed: 0, scanner: "not-configured" });
    expect(result.failures).toEqual([]);
  });

  it("passes the dispatch limit through", async () => {
    const dispatchDue = vi.fn(async () => ({
      claimed: 0,
      sent: 0,
      retried: 0,
      permanentlyFailed: 0,
      superseded: 0,
      sentButUnrecorded: 0,
      suppressedFixtureOrigin: 0,
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

  it("closes every repository even when a pass throws", async () => {
    const closeWorkItems = vi.fn(async () => {});
    const closeAnnualReturns = vi.fn(async () => {});
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
          createAnnualReturnRepository: () => ({
            evaluateReminders: vi.fn(async () => ({ sent: 0, skipped: 0 })),
            close: closeAnnualReturns,
          }),
          createDocumentRepository: () => ({
            expireUploads: vi.fn(async () => []),
            listStalledQuarantine: vi.fn(async () => []),
            close: closeDocuments,
          }),
        }),
      ),
    ).rejects.toThrow("sla sweep failed");

    expect(closeWorkItems).toHaveBeenCalledTimes(1);
    expect(closeAnnualReturns).toHaveBeenCalledTimes(1);
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
