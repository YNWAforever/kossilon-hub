/** Durable, per-job scheduled tick. This module does not import provider clients. */
export type MaintenanceJobKind =
  | "evaluateEscalations"
  | "settleNotificationAttempts"
  | "redactNotifications"
  | "escalateStalledQuarantine"
  | "runBulkAssignments";
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
  triggerEvidence?: "native-hook" | "http-candidate" | "manual";
};
export type MaintenanceTickResult = {
  trigger: TriggerKind;
  scheduledAt: string;
  runId: string;
  outcome: "succeeded" | "partial" | "skipped";
  counts: { claimed: number; completed: number; failed: number; unknown: number; skipped: number };
  jobs: {
    job: MaintenanceJobKind;
    state: JobState;
    priorState?: PersistedJobState | null;
    result?: Record<string, number>;
  }[];
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
      let claimed = 0;
      for (const job of data.allowedJobs) {
        const now = clock().toISOString();
        let claim: Awaited<ReturnType<MaintenanceJobStore["claim"]>>;
        try {
          claim = await input.store.claim({
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
          claimed++;
          const began = await input.store.begin(data.scheduledAt, job, claim.token);
          if (!began) {
            jobs.push({
              job,
              state: "skipped",
              priorState: await input.store.stateOf(data.scheduledAt, job),
            });
            continue;
          }
        } catch {
          // Claim/begin acknowledgement can be lost after a durable write.
          // Do not execute or replay this job; retain partial run evidence
          // without persisting a database error payload.
          jobs.push({ job, state: "unknown" });
          continue;
        }
        let outcome: JobOutcome;
        let safeResult: Record<string, number> | undefined;
        try {
          const result = await input.runJob(job, data.scheduledAt);
          const keys: Record<MaintenanceJobKind, string[]> = {
            evaluateEscalations: ["warnings", "breaches"],
            settleNotificationAttempts: ["failed"],
            redactNotifications: ["redacted"],
            escalateStalledQuarantine: ["stalled"],
            runBulkAssignments: ["jobs", "processed"],
          };
          if (result && typeof result === "object")
            safeResult = Object.fromEntries(
              Object.entries(result).filter(
                ([key, value]) =>
                  keys[job].includes(key) && Number.isSafeInteger(value) && Number(value) >= 0,
              ),
            ) as Record<string, number>;
          outcome = "succeeded";
        } catch {
          // Error messages may contain provider payloads or secrets. The job
          // name and durable failed state are enough for the operations view.
          outcome = "failed";
        }
        try {
          const recorded = await input.store.finish(data.scheduledAt, job, claim.token, outcome);
          jobs.push({
            job,
            state: recorded ? outcome : "unknown",
            ...(recorded && safeResult ? { result: safeResult } : {}),
          });
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
        counts: {
          claimed,
          completed: jobs.filter((j) => j.state === "succeeded").length,
          failed: jobs.filter((j) => j.state === "failed").length,
          unknown: jobs.filter(
            (j) =>
              j.state === "unknown" ||
              (j.state === "skipped" && (j.priorState === "started" || j.priorState === "unknown")),
          ).length,
          skipped: jobs.filter((j) => j.state === "skipped").length,
        },
        jobs,
      };
      if (ran) await input.recordRun?.(result);
      return result;
    },
  };
}
