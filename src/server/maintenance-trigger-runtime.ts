import {
  createMaintenanceTrigger,
  type MaintenanceJobKind,
  type MaintenanceTickInput,
} from "./maintenance-trigger";
import { createMaintenanceJobRepository } from "@/features/operations/maintenance-job-repository";
import {
  createMaintenanceRunRepository,
  type MaintenanceRunRepository,
} from "@/features/operations/repository";
import { assertMaintenanceSchema, MaintenanceSchemaError } from "./maintenance-schema";
export const SAFE_SCHEDULED_JOBS: readonly MaintenanceJobKind[] = [
  "evaluateEscalations",
  "settleNotificationAttempts",
  "redactNotifications",
  "escalateStalledQuarantine",
  "runBulkAssignments",
];

async function runSafeJob(job: MaintenanceJobKind, now: string): Promise<Record<string, number>> {
  if (job === "runBulkAssignments") {
    const [{ createBulkOperationsRepository }, { runScheduledBulkAssignments }] = await Promise.all(
      [
        import("@/features/bulk-operations/repository"),
        import("@/features/bulk-operations/worker"),
      ],
    );
    return runScheduledBulkAssignments({ repository: createBulkOperationsRepository() });
  }
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

export type RuntimeMaintenanceDependencies = {
  createRunRepository(): Pick<MaintenanceRunRepository, "schemaCatalog" | "recordRun" | "close">;
  createJobRepository: typeof createMaintenanceJobRepository;
  runJob: typeof runSafeJob;
};

export async function runRuntimeMaintenanceTick(
  data: MaintenanceTickInput,
  dependencies: RuntimeMaintenanceDependencies = {
    createRunRepository: createMaintenanceRunRepository,
    createJobRepository: createMaintenanceJobRepository,
    runJob: runSafeJob,
  },
) {
  if (data.allowedJobs.some((job) => !SAFE_SCHEDULED_JOBS.includes(job)))
    throw new Error("Unapproved scheduled job");
  const runs = dependencies.createRunRepository();
  let store: ReturnType<typeof createMaintenanceJobRepository> | undefined;
  const startedAt = new Date();
  try {
    // A failed precondition must not write even a failed heartbeat into a
    // schema this build cannot trust. Do not cache: a later retry reads anew.
    try {
      assertMaintenanceSchema(await runs.schemaCatalog());
    } catch {
      throw new MaintenanceSchemaError();
    }
    store = dependencies.createJobRepository();
    const trigger = createMaintenanceTrigger({
      store,
      runJob: dependencies.runJob,
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
          // The existing ledger has no skipped outcome, and partial requires a
          // named failed pass. Use its non-success envelope without inventing
          // job failures; passes.outcome/counts retain the exact skipped fact.
          outcome:
            result.outcome === "skipped" ? "failed" : failedPasses.length ? "partial" : "succeeded",
          passes: {
            ...result,
            executionScope: "safe-maintenance-only",
            triggerEvidence: data.triggerEvidence ?? "manual",
            platformTriggerVerified:
              data.trigger === "scheduled" && data.triggerEvidence === "native-hook",
            build: ref && /^[a-f0-9]{40}$/.test(ref) ? ref : "unknown",
          },
          failedPasses,
          failureSummary:
            result.outcome === "skipped"
              ? "Invocation skipped; no maintenance jobs were performed. Inspect prior durable job states."
              : null,
          triggerSource: data.trigger,
        });
      },
    });
    return await trigger.runMaintenanceTick(data);
  } finally {
    await Promise.all([store?.close(), runs.close()]);
  }
}
