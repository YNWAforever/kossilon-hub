import { createMaintenanceJobRepository } from "@/features/operations/maintenance-job-repository";
import { createMaintenanceRunRepository } from "@/features/operations/repository";
import { deploymentRefFromRuntime } from "@/features/operations/deployment-identity";
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
];

async function runSafeJob(job: MaintenanceJobKind, scheduledAt: string): Promise<unknown> {
  if (job === "evaluateEscalations") {
    const { createWorkItemRepository } = await import("@/features/work-items/repository");
    const repository = createWorkItemRepository();
    try {
      return await repository.evaluateEscalations(scheduledAt, 100);
    } finally {
      await repository.close();
    }
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
