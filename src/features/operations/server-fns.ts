import { createServerFn } from "@tanstack/react-start";
import {
  BLOCKED_INTEGRATIONS,
  staleBlockedIntegrations,
  type BlockedIntegration,
  type BlockedIntegrationId,
} from "./capabilities";
import {
  defaultToleranceSeconds,
  maintenanceHealthOf,
  type MaintenanceHealth,
  type MaintenanceRunRecord,
} from "./health";
import type { MaintenanceRunRepository, QueueDepths } from "./repository";
import { EXPECTED_MIGRATIONS, schemaHealthOf, type SchemaHealth } from "./schema-health";

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
    >;
  },
): Promise<OperationsHealthView> {
  // First, alone, and before anything that could throw. Every other read below
  // queries a table one of the migrations creates, so against a database that
  // is behind they all fail -- and the one screen whose job is to say why would
  // be the one screen that cannot load.
  const schema = schemaHealthOf({
    expected: EXPECTED_MIGRATIONS,
    ledger: await dependencies.repository.schemaLedger(),
  });

  try {
    return await readOperationsState(input, dependencies, schema);
  } catch (error) {
    // Tolerated only where the schema already accounts for it. A failure on a
    // current schema is a real fault, and dressing it up as a migration problem
    // would send whoever reads this screen after the wrong thing entirely.
    if (schema.state === "current") throw error;

    // Logged, not discarded. The screen deliberately does not show this text --
    // a connection error can name hosts and ports, and this is not the place to
    // put them in front of staff -- but an error nothing records is an error
    // nobody can debug, and "the schema explains it" is a reason to keep serving
    // the page, not a reason to throw the evidence away.
    console.error("operations health degraded read", { schemaState: schema.state, error });

    return {
      schema,
      maintenance: null,
      recentRuns: null,
      queues: null,
      blockedIntegrations: BLOCKED_INTEGRATIONS,
      staleBlockers: [],
    };
  }
}

async function readOperationsState(
  input: { now: string },
  dependencies: {
    repository: Pick<
      MaintenanceRunRepository,
      "listRecentRuns" | "listRecentScheduledRuns" | "lastScheduledSuccessAt" | "queueDepths"
    >;
  },
  schema: SchemaHealth,
): Promise<OperationsHealthView> {
  const [recentRuns, scheduledRuns, lastScheduledSuccessAt, queues] = await Promise.all([
    dependencies.repository.listRecentRuns(RECENT_RUN_LIMIT),
    // Judged separately from what the table displays: a window full of manual
    // runs would leave the health rule nothing to judge the schedule by.
    dependencies.repository.listRecentScheduledRuns(RECENT_RUN_LIMIT),
    dependencies.repository.lastScheduledSuccessAt(),
    dependencies.repository.queueDepths(input.now),
  ]);

  const maintenance = maintenanceHealthOf({
    runs: scheduledRuns,
    now: input.now,
    toleranceSeconds: defaultToleranceSeconds(),
    // Scoped to all of history, so an hour of partial ticks cannot make the
    // screen claim the schedule has never once succeeded.
    lastScheduledSuccessAt,
  });

  return {
    schema,
    maintenance,
    recentRuns,
    queues,
    blockedIntegrations: BLOCKED_INTEGRATIONS,
    staleBlockers: staleBlockedIntegrations({
      blocked: BLOCKED_INTEGRATIONS,
      maintenanceState: maintenance.state,
    }),
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
  await requireStaffActor(getRequest());

  const repository = createMaintenanceRunRepository();
  try {
    return await buildOperationsHealth({ now: new Date().toISOString() }, { repository });
  } finally {
    await repository.close();
  }
});
