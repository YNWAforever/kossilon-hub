import { z } from "zod";

import {
  drainDocumentScanJobs,
  type ScanWorkerDependencies,
} from "@/features/documents/scan-worker";
import type { DispatchSummary } from "@/features/notifications/types";
import { createDocumentAiAnalyzerForProviderMode } from "@/features/documents/ai-provider";
// Static, and honest about it. It was a dynamic import, which implied a
// code-split that cannot happen: analysis-worker below imports ai-provider
// statically, so the module is already in this graph either way. maintenance.ts
// as a whole is still lazily imported by server.ts, which is where the cold-start
// saving actually comes from.
import {
  drainDocumentAnalysisJobs,
  type AnalysisWorkerDependencies,
} from "@/features/documents/analysis-worker";
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
   * resolution.
   *
   * Optional, and separately allowed to return null. The two are different
   * facts: absent means no caller wired a scan pass at all (a test), while null
   * means the caller looked and there is no scanner configured
   * (BLOCKED_INTEGRATION: malware-scanner-provider). Both report
   * scanner: "not-configured" and neither fails the run -- the queue keeps its
   * backlog, visibly, which is the accurate state.
   *
   * Returning null rather than throwing is load-bearing. `createScanWorker?.()`
   * guards an absent factory, not a throwing one, so a factory that threw here
   * aborted every later pass in the tick.
   */
  createScanWorker?(): (ScanWorkerDependencies & { close(): Promise<void> }) | null;
  /**
   * The analysis pass. Optional only so a test can leave it out; unlike the scan
   * worker it needs no provider, because the deterministic tiers run everywhere
   * and the model is the optional third tier.
   */
  createAnalysisWorker?(): (AnalysisWorkerDependencies & { close(): Promise<void> }) | null;
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
            // No scanner. Zeros alone would be ambiguous -- identical to a tick
            // where nothing was due -- so the pass says which it was. It must
            // never be read as "all clear": nothing was claimed and nothing was
            // verdicted, and every received file is still waiting.
            return {
              claimed: 0,
              clean: 0,
              rejected: 0,
              retried: 0,
              failed: 0,
              superseded: 0,
              scanner: "not-configured" as const,
            };
          }
          try {
            return { ...(await drainDocumentScanJobs({ now }, worker)), scanner: "ran" as const };
          } finally {
            await worker.close();
          }
        },
        drainDocumentAnalysisJobs: async (now) => {
          // Unlike the scan pass, this one needs no provider: the deterministic
          // tiers are real work that runs everywhere, and the model is the
          // optional third tier. So an absent worker here means a caller that
          // wired no analysis pass at all, not a disabled capability.
          const worker = dependencies.createAnalysisWorker?.();
          if (!worker) {
            return {
              claimed: 0,
              analysed: 0,
              awaitingScan: 0,
              retried: 0,
              failed: 0,
              superseded: 0,
              providerSkipped: 0,
              worker: "not-configured" as const,
            };
          }
          try {
            return {
              ...(await drainDocumentAnalysisJobs({ now }, worker)),
              worker: "ran" as const,
            };
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
  const analysisJobsModule = await import("@/features/documents/analysis-jobs");
  const analysisRepositoryModule = await import("@/features/documents/analysis-repository");

  return runFirmMaintenanceWithDependencies(input, {
    createWorkItemRepository: () => workItemsModule.createWorkItemRepository(),
    createAnnualReturnRepository: () => annualReturnModule.createAnnualReturnRepository(),
    createServiceSubscriptionRepository: () =>
      serviceSubscriptionsModule.createServiceSubscriptionRepository(),
    createDocumentRepository: () => documentsModule.createDocumentRepository(),
    createOutboxRepository: () => outboxModule.createNotificationOutboxRepository(),
    createScanWorker: () => {
      const providerMode = providerModeModule.currentProviderMode();

      // Asked before anything is built, and answered with null rather than a
      // throw.
      //
      // This used to fall through to createDocumentScannerForProviderMode, which
      // throws in live with no config. That is correct for that function -- there
      // is no fallback scanner, because a fallback is exactly how a fake "clean"
      // reached production in the first place -- but it was wrong here. The
      // caller guards `createScanWorker?.()`, which handles an ABSENT factory,
      // not a throwing one, and the production wiring always supplies the
      // factory. So under BLOCKED_INTEGRATION: malware-scanner-provider the
      // throw aborted the whole tick at the scan pass, taking
      // escalateStalledQuarantine, cleanupExpiredUploads and redactNotifications
      // with it -- including the very pass the old comment here named as the
      // thing that would keep the backlog visible.
      //
      // A deliberately disabled capability is not an error. It is reported as
      // scanner: "not-configured", and no scanner is still built.
      const scannerConfig =
        providerMode === "live" ? runtimeEnvModule.getDocumentScannerConfig() : null;
      if (providerMode === "live" && !scannerConfig) return null;

      const storage = documentServerFnsModule.createDocumentStorageForProviderMode(
        providerMode,
        providerMode === "live" ? runtimeEnvModule.getDocumentsBucketBinding() : undefined,
      );
      const scanner = documentServerFnsModule.createDocumentScannerForProviderMode(providerMode, {
        config: scannerConfig,
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
    createAnalysisWorker: () => {
      const providerMode = providerModeModule.currentProviderMode();

      // No `return null` for a missing model here, unlike the scan worker. The
      // deterministic tiers are the pass; the model is its optional third tier,
      // and createDocumentAiAnalyzerForProviderMode already returns null when
      // there is no provider (BLOCKED_INTEGRATION: ai-provider, which is always
      // today). The pass runs, does the real work, and reports providerSkipped.
      const storage = documentServerFnsModule.createDocumentStorageForProviderMode(
        providerMode,
        providerMode === "live" ? runtimeEnvModule.getDocumentsBucketBinding() : undefined,
      );
      const analyzer = createDocumentAiAnalyzerForProviderMode(providerMode, {
        config: providerMode === "live" ? runtimeEnvModule.getDocumentAiConfig() : null,
      });
      const jobs = analysisJobsModule.createDocumentAnalysisJobRepository();
      const analysis = analysisRepositoryModule.createDocumentAnalysisRepository();

      return {
        jobs,
        versions: analysis,
        findings: analysis,
        storage,
        analyzer,
        close: async () => {
          await Promise.all([jobs.close(), analysis.close()]);
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
