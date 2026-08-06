import { z } from "zod";

import type { DispatchSummary } from "@/features/notifications/types";
import { runScheduledMaintenance, type ScheduledMaintenanceResult } from "./cron";

/**
 * Actor-free assembly of the periodic maintenance passes.
 *
 * `runScheduledMaintenance` in ./cron.ts has always been pure and tested, but
 * nothing ever called it: `wrangler.template.jsonc` declares a 5-minute cron
 * while the Worker exposed only `fetch`, so SLA escalations were never
 * evaluated, the notification outbox was never dispatched, and expired upload
 * intents were never reclaimed.
 *
 * This module supplies the missing half — the real repositories and storage —
 * without going through `server-fns.ts`. Those handlers all derive an actor
 * from the incoming request (`requireStaffActor`, and an Admin check on
 * `cleanupExpiredUploads`), which a scheduler has no way to satisfy. Trigger
 * mechanisms stay out of here deliberately, so the same entrypoint serves the
 * Cloudflare `cloudflare:scheduled` nitro hook, a platform cron route, or an
 * operator running it by hand.
 */

const inputSchema = z
  .object({
    now: z.string().datetime(),
    dispatchLimit: z.number().int().min(1).max(500).optional(),
  })
  .strict();

export type FirmMaintenanceInput = { now: string; dispatchLimit?: number };

type MaintenanceWorkItemRepository = {
  evaluateEscalations(now?: string): Promise<{ warnings: number; breaches: number }>;
  close(): Promise<void>;
};

type MaintenanceDocumentRepository = {
  expireUploads(now: string): Promise<readonly { objectKey: string }[]>;
  close(): Promise<void>;
};

type MaintenanceOutboxRepository = {
  redactExpired(now: string): Promise<{ redacted: number }>;
  close(): Promise<void>;
};

export type FirmMaintenanceDependencies = {
  createWorkItemRepository(): MaintenanceWorkItemRepository;
  dispatchDue(input: { now: string; limit: number }): Promise<DispatchSummary>;
  createDocumentRepository(): MaintenanceDocumentRepository;
  createDocumentStorage(): { delete(objectKey: string): Promise<void> };
  createOutboxRepository(): MaintenanceOutboxRepository;
};

const DEFAULT_DISPATCH_LIMIT = 50;

export async function runFirmMaintenanceWithDependencies(
  input: FirmMaintenanceInput,
  dependencies: FirmMaintenanceDependencies,
): Promise<ScheduledMaintenanceResult> {
  const data = inputSchema.parse(input);

  // Both repositories open a Postgres connection eagerly, so they are created
  // up front and closed in one `finally`. Closing them inside each pass would
  // leak whichever connection the failing pass had already opened.
  const workItems = dependencies.createWorkItemRepository();
  const documents = dependencies.createDocumentRepository();
  const outbox = dependencies.createOutboxRepository();

  try {
    return await runScheduledMaintenance(
      data.now,
      {
        evaluateEscalations: (now) => workItems.evaluateEscalations(now),
        dispatchDue: (now, limit) => dependencies.dispatchDue({ now, limit }),
        cleanupExpiredUploads: async (now) => {
          const expired = await documents.expireUploads(now);
          const storage = dependencies.createDocumentStorage();
          await Promise.all(expired.map((intent) => storage.delete(intent.objectKey)));
          return { expired: expired.length };
        },
        redactNotifications: (now) => outbox.redactExpired(now),
      },
      { dispatchLimit: data.dispatchLimit ?? DEFAULT_DISPATCH_LIMIT },
    );
  } finally {
    await Promise.all([workItems.close(), documents.close(), outbox.close()]);
  }
}

/**
 * Production wiring. Imports are deferred so this module stays loadable from
 * tests and offline validators that have no database binding.
 */
export async function runFirmMaintenance(
  input: FirmMaintenanceInput,
): Promise<ScheduledMaintenanceResult> {
  const [
    workItemsModule,
    documentsModule,
    dispatchModule,
    documentServerFnsModule,
    providerModeModule,
    runtimeEnvModule,
    outboxModule,
  ] = await Promise.all([
    import("@/features/work-items/repository"),
    import("@/features/documents/repository"),
    import("@/features/notifications/runtime-dispatch"),
    import("@/features/documents/server-fns"),
    import("@/server/provider-mode"),
    import("@/server/runtime-env"),
    import("@/features/notifications/outbox"),
  ]);

  return runFirmMaintenanceWithDependencies(input, {
    createWorkItemRepository: () => workItemsModule.createWorkItemRepository(),
    createDocumentRepository: () => documentsModule.createDocumentRepository(),
    createOutboxRepository: () => outboxModule.createNotificationOutboxRepository(),
    dispatchDue: (dispatchInput) => dispatchModule.dispatchDueNotificationsOnServer(dispatchInput),
    createDocumentStorage: () => {
      // Live mode throws without a real bucket, so resolve the binding the same
      // way the request-scoped document context does.
      const providerMode = providerModeModule.currentProviderMode();
      return documentServerFnsModule.createDocumentStorageForProviderMode(
        providerMode,
        providerMode === "live" ? runtimeEnvModule.getFirmRuntimeEnv().documentsBucket : undefined,
      );
    },
  });
}
