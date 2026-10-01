import {
  createMaintenanceTrigger,
  type MaintenanceJobKind,
  type MaintenanceTickInput,
} from "./maintenance-trigger";
import { createMaintenanceJobRepository } from "@/features/operations/maintenance-job-repository";
import { createMaintenanceRunRepository } from "@/features/operations/repository";
export const SAFE_SCHEDULED_JOBS: readonly MaintenanceJobKind[] = [
  "evaluateEscalations",
  "settleNotificationAttempts",
  "redactNotifications",
  "escalateStalledQuarantine",
];

async function runSafeJob(job: MaintenanceJobKind, now: string): Promise<Record<string, number>> {
  if (job === "evaluateEscalations") {
    const { createWorkItemRepository } = await import("@/features/work-items/repository");
    const repository = createWorkItemRepository();
    try {
      return await repository.evaluateEscalations(now);
    } finally {
      await repository.close();
    }
  }
  if (job === "settleNotificationAttempts" || job === "redactNotifications") {
    const { createNotificationOutboxRepository } = await import("@/features/notifications/outbox");
    const repository = createNotificationOutboxRepository();
    try {
      return job === "settleNotificationAttempts"
        ? await repository.failStranded(now)
        : await repository.redactExpired(now);
    } finally {
      await repository.close();
    }
  }
  if (job === "escalateStalledQuarantine") {
    const { createDocumentRepository } = await import("@/features/documents/repository");
    const repository = createDocumentRepository();
    try {
      return { stalled: (await repository.listStalledQuarantine(now)).length };
    } finally {
      await repository.close();
    }
  }
  throw new Error("Job is outside the approved safe scheduler scope");
}

export async function runRuntimeMaintenanceTick(data: MaintenanceTickInput) {
  if (data.allowedJobs.some((job) => !SAFE_SCHEDULED_JOBS.includes(job)))
    throw new Error("Unapproved scheduled job");
  const store = createMaintenanceJobRepository(),
    runs = createMaintenanceRunRepository();
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
        const ref = process.env.VERCEL_GIT_COMMIT_SHA;
        await runs.recordRun({
          scheduledFor: data.scheduledAt,
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          durationMs: finishedAt.getTime() - startedAt.getTime(),
          outcome: failedPasses.length ? "partial" : "succeeded",
          passes: {
            ...result,
            executionScope: "safe-maintenance-only",
            triggerEvidence: data.triggerEvidence ?? "manual",
            platformTriggerVerified:
              data.trigger === "scheduled" && data.triggerEvidence === "native-hook",
            build: ref && /^[a-f0-9]{40}$/.test(ref) ? ref : "unknown",
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
