import { createServerFn } from "@tanstack/react-start";
import {
  BLOCKED_INTEGRATIONS,
  staleBlockedIntegrations,
  type BlockedIntegration,
  type BlockedIntegrationId,
  capabilityStatuses,
  type CapabilityStatus,
  type CapabilityId,
} from "./capabilities";
import {
  defaultToleranceSeconds,
  maintenanceHealthOf,
  type MaintenanceHealth,
  type MaintenanceRunRecord,
} from "./health";
import type { MaintenanceRunRepository, QueueDepths } from "./repository";
import { EXPECTED_MIGRATIONS, schemaHealthOf, type SchemaHealth } from "./schema-health";
import { compareRuntimeContracts } from "./release-catalog";
import {
  evaluateHistoricalReleaseCompatibility,
  type ApprovedRelease,
  type ReleaseCompatibility,
} from "./release-compatibility";

/**
 * What the operations screen reads.
 *
 * Staff-gated rather than admin-gated, deliberately. The question this answers
 * is "can I trust what the other screens are telling me" -- if reminders have
 * not been evaluated for six hours, the person who needs to know is whoever is
 * about to rely on the chase list, not only an administrator.
 */

export type OperationsHealthView = {
  /**
   * Read first, and separately, because it is the only read here that works on
   * a database this code cannot otherwise use.
   */
  schema: SchemaHealth;
  /** Historical release policy is distinct from ledger history and native health. */
  releaseCompatibility: ReleaseCompatibility | null;
  /**
   * Null when the schema is not current and these reads could not run.
   *
   * Nullable rather than absent, and never an empty stand-in: a zeroed queue
   * and a queue nobody could read are different facts, and only one of them is
   * good news.
   */
  maintenance: MaintenanceHealth | null;
  /** Most recent first, including manual runs, which the health rule ignores. */
  recentRuns: MaintenanceRunRecord[] | null;
  queues: QueueDepths | null;
  /**
   * Shown beside the health, never folded into it. Blocked integrations make
   * their maintenance passes report `not-configured` on every single tick,
   * permanently; a screen that counted those as faults would be red forever and
   * would stop meaning anything.
   */
  blockedIntegrations: readonly BlockedIntegration[];
  /**
   * Blockers still declared whose runtime evidence has arrived, so somebody can
   * go and delete them. Empty when the maintenance state is unknown -- an
   * unreadable database is not evidence that a schedule ran.
   */
  staleBlockers: readonly BlockedIntegrationId[];
  capabilities: CapabilityStatus[];
  lastSuccessLookupKnown: boolean;
  executionScope: string | null;
  schedulerLeases: Awaited<ReturnType<MaintenanceRunRepository["maintenanceLeaseHealth"]>> | null;
  diagnostics: { correlationId: string; failedReads: string[] } | null;
};

const RECENT_RUN_LIMIT = 12;

export async function buildOperationsHealth(
  input: { now: string },
  dependencies: {
    repository: Pick<
      MaintenanceRunRepository,
      | "listRecentRuns"
      | "listRecentScheduledRuns"
      | "lastScheduledSuccessAt"
      | "queueDepths"
      | "schemaLedger"
      | "textLayerObserved"
    > &
      Partial<
        Pick<
          MaintenanceRunRepository,
          "schemaCatalog" | "releaseCatalog" | "maintenanceLeaseHealth"
        >
      >;
    /** Reviewed, target/build-bound server artifact. Never browser input or a DB receipt. */
    releasePolicy?: {
      approved: ApprovedRelease;
      buildSha: string;
      targetEnvironmentId: string;
      expectedContractHashes: Record<string, string>;
    };
    configuration?: Partial<Record<CapabilityId, boolean>>;
    diagnostics?: boolean;
  },
): Promise<OperationsHealthView> {
  // First, alone, and before anything that could throw. Every other read below
  // queries a table one of the migrations creates, so against a database that
  // is behind they all fail -- and the one screen whose job is to say why would
  // be the one screen that cannot load.
  const correlationId = crypto.randomUUID(),
    failedReads: string[] = [];
  const failed = (read: string) => {
    failedReads.push(read);
    console.error("operations read unavailable", { correlationId, read });
  };
  let schema: SchemaHealth;
  try {
    schema = schemaHealthOf({
      expected: EXPECTED_MIGRATIONS,
      ledger: await dependencies.repository.schemaLedger(),
    });
  } catch {
    failed("schemaLedger");
    schema = {
      state: "unavailable",
      missing: [],
      ahead: [],
      appliedCount: null,
      expectedCount: EXPECTED_MIGRATIONS.length,
      summary: "結構讀取失敗，遷移狀態未知；不能當作0個遷移或正常。",
    };
  }
  const repo = dependencies.repository;
  const results = await Promise.allSettled([
    Promise.resolve().then(() => repo.listRecentRuns(RECENT_RUN_LIMIT)),
    Promise.resolve().then(() => repo.listRecentScheduledRuns(RECENT_RUN_LIMIT)),
    Promise.resolve().then(() => repo.lastScheduledSuccessAt()),
    Promise.resolve().then(() => repo.queueDepths(input.now)),
    Promise.resolve().then(() => repo.textLayerObserved()),
    Promise.resolve().then(() => repo.schemaCatalog?.() ?? null),
    Promise.resolve().then(() => repo.maintenanceLeaseHealth?.() ?? null),
    Promise.resolve().then(() =>
      schema.state === "diverged" ? (repo.releaseCatalog?.() ?? null) : null,
    ),
  ]);
  function value<T>(result: PromiseSettledResult<T>, name: string): T | null {
    if (result.status === "fulfilled") return result.value;
    failed(name);
    return null;
  }
  const recentRuns = value(results[0], "listRecentRuns"),
    scheduledRuns = value(results[1], "listRecentScheduledRuns");
  const lastSuccess = value(results[2], "lastScheduledSuccessAt"),
    queues = value(results[3], "queueDepths"),
    textLayerObserved = value(results[4], "textLayerObserved");
  const catalog = value(results[5], "schemaCatalog"),
    schedulerLeases = value(results[6], "maintenanceLeaseHealth");
  const releaseCatalog = value(results[7], "releaseCatalog");
  const policy = dependencies.releasePolicy;
  const releaseCompatibility =
    schema.state === "diverged"
      ? evaluateHistoricalReleaseCompatibility({
          buildSha: policy?.buildSha ?? "",
          targetEnvironmentId: policy?.targetEnvironmentId ?? "",
          approved: policy?.approved ?? null,
          receipt: releaseCatalog?.receipt ?? null,
          historicalLedgerSha256: releaseCatalog?.historicalLedgerSha256 ?? "",
          postReleaseCatalogSha256: releaseCatalog?.catalogSha256 ?? "",
          expectedRuntimeContractKeys: Object.keys(policy?.expectedContractHashes ?? {}),
          runtimeContracts:
            policy && releaseCatalog
              ? compareRuntimeContracts(
                  releaseCatalog.contractHashes,
                  policy.expectedContractHashes,
                )
              : [],
        })
      : null;
  const maintenance =
    scheduledRuns === null
      ? null
      : maintenanceHealthOf({
          runs: scheduledRuns,
          now: input.now,
          toleranceSeconds: defaultToleranceSeconds(),
          lastScheduledSuccessAt: results[2].status === "fulfilled" ? lastSuccess : undefined,
        });

  return {
    schema,
    releaseCompatibility,
    maintenance,
    recentRuns,
    queues,
    blockedIntegrations: BLOCKED_INTEGRATIONS,
    staleBlockers: maintenance
      ? staleBlockedIntegrations({
          blocked: BLOCKED_INTEGRATIONS,
          maintenanceState: maintenance.state,
          textLayerObserved: textLayerObserved === true,
        })
      : [],
    capabilities: capabilityStatuses({
      configuration: dependencies.configuration,
      maintenance,
      textLayerObserved,
      schemaReady: releaseCompatibility?.applicationSchemaCompatible
        ? true
        : catalog
          ? schema.state === "current" && catalog.facts.every((fact) => fact.present)
          : null,
    }),
    schedulerLeases,
    lastSuccessLookupKnown: results[2].status === "fulfilled",
    executionScope: scheduledRuns?.[0]?.executionScope ?? null,
    diagnostics: dependencies.diagnostics ? { correlationId, failedReads } : null,
  };
}

/**
 * Deferred, like the other server-fn modules: this pulls the database client in,
 * and the module has to stay loadable from offline validators that have no
 * binding.
 */
async function loadOperationsServerDependencies() {
  const [{ getRequest }, { requireStaffActor }, { createMaintenanceRunRepository }] =
    await Promise.all([
      import("@tanstack/react-start/server"),
      import("@/features/auth/neon-auth-server"),
      import("./repository"),
    ]);
  return { getRequest, requireStaffActor, createMaintenanceRunRepository };
}

export const getOperationsHealth = createServerFn({ method: "GET" }).handler(async () => {
  const { getRequest, requireStaffActor, createMaintenanceRunRepository } =
    await loadOperationsServerDependencies();

  // The actor is derived from the request, never from client input, and the
  // gate runs before a repository is opened.
  const actor = await requireStaffActor(getRequest());
  const { getOperationsConfiguration } = await import("@/server/runtime-env");

  const repository = createMaintenanceRunRepository();
  try {
    return await buildOperationsHealth(
      { now: new Date().toISOString() },
      {
        repository,
        configuration: getOperationsConfiguration(),
        diagnostics: actor.role === "Admin",
      },
    );
  } finally {
    await repository.close();
  }
});
