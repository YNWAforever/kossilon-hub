import { BLOCKED_INTEGRATIONS, type BlockedIntegrationId } from "./capabilities";
import type { MaintenanceHealth, MaintenanceRunRecord } from "./health";
import type { SchedulerOwner } from "./deployment-identity";

export type CapabilityState = "unconfigured" | "unverified" | "healthy" | "degraded" | "blocked";
export type CapabilityProbeEvidence = {
  reachable: "unknown" | "yes" | "no";
  lastSuccessAt: string | null;
  evidenceRef: string | null;
  deploymentRef: string | null;
  checkedAt: string;
};
export type CapabilityStatus = {
  id: BlockedIntegrationId;
  implemented: boolean;
  configured: boolean;
  reachable: "unknown" | "yes" | "no";
  lastSuccessAt: string | null;
  evidenceRef: string | null;
  state: CapabilityState;
  checkedAt: string;
};

const BINDINGS: Partial<Record<BlockedIntegrationId, readonly string[]>> = {
  "malware-scanner-provider": ["DOCUMENT_SCANNER_URL", "DOCUMENT_SCANNER_API_KEY"],
  "document-text-extraction": ["DOCUMENT_SCANNER_URL", "DOCUMENT_SCANNER_API_KEY"],
  "ai-provider": ["DOCUMENT_AI_URL", "DOCUMENT_AI_API_KEY"],
  "deployment-runtime": ["MAINTENANCE_SCHEDULER_OWNER", "CRON_SECRET"],
};
const IMPLEMENTED = new Set<BlockedIntegrationId>([
  "malware-scanner-provider",
  "document-text-extraction",
  "ai-provider",
  "deployment-runtime",
]);
/** Only names cross the server response boundary; binding values never enter status data. */
export const CAPABILITY_BINDING_NAMES = [...new Set(Object.values(BINDINGS).flat())];

export function presentCapabilityBindingNames(source: Record<string, unknown>): string[] {
  return CAPABILITY_BINDING_NAMES.filter(
    (name) => typeof source[name] === "string" && (source[name] as string).trim().length > 0,
  );
}

export function deriveCapabilityStatuses(input: {
  now: string;
  bindingNames: readonly string[];
  maintenance: MaintenanceHealth | null;
  deploymentRef?: string | null;
  schedulerOwner?: SchedulerOwner | null;
  recentRuns: readonly MaintenanceRunRecord[] | null;
  probes?: Partial<Record<BlockedIntegrationId, CapabilityProbeEvidence>>;
}): CapabilityStatus[] {
  const names = new Set(input.bindingNames);
  const latestScheduled = input.recentRuns?.find((run) => run.triggerSource === "scheduled");
  return BLOCKED_INTEGRATIONS.map(({ id }) => {
    const implemented = IMPLEMENTED.has(id);
    const required = BINDINGS[id];
    const configured =
      id === "deployment-runtime"
        ? input.schedulerOwner === "cloudflare" ||
          (input.schedulerOwner === "vercel" && names.has("CRON_SECRET"))
        : implemented && (required?.every((name) => names.has(name)) ?? false);
    const probe = input.probes?.[id];
    // A probe from another deployment or an impossible future timestamp cannot certify this one.
    const probeAge = probe ? Date.parse(input.now) - Date.parse(probe.checkedAt) : NaN;
    const currentProbe =
      probe &&
      input.deploymentRef &&
      probe.deploymentRef === input.deploymentRef &&
      Number.isFinite(probeAge) &&
      probeAge >= 0 &&
      probeAge <= 15 * 60_000
        ? probe
        : null;
    let reachable: CapabilityStatus["reachable"] = currentProbe?.reachable ?? "unknown";
    let lastSuccessAt = currentProbe?.lastSuccessAt ?? null;
    let evidenceRef = currentProbe?.evidenceRef ?? null;
    let state: CapabilityState = !implemented
      ? "blocked"
      : !configured
        ? "unconfigured"
        : "unverified";
    if (id === "deployment-runtime" && input.maintenance) {
      lastSuccessAt = input.maintenance.lastSuccessAt;
      evidenceRef = latestScheduled ? `maintenance_runs:${latestScheduled.id}` : null;
      if (input.maintenance.state === "stale") reachable = "no";
      else if (latestScheduled) reachable = "yes";
      if (["stale", "failing", "degraded"].includes(input.maintenance.state)) state = "degraded";
      else if (
        configured &&
        input.maintenance.state === "healthy" &&
        latestScheduled?.deploymentRef &&
        latestScheduled.deploymentRef === input.deploymentRef
      )
        state = "healthy";
      // Legacy rows without a deployment reference stay unverified.
    } else if (configured && currentProbe) {
      if (currentProbe.reachable === "no")
        state = currentProbe.lastSuccessAt ? "degraded" : "blocked";
      else if (
        currentProbe.reachable === "yes" &&
        currentProbe.lastSuccessAt &&
        currentProbe.deploymentRef &&
        currentProbe.evidenceRef
      )
        state = "healthy";
    }
    return {
      id,
      implemented,
      configured,
      reachable,
      lastSuccessAt,
      evidenceRef,
      state,
      checkedAt: input.now,
    };
  });
}
