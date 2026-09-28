import { createMaintenanceJobRepository } from "@/features/operations/maintenance-job-repository";
import { createMaintenanceRunRepository } from "@/features/operations/repository";
import { deploymentRefFromRuntime } from "@/features/operations/deployment-identity";
import { getWhatsAppMediaConfig } from "./runtime-env";
import { normalizeProviderMode } from "./provider-mode";
import {
  createMaintenanceTrigger,
  type MaintenanceJobKind,
  type MaintenanceTickInput,
} from "./maintenance-trigger";

/** Initial scheduler scope: no provider sends, reminder enqueue, uploads or scanner calls. */
export const INITIAL_SCHEDULED_JOBS: readonly MaintenanceJobKind[] = [
  "evaluateEscalations",
  "settleNotificationAttempts",
  "redactNotifications",
  "escalateStalledQuarantine",
  "runBulkOperations",
];

export function scheduledJobsForRuntime(
  env: Record<string, unknown> = process.env,
): MaintenanceJobKind[] {
  // The unverified provider mapping must not create a falsely successful cron
  // pass or start fetching real client attachments.
  const jobs: MaintenanceJobKind[] = [...INITIAL_SCHEDULED_JOBS];
  if (
    normalizeProviderMode(env.VITE_PROVIDER_MODE ?? import.meta.env.VITE_PROVIDER_MODE) === "live"
  ) {
    jobs.push("runNarImportStageJobs");
  }
  if (getWhatsAppMediaConfig(env)) jobs.push("drainInboundMediaDownloads");
  return jobs;
}

async function runSafeJob(job: MaintenanceJobKind, scheduledAt: string): Promise<unknown> {
  if (job === "drainInboundMediaDownloads") {
    const config = getWhatsAppMediaConfig();
    if (!config) throw new Error("WOZTELL inbound media mapping or scoped token is unverified.");
    const [
      { createDocumentStorageForProviderMode },
      { currentProviderMode },
      { getDocumentsBucketBinding },
      { createMediaDownloadJobRepository },
      { drainInboundMediaDownloads },
    ] = await Promise.all([
      import("@/features/documents/server-fns"),
      import("./provider-mode"),
      import("./runtime-env"),
      import("@/features/whatsapp/media-download-jobs"),
      import("@/features/whatsapp/media-download-worker"),
    ]);
    const mode = currentProviderMode();
    if (mode !== "live") throw new Error("Inbound media download needs live private storage.");
    const storage = createDocumentStorageForProviderMode(mode, getDocumentsBucketBinding());
    const jobs = createMediaDownloadJobRepository();
    try {
      return await drainInboundMediaDownloads(scheduledAt, {
        jobs,
        media: { ...config, storage },
        limit: 10,
      });
    } finally {
      await jobs.close();
    }
  }
  if (job === "evaluateEscalations") {
    const { createWorkItemRepository } = await import("@/features/work-items/repository");
    const repository = createWorkItemRepository();
    try {
      return await repository.evaluateEscalations(scheduledAt, 100);
    } finally {
      await repository.close();
    }
  }
  if (job === "runNarImportStageJobs") {
    const [
      { createNarImportStageJobRepository },
      { createNarImportRepository },
      { createDocumentStorage },
      { getDocumentsBucketBinding },
      { stageNarImportBytesForActor },
      { drainNarImportStageJobs },
    ] = await Promise.all([
      import("@/features/nar-import/stage-jobs"),
      import("@/features/nar-import/repository"),
      import("@/features/documents/storage"),
      import("./runtime-env"),
      import("@/features/nar-import/server-fns"),
      import("@/features/nar-import/stage-worker"),
    ]);
    const jobs = createNarImportStageJobRepository();
    const repository = createNarImportRepository();
    try {
      return await drainNarImportStageJobs(scheduledAt, {
        jobs,
        storage: createDocumentStorage(getDocumentsBucketBinding()),
        stage: (actor, input) => stageNarImportBytesForActor(actor, input, { repository }),
      });
    } finally {
      await Promise.all([jobs.close(), repository.close()]);
    }
  }
  if (job === "runBulkOperations") {
    const { runDueBulkOperations } = await import("@/features/bulk-operations/runner");
    return runDueBulkOperations({ maxOperations: 2, maxItemsPerOperation: 25 });
  }
  if (job === "settleNotificationAttempts" || job === "redactNotifications") {
    const { createNotificationOutboxRepository } = await import("@/features/notifications/outbox");
    const repository = createNotificationOutboxRepository();
    try {
      return job === "settleNotificationAttempts"
        ? await repository.failStranded(scheduledAt, 500)
        : await repository.redactExpired(scheduledAt, 500);
    } finally {
      await repository.close();
    }
  }
  const { createDocumentRepository } = await import("@/features/documents/repository");
  const repository = createDocumentRepository();
  try {
    const stalled = await repository.listStalledQuarantine(scheduledAt, 500);
    return { stalled: stalled.length };
  } finally {
    await repository.close();
  }
}

export async function runMaintenanceTickOnServer(data: MaintenanceTickInput) {
  const store = createMaintenanceJobRepository();
  const runs = createMaintenanceRunRepository();
  const startedAt = new Date();
  try {
    const trigger = createMaintenanceTrigger({
      store,
      runJob: runSafeJob,
      recordRun: async (result) => {
        const finishedAt = new Date();
        const failedPasses = result.jobs
          .filter(
            ({ state, priorState }) =>
              state === "failed" ||
              state === "unknown" ||
              (state === "skipped" && priorState !== "succeeded"),
          )
          .map(({ job }) => job);
        await runs.recordRun({
          scheduledFor: data.scheduledAt,
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          outcome: result.outcome === "partial" ? "partial" : "succeeded",
          passes: {
            runId: data.runId,
            jobs: result.jobs,
            deploymentRef: deploymentRefFromRuntime(process.env),
          },
          failedPasses,
          failureSummary: null,
          triggerSource: data.trigger,
        });
      },
    });
    return await trigger.runMaintenanceTick(data);
  } finally {
    await Promise.all([store.close(), runs.close()]);
  }
}

export function scheduledSlot(now: Date, intervalMinutes = 5): string {
  const interval = intervalMinutes * 60_000;
  return new Date(Math.floor(now.getTime() / interval) * interval).toISOString();
}
