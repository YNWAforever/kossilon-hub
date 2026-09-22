import { z } from "zod";

import {
  drainDocumentScanJobs,
  type ScanWorkerDependencies,
} from "@/features/documents/scan-worker";
import type { DispatchSummary } from "@/features/notifications/types";
import { createDocumentAiAnalyzerForProviderMode } from "@/features/documents/ai-provider";
import { extractPdfText } from "@/features/documents/text-extraction";
// Static, and honest about it. It was a dynamic import, which implied a
// code-split that cannot happen: analysis-worker below imports ai-provider
// statically, so the module is already in this graph either way. maintenance.ts
// as a whole is still lazily imported by server.ts, which is where the cold-start
// saving actually comes from.
import {
  drainDocumentAnalysisJobs,
  type AnalysisWorkerDependencies,
} from "@/features/documents/analysis-worker";
import type { MaintenanceRunDraft } from "@/features/operations/repository";
import {
  maintenanceResultOf,
  runScheduledMaintenance,
  type ScheduledMaintenanceResult,
} from "./cron";

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
    /**
     * Which trigger produced this run.
     *
     * Defaults to `manual`, deliberately. The health rule only counts scheduled
     * runs when deciding whether the cron is alive, so a caller that forgets to
     * say makes the schedule look *less* healthy than it is -- an under-report,
     * which is recoverable. The opposite default would let a runbook step or a
     * debugging invocation silence a dead cron, which is not.
     */
    triggerSource: z.enum(["scheduled", "manual"]).default("manual"),
  })
  .strict();

export type FirmMaintenanceInput = {
  now: string;
  dispatchLimit?: number;
  triggerSource?: "scheduled" | "manual";
};

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
  /**
   * Finalises jobs stranded in 'processing' on their final attempt, in both
   * document queues. Required rather than optional: unlike the drains it has to
   * run even with no scanner configured, which is when a stranded row is least
   * likely to be noticed.
   */
  failStrandedDocumentJobs(input: { now: string }): Promise<{ scans: number; analyses: number }>;
  createOutboxRepository(): MaintenanceOutboxRepository;
  /**
   * Where the tick's record goes.
   *
   * Optional only so the many existing tests of this function do not each need a
   * stub database. The production wiring in `runFirmMaintenance` always supplies
   * one, and `cron-wiring.test.ts` asserts that it does -- otherwise this
   * optionality would quietly become the deployed behaviour, which is exactly
   * the state Phase F exists to end.
   */
  createMaintenanceRunRecorder?(): MaintenanceRunRecorder | null;
};

export type MaintenanceRunRecorder = {
  recordRun(draft: MaintenanceRunDraft): Promise<{ id: string }>;
  close(): Promise<void>;
};

const DEFAULT_DISPATCH_LIMIT = 50;

/**
 * Persist what this tick did, and never let doing so change what it did.
 *
 * Two rules, both deliberate:
 *
 * A failed record write does not fail the run. All nine passes did their work;
 * turning a successful tick into a failed invocation over a bookkeeping insert
 * would be a worse outcome than losing the row. The loss is not silent either --
 * the health screen goes `stale` after two missed records, which raises an alarm
 * that is at least in the right subsystem.
 *
 * And the summary records a class, never a message. A top-level failure here is
 * usually the database itself, whose error text can carry a host or a
 * connection string, and this row is rendered on a screen. The full text still
 * goes to `console.error` in the worker exactly as it did before, so nothing
 * that was visible has become invisible.
 */
async function recordMaintenanceRun(
  recorder: MaintenanceRunRecorder | null,
  draft: MaintenanceRunDraft,
): Promise<void> {
  if (!recorder) return;
  try {
    await recorder.recordRun(draft);
  } catch (error) {
    console.error(
      "scheduled maintenance record failed",
      error instanceof Error ? error.name : "unknown",
    );
  }
}

export async function runFirmMaintenanceWithDependencies(
  input: FirmMaintenanceInput,
  dependencies: FirmMaintenanceDependencies,
): Promise<ScheduledMaintenanceResult> {
  const data = inputSchema.parse(input);

  // The recorder is built before anything else, and that ordering is the point.
  // A tick that dies while assembling its repositories -- a missing binding, a
  // Hyperdrive that will not resolve -- is precisely the failure worth a row,
  // and a recorder created after them would not exist yet to write one.
  const recorder = dependencies.createMaintenanceRunRecorder?.() ?? null;

  // All five repositories open a Postgres connection eagerly. They are still
  // created in one place and closed in one `finally` -- closing them inside each
  // pass would leak whichever connection the failing pass had already opened --
  // but now inside the try, so a constructor that throws is recorded rather than
  // escaping before this function has produced any evidence at all.
  let workItems: MaintenanceWorkItemRepository | null = null;
  let annualReturns: MaintenanceAnnualReturnRepository | null = null;
  let serviceSubscriptions: MaintenanceServiceSubscriptionRepository | null = null;
  let documents: MaintenanceDocumentRepository | null = null;
  let outbox: MaintenanceOutboxRepository | null = null;

  const startedAt = new Date();
  try {
    let result: ScheduledMaintenanceResult | null = null;
    let thrown: unknown = null;

    try {
      workItems = dependencies.createWorkItemRepository();
      annualReturns = dependencies.createAnnualReturnRepository();
      serviceSubscriptions = dependencies.createServiceSubscriptionRepository();
      documents = dependencies.createDocumentRepository();
      outbox = dependencies.createOutboxRepository();

      result = await runScheduledMaintenancePasses(data, dependencies, {
        workItems,
        annualReturns,
        serviceSubscriptions,
        documents,
        outbox,
      });
    } catch (error) {
      thrown = error;
      // A run whose passes failed still learned everything the others found,
      // and that partial result rides along on the error. Recording it is the
      // difference between "the tick was broken" and "the tick was broken and
      // here is what the eight working passes saw".
      result = maintenanceResultOf(error);
    }

    const finishedAt = new Date();
    await recordMaintenanceRun(recorder, {
      scheduledFor: data.now,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      outcome: thrown ? (result ? "partial" : "failed") : "succeeded",
      // The whole result, so a later reader is not limited to the fields
      // somebody thought to make columns. Null when the run did not get far
      // enough to have one.
      //
      // Except the failure messages, which are stripped to pass names. Keeping
      // them here would have quietly undone the sanitisation on failure_summary
      // directly beside it: a pass that throws from postgres.js carries a host
      // and can carry a connection string, and this column is read by a screen.
      // The full text still goes to console.error in the worker, which is where
      // it went before this table existed.
      passes: result
        ? { ...result, failures: result.failures.map(({ pass }) => ({ pass })) }
        : null,
      failedPasses: result?.failures.map((failure) => failure.pass) ?? [],
      failureSummary:
        thrown && !result
          ? `run did not complete: ${thrown instanceof Error ? thrown.name : "unknown"}`
          : null,
      triggerSource: data.triggerSource,
    });

    if (thrown) throw thrown;
    // Unreachable unless runScheduledMaintenance resolves undefined, which its
    // signature forbids; narrowing rather than a non-null assertion.
    if (!result) throw new Error("scheduled maintenance returned no result.");
    return result;
  } finally {
    // Only what was actually constructed. A run that threw partway through
    // assembly has connections open for the repositories that came first, and
    // those are exactly the ones that must still be closed.
    await Promise.all(
      [workItems, annualReturns, serviceSubscriptions, documents, outbox, recorder].map(
        (closeable) => closeable?.close() ?? Promise.resolve(),
      ),
    );
  }
}

/**
 * The pass wiring, lifted out so the recording above reads as one thing.
 *
 * Behaviour is unchanged: this is the body `runFirmMaintenanceWithDependencies`
 * used to have inline, and it still throws `MaintenancePassesFailedError` for
 * the caller to catch, record and rethrow.
 */
async function runScheduledMaintenancePasses(
  data: { now: string; dispatchLimit?: number },
  dependencies: FirmMaintenanceDependencies,
  repositories: {
    workItems: MaintenanceWorkItemRepository;
    annualReturns: MaintenanceAnnualReturnRepository;
    serviceSubscriptions: MaintenanceServiceSubscriptionRepository;
    documents: MaintenanceDocumentRepository;
    outbox: MaintenanceOutboxRepository;
  },
): Promise<ScheduledMaintenanceResult> {
  const { workItems, annualReturns, serviceSubscriptions, documents, outbox } = repositories;

  return await runScheduledMaintenance(
    data.now,
    {
      evaluateEscalations: (now) => workItems.evaluateEscalations(now),
      evaluateAnnualReturnReminders: (now) => annualReturns.evaluateReminders(now),
      evaluateServiceSubscriptionReminders: (now) => serviceSubscriptions.evaluateReminders(now),
      dispatchDue: (now, limit) => dependencies.dispatchDue({ now, limit }),
      failStrandedDocumentJobs: (now) => dependencies.failStrandedDocumentJobs({ now }),
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
  const operationsRepositoryModule = await import("@/features/operations/repository");
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
    failStrandedDocumentJobs: async ({ now }) => {
      const scans = scanJobsModule.createDocumentScanJobRepository();
      const analyses = analysisJobsModule.createDocumentAnalysisJobRepository();
      try {
        const [scanResult, analysisResult] = await Promise.all([
          scans.failStranded(now),
          analyses.failStranded(now),
        ]);
        return { scans: scanResult.failed, analyses: analysisResult.failed };
      } finally {
        await Promise.all([scans.close(), analyses.close()]);
      }
    },
    // Always supplied here, never conditionally. The dependency is optional on
    // the type so existing tests need no stub database; if production were
    // allowed to inherit that default, the tick would go on leaving no trace,
    // which is the entire fault Phase F set out to fix.
    createMaintenanceRunRecorder: () => operationsRepositoryModule.createMaintenanceRunRepository(),
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
        // Not provider-gated: extraction is local work in every mode, and the
        // scan gate inside the pass decides which bytes ever reach it.
        extractor: { extract: extractPdfText },
        texts: analysis,
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
