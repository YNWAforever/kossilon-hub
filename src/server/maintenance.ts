import { z } from "zod";

import {
  drainDocumentScanJobs,
  type ScanWorkerDependencies,
} from "@/features/documents/scan-worker";
import type { DispatchSummary } from "@/features/notifications/types";
import { runScheduledMaintenance, type ScheduledMaintenanceResult } from "./cron";

/**
 * Actor-free assembly of the periodic maintenance passes.
 *
 * `runScheduledMaintenance` in ./cron.ts has always been pure and tested, but
 * nothing ever called it: `wrangler.template.jsonc` declares a 5-minute cron
 * while the Worker exposed only `fetch`, so SLA escalations were never
 * evaluated, the notification outbox was never dispatched, and expired upload
 * intents were never reclaimed.
 *
 * This module supplies the missing half — the real repositories and storage —
 * without going through `server-fns.ts`. Those handlers all derive an actor
 * from the incoming request (`requireStaffActor`, and an Admin check on
 * `cleanupExpiredUploads`), which a scheduler has no way to satisfy. Trigger
 * mechanisms stay out of here deliberately, so the same entrypoint serves the
 * Cloudflare `cloudflare:scheduled` nitro hook, a platform cron route, or an
 * operator running it by hand.
 */

const inputSchema = z
  .object({
    now: z.string().datetime(),
    dispatchLimit: z.number().int().min(1).max(500).optional(),
  })
  .strict();

export type FirmMaintenanceInput = { now: string; dispatchLimit?: number };

type MaintenanceWorkItemRepository = {
  evaluateEscalations(now?: string): Promise<{ warnings: number; breaches: number }>;
  close(): Promise<void>;
};

type MaintenanceAnnualReturnRepository = {
  evaluateReminders(now?: string): Promise<{ sent: number; skipped: number }>;
  close(): Promise<void>;
};

type MaintenanceServiceSubscriptionRepository = {
  evaluateReminders(now?: string): Promise<{ sent: number; skipped: number }>;
  close(): Promise<void>;
};

type MaintenanceDocumentRepository = {
  expireUploads(now: string): Promise<readonly { objectKey: string }[]>;
  listStalledQuarantine(now: string, limit?: number): Promise<readonly { id: string }[]>;
  close(): Promise<void>;
};

type MaintenanceOutboxRepository = {
  failStranded(now: string): Promise<{ failed: number }>;
  redactExpired(now: string): Promise<{ redacted: number }>;
  close(): Promise<void>;
};

export type FirmMaintenanceDependencies = {
  createWorkItemRepository(): MaintenanceWorkItemRepository;
  createAnnualReturnRepository(): MaintenanceAnnualReturnRepository;
  createServiceSubscriptionRepository(): MaintenanceServiceSubscriptionRepository;
  dispatchDue(input: { now: string; limit: number }): Promise<DispatchSummary>;
  createDocumentRepository(): MaintenanceDocumentRepository;
  createDocumentStorage(): { delete(objectKey: string): Promise<void> };
  /**
   * The scan pass, assembled by the caller so this module stays free of provider
   * resolution. It is optional because live mode has no scanner configured yet
   * (BLOCKED_INTEGRATION: malware-scanner-provider) and a maintenance run must
   * not fail wholesale for that -- the queue simply keeps its backlog, visibly,
   * which is the accurate state.
   */
  createScanWorker?(): ScanWorkerDependencies & { close(): Promise<void> };
  createOutboxRepository(): MaintenanceOutboxRepository;
};

const DEFAULT_DISPATCH_LIMIT = 50;

export async function runFirmMaintenanceWithDependencies(
  input: FirmMaintenanceInput,
  dependencies: FirmMaintenanceDependencies,
): Promise<ScheduledMaintenanceResult> {
  const data = inputSchema.parse(input);

  // All five repositories open a Postgres connection eagerly, so they are
  // created up front and closed in one `finally`. Closing them inside each
  // pass would leak whichever connection the failing pass had already opened.
  const workItems = dependencies.createWorkItemRepository();
  const annualReturns = dependencies.createAnnualReturnRepository();
  const serviceSubscriptions = dependencies.createServiceSubscriptionRepository();
  const documents = dependencies.createDocumentRepository();
  const outbox = dependencies.createOutboxRepository();

  try {
    return await runScheduledMaintenance(
      data.now,
      {
        evaluateEscalations: (now) => workItems.evaluateEscalations(now),
        evaluateAnnualReturnReminders: (now) => annualReturns.evaluateReminders(now),
        evaluateServiceSubscriptionReminders: (now) => serviceSubscriptions.evaluateReminders(now),
        dispatchDue: (now, limit) => dependencies.dispatchDue({ now, limit }),
        drainDocumentScanJobs: async (now) => {
          const worker = dependencies.createScanWorker?.();
          if (!worker) {
            // No scanner configured. Reporting zeros is honest: nothing was
            // claimed and nothing was verdicted. It must never be read as "all
            // clear" -- escalateStalledQuarantine below is what surfaces the
            // backlog that results.
            return { claimed: 0, clean: 0, rejected: 0, retried: 0, failed: 0, superseded: 0 };
          }
          try {
            return await drainDocumentScanJobs({ now }, worker);
          } finally {
            await worker.close();
          }
        },
        escalateStalledQuarantine: async (now) => {
          const stalled = await documents.listStalledQuarantine(now);
          return { stalled: stalled.length };
        },
        cleanupExpiredUploads: async (now) => {
          const expired = await documents.expireUploads(now);
          const storage = dependencies.createDocumentStorage();
          await Promise.all(expired.map((intent) => storage.delete(intent.objectKey)));
          return { expired: expired.length };
        },
        failStrandedNotifications: (now) => outbox.failStranded(now),
        redactNotifications: (now) => outbox.redactExpired(now),
      },
      { dispatchLimit: data.dispatchLimit ?? DEFAULT_DISPATCH_LIMIT },
    );
  } finally {
    await Promise.all([
      workItems.close(),
      annualReturns.close(),
      serviceSubscriptions.close(),
      documents.close(),
      outbox.close(),
    ]);
  }
}

/**
 * Production wiring. Imports are deferred so this module stays loadable from
 * tests and offline validators that have no database binding.
 */
export async function runFirmMaintenance(
  input: FirmMaintenanceInput,
): Promise<ScheduledMaintenanceResult> {
  const [
    workItemsModule,
    annualReturnModule,
    serviceSubscriptionsModule,
    documentsModule,
    dispatchModule,
    documentServerFnsModule,
    providerModeModule,
    runtimeEnvModule,
    outboxModule,
  ] = await Promise.all([
    import("@/features/work-items/repository"),
    import("@/features/annual-return/repository"),
    import("@/features/service-subscriptions/repository"),
    import("@/features/documents/repository"),
    import("@/features/notifications/runtime-dispatch"),
    import("@/features/documents/server-fns"),
    import("@/server/provider-mode"),
    import("@/server/runtime-env"),
    import("@/features/notifications/outbox"),
  ]);
  const scanJobsModule = await import("@/features/documents/scan-jobs");

  return runFirmMaintenanceWithDependencies(input, {
    createWorkItemRepository: () => workItemsModule.createWorkItemRepository(),
    createAnnualReturnRepository: () => annualReturnModule.createAnnualReturnRepository(),
    createServiceSubscriptionRepository: () =>
      serviceSubscriptionsModule.createServiceSubscriptionRepository(),
    createDocumentRepository: () => documentsModule.createDocumentRepository(),
    createOutboxRepository: () => outboxModule.createNotificationOutboxRepository(),
    createScanWorker: () => {
      const providerMode = providerModeModule.currentProviderMode();
      const storage = documentServerFnsModule.createDocumentStorageForProviderMode(
        providerMode,
        providerMode === "live" ? runtimeEnvModule.getDocumentsBucketBinding() : undefined,
      );
      // Throws in live when DOCUMENT_SCANNER_* is unset, which is deliberate:
      // there is no fallback scanner, because a fallback is exactly how a fake
      // "clean" reached production in the first place. The caller treats the
      // absence as "no scan pass this tick" and the backlog stays visible.
      const scanner = documentServerFnsModule.createDocumentScannerForProviderMode(providerMode, {
        config: providerMode === "live" ? runtimeEnvModule.getDocumentScannerConfig() : null,
        storage,
      });
      const jobs = scanJobsModule.createDocumentScanJobRepository();
      const documents = documentsModule.createDocumentRepository();
      return {
        jobs,
        documents,
        storage,
        scanner,
        close: async () => {
          await Promise.all([jobs.close(), documents.close()]);
        },
      };
    },
    dispatchDue: (dispatchInput) => dispatchModule.dispatchDueNotificationsOnServer(dispatchInput),
    createDocumentStorage: () => {
      // Live mode throws without a real bucket, so resolve the binding the same
      // way the request-scoped document context does.
      const providerMode = providerModeModule.currentProviderMode();
      return documentServerFnsModule.createDocumentStorageForProviderMode(
        providerMode,
        providerMode === "live" ? runtimeEnvModule.getDocumentsBucketBinding() : undefined,
      );
    },
  });
}
