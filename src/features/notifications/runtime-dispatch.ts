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

const dispatchDueNotificationsOnServer = createServerOnlyFn(
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

export const dispatchDueNotifications = createServerFn({ method: "POST" })
  .validator(dispatchInputSchema)
  .handler(async ({ data }) => {
    const [{ getRequest }, { requireStaffActor }] = await Promise.all([
      import("@tanstack/react-start/server"),
      import("@/features/auth/neon-auth-server"),
    ]);
    await requireStaffActor(getRequest());
    return dispatchDueNotificationsOnServer(data);
  });
