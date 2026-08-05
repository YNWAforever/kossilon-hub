import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import type { WhatsAppProviderConfig } from "@/features/whatsapp/types";
import type { ProviderMode } from "@/server/provider-mode";
import { createNotificationDispatcher, createNotificationTransport } from "./dispatcher";
import type { NotificationOutboxRepository, NotificationTransport } from "./types";

const dispatchInputSchema = z
  .object({
    now: z.string().datetime(),
    limit: z.number().int().min(1).max(500).optional(),
  })
  .strict();

export type RuntimeDispatchDependencies = {
  currentProviderMode(): ProviderMode;
  createRepository(): NotificationOutboxRepository;
  createTransport?(input: {
    providerMode: ProviderMode;
    config?: WhatsAppProviderConfig;
  }): NotificationTransport;
  getLiveConfig?(): WhatsAppProviderConfig;
};

export async function dispatchDueNotificationsWithDependencies(
  input: { now: string; limit?: number },
  dependencies: RuntimeDispatchDependencies,
) {
  const data = dispatchInputSchema.parse(input);
  const repository = dependencies.createRepository();
  try {
    const providerMode = dependencies.currentProviderMode();
    const config = providerMode === "live" ? dependencies.getLiveConfig?.() : undefined;
    const transport = (dependencies.createTransport ?? createNotificationTransport)({
      providerMode,
      config,
    });
    return await createNotificationDispatcher(repository, transport).dispatchDue(
      data.now,
      data.limit,
    );
  } finally {
    await repository.close();
  }
}

export const dispatchDueNotificationsOnServer = createServerOnlyFn(
  async (input: { now: string; limit?: number }) => {
    const [providerModeModule, outboxModule, runtimeEnvModule] = await Promise.all([
      import("@/server/provider-mode"),
      import("./outbox"),
      import("@/server/runtime-env"),
    ]);
    return dispatchDueNotificationsWithDependencies(input, {
      currentProviderMode: providerModeModule.currentProviderMode,
      createRepository: () => outboxModule.createNotificationOutboxRepository(),
      getLiveConfig: () => {
        const env = runtimeEnvModule.getFirmRuntimeEnv();
        return {
          provider: "woztell",
          apiBaseUrl: env.woztellApiBaseUrl,
          accessToken: env.woztellAccessToken,
          channelId: env.woztellChannelId,
          webhookSecret: env.woztellWebhookSecret,
        };
      },
    });
  },
);

/**
 * The manual dispatch escape hatch. The cron in src/server.ts is what normally
 * drives the outbox; this exists for an operator who needs to flush it now.
 *
 * `now` is deliberately not part of the input. It used to be, which let a caller
 * choose the clock the outbox is claimed and stamped against — a future `now`
 * claims notifications that are not due yet, a past one hides ones that are.
 * There is no reason for a caller to pick the current time.
 */
const manualDispatchInputSchema = z
  .object({ limit: z.number().int().min(1).max(500).optional() })
  .strict();

export const dispatchDueNotifications = createServerFn({ method: "POST" })
  .validator(manualDispatchInputSchema)
  .handler(async ({ data }) => {
    const [{ getRequest }, { requireStaffActor }] = await Promise.all([
      import("@tanstack/react-start/server"),
      import("@/features/auth/neon-auth-server"),
    ]);
    await requireStaffActor(getRequest());
    return dispatchDueNotificationsOnServer({ ...data, now: new Date().toISOString() });
  });
