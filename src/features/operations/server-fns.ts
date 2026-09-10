import { createServerFn } from "@tanstack/react-start";
import { BLOCKED_INTEGRATIONS, type BlockedIntegration } from "./capabilities";
import {
  defaultToleranceSeconds,
  maintenanceHealthOf,
  type MaintenanceHealth,
  type MaintenanceRunRecord,
} from "./health";
import type { MaintenanceRunRepository, QueueDepths } from "./repository";

/**
 * What the operations screen reads.
 *
 * Staff-gated rather than admin-gated, deliberately. The question this answers
 * is "can I trust what the other screens are telling me" -- if reminders have
 * not been evaluated for six hours, the person who needs to know is whoever is
 * about to rely on the chase list, not only an administrator.
 */

export type OperationsHealthView = {
  maintenance: MaintenanceHealth;
  /** Most recent first, including manual runs, which the health rule ignores. */
  recentRuns: MaintenanceRunRecord[];
  queues: QueueDepths;
  /**
   * Shown beside the health, never folded into it. Under six blocked
   * integrations two passes report `not-configured` on every single tick,
   * permanently; a screen that counted those as faults would be red forever and
   * would stop meaning anything.
   */
  blockedIntegrations: readonly BlockedIntegration[];
};

const RECENT_RUN_LIMIT = 12;

export async function buildOperationsHealth(
  input: { now: string },
  dependencies: {
    repository: Pick<MaintenanceRunRepository, "listRecentRuns" | "queueDepths">;
  },
): Promise<OperationsHealthView> {
  const [recentRuns, queues] = await Promise.all([
    dependencies.repository.listRecentRuns(RECENT_RUN_LIMIT),
    dependencies.repository.queueDepths(input.now),
  ]);

  return {
    maintenance: maintenanceHealthOf({
      runs: recentRuns,
      now: input.now,
      toleranceSeconds: defaultToleranceSeconds(),
    }),
    recentRuns,
    queues,
    blockedIntegrations: BLOCKED_INTEGRATIONS,
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
