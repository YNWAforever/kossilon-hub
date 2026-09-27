export type SchedulerOwner = "vercel" | "cloudflare";

/** Only a commit-shaped identifier may be stored as deployment evidence. */
export function deploymentRefFromRuntime(source: Record<string, unknown>): string | null {
  const candidate = source.VERCEL_GIT_COMMIT_SHA ?? source.DEPLOYMENT_SHA;
  return typeof candidate === "string" && /^[a-f0-9]{7,64}$/i.test(candidate)
    ? candidate.toLowerCase()
    : null;
}

export function schedulerOwnerFromRuntime(source: Record<string, unknown>): SchedulerOwner | null {
  return source.MAINTENANCE_SCHEDULER_OWNER === "vercel" ||
    source.MAINTENANCE_SCHEDULER_OWNER === "cloudflare"
    ? source.MAINTENANCE_SCHEDULER_OWNER
    : null;
}
