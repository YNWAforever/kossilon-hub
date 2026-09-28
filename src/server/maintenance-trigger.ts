/** Durable, per-job scheduled tick. This module does not import provider clients. */
export type MaintenanceJobKind =
  | "evaluateEscalations"
  | "settleNotificationAttempts"
  | "redactNotifications"
  | "escalateStalledQuarantine"
  | "runBulkOperations"
  | "runNarImportStageJobs"
  | "drainInboundMediaDownloads";
export type TriggerKind = "scheduled" | "manual";
export type JobOutcome = "succeeded" | "failed";
export type JobState = JobOutcome | "skipped" | "unknown";
export type PersistedJobState = JobOutcome | "claimed" | "started" | "unknown";

export type MaintenanceJobStore = {
  claim(input: {
    trigger: TriggerKind;
    scheduledAt: string;
    job: MaintenanceJobKind;
    runId: string;
    now: string;
    leaseExpiresAt: string;
  }): Promise<{ token: string } | null>;
  stateOf(scheduledAt: string, job: MaintenanceJobKind): Promise<PersistedJobState | null>;
  begin(scheduledAt: string, job: MaintenanceJobKind, token: string): Promise<boolean>;
  finish(
    scheduledAt: string,
    job: MaintenanceJobKind,
    token: string,
    outcome: JobOutcome,
  ): Promise<boolean>;
  close(): Promise<void>;
};

export type MaintenanceTickInput = {
  trigger: TriggerKind;
  scheduledAt: string;
  runId: string;
  allowedJobs: MaintenanceJobKind[];
};
export type MaintenanceTickResult = {
  trigger: TriggerKind;
  scheduledAt: string;
  runId: string;
  outcome: "succeeded" | "partial" | "skipped";
  jobs: { job: MaintenanceJobKind; state: JobState; priorState?: PersistedJobState | null }[];
};

const LEASE_MS = 15 * 60_000;

/** A session, user agent, or unsigned request is never a scheduler credential. */
export function authorizeMaintenanceRequest(request: Request, secret: string | undefined): boolean {
  if (request.method !== "GET" || !secret || secret.length < 16) return false;
  const supplied = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (supplied.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= supplied.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

export function createMaintenanceTrigger(input: {
  store: MaintenanceJobStore;
  runJob: (job: MaintenanceJobKind, scheduledAt: string) => Promise<unknown>;
  recordRun?: (result: MaintenanceTickResult) => Promise<void>;
  clock?: () => Date;
}) {
  const clock = input.clock ?? (() => new Date());
  return {
    async runMaintenanceTick(data: MaintenanceTickInput): Promise<MaintenanceTickResult> {
      if (!Number.isFinite(Date.parse(data.scheduledAt))) throw new Error("Invalid scheduledAt.");
      if (!data.runId.trim()) throw new Error("A runId is required.");
      if (!data.allowedJobs.length || new Set(data.allowedJobs).size !== data.allowedJobs.length)
        throw new Error("Jobs must be nonempty and unique.");
      const jobs: MaintenanceTickResult["jobs"] = [];
      for (const job of data.allowedJobs) {
        const now = clock().toISOString();
        const claim = await input.store.claim({
          trigger: data.trigger,
          scheduledAt: data.scheduledAt,
          job,
          runId: data.runId,
          now,
          leaseExpiresAt: new Date(Date.parse(now) + LEASE_MS).toISOString(),
        });
        if (!claim) {
          jobs.push({
            job,
            state: "skipped",
            priorState: await input.store.stateOf(data.scheduledAt, job),
          });
          continue;
        }
        const began = await input.store.begin(data.scheduledAt, job, claim.token);
        if (!began) {
          jobs.push({
            job,
            state: "skipped",
            priorState: await input.store.stateOf(data.scheduledAt, job),
          });
          continue;
        }
        let outcome: JobOutcome;
        try {
          await input.runJob(job, data.scheduledAt);
          outcome = "succeeded";
        } catch {
          // Error messages may contain provider payloads or secrets. The job
          // name and durable failed state are enough for the operations view.
          outcome = "failed";
        }
        try {
          const recorded = await input.store.finish(data.scheduledAt, job, claim.token, outcome);
          jobs.push({ job, state: recorded ? outcome : "unknown" });
        } catch {
          // A completed side effect with failed bookkeeping is unknown. The
          // started lease is never automatically reclaimed.
          jobs.push({ job, state: "unknown" });
        }
      }
      const ran = jobs.some(({ state }) => state !== "skipped");
      const failed = jobs.some(
        ({ state, priorState }) =>
          state === "failed" ||
          state === "unknown" ||
          (state === "skipped" && priorState !== "succeeded"),
      );
      const result: MaintenanceTickResult = {
        trigger: data.trigger,
        scheduledAt: data.scheduledAt,
        runId: data.runId,
        outcome: !ran ? "skipped" : failed ? "partial" : "succeeded",
        jobs,
      };
      if (ran) await input.recordRun?.(result);
      return result;
    },
  };
}
