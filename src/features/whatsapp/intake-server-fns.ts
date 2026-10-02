import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { DOCUMENT_CATEGORIES } from "@/features/documents/types";

export const messagePreviewSchema = z.object({ messageId: z.string().uuid() }).strict();
export const messageMappingSchema = messagePreviewSchema
  .extend({
    caseId: z.string().uuid(),
    expectedVersion: z.number().int().min(0),
    reason: z.string().trim().min(1).max(1000),
  })
  .strict();
export const mediaIntakeSchema = z
  .object({
    mediaId: z.string().uuid(),
    expectedMappingVersion: z.number().int().min(0),
    category: z.enum(DOCUMENT_CATEGORIES),
    checklistItemId: z.string().uuid().optional(),
  })
  .strict();
const loadContext = createServerOnlyFn(async (needsStorage = false) => {
  const [
    { getRequest },
    { requireStaffActor },
    { createWhatsAppIntakeRepository },
    { createDocumentStorageForProviderMode },
    { currentProviderMode },
    { getDocumentsBucketBinding },
  ] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("@/features/auth/neon-auth-server"),
    import("./intake-repository"),
    import("@/features/documents/server-fns"),
    import("@/server/provider-mode"),
    import("@/server/runtime-env"),
  ]);
  const actor = await requireStaffActor(getRequest());
  const mode = currentProviderMode();
  const repository = createWhatsAppIntakeRepository({
    storage: needsStorage
      ? createDocumentStorageForProviderMode(
          mode,
          mode === "live" ? getDocumentsBucketBinding() : undefined,
        )
      : undefined,
  });
  return { actor, repository, mode };
});
export async function withWhatsAppIntakeConflict<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof Error && "statusCode" in error && error.statusCode === 409)
      throw new Response(
        JSON.stringify({
          code: "version_conflict",
          message: "Message mapping or intake changed. Refresh its preview before approval.",
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      );
    throw error;
  }
}
export const previewWhatsAppMessage = createServerFn({ method: "GET" })
  .validator(messagePreviewSchema)
  .handler(async ({ data }) => {
    const { actor, repository } = await loadContext();
    return repository.getMessagePreview(actor, data.messageId);
  });
export const mapWhatsAppMessage = createServerFn({ method: "POST" })
  .validator(messageMappingSchema)
  .handler(({ data }) =>
    withWhatsAppIntakeConflict(async () => {
      const { actor, repository } = await loadContext();
      return repository.mapMessage(actor, data);
    }),
  );
export const intakeWhatsAppMedia = createServerFn({ method: "POST" })
  .validator(mediaIntakeSchema)
  .handler(({ data }) =>
    withWhatsAppIntakeConflict(async () => {
      const { actor, repository, mode } = await loadContext(true);
      const [
        { createWhatsAppMediaIntakeService },
        { downloadWoztellMedia },
        { missingWhatsAppEnvVars, WHATSAPP_LIVE_PROVIDER_ENV_KEYS },
        { lookup },
      ] = await Promise.all([
        import("./media-intake"),
        import("./media-download"),
        import("./config"),
        import("node:dns/promises"),
      ]);
      return createWhatsAppMediaIntakeService({
        repository,
        download: async (fileId) => {
          if (mode !== "live")
            return {
              status: "blocked",
              errorCode: "live-media-provider-required",
              retryable: false,
            };
          if (missingWhatsAppEnvVars(process.env, WHATSAPP_LIVE_PROVIDER_ENV_KEYS).length)
            return {
              status: "blocked",
              errorCode: "media-provider-unconfigured",
              retryable: false,
            };
          return downloadWoztellMedia({
            fileId,
            accessToken: process.env.WOZTELL_ACCESS_TOKEN!,
            allowedHosts: (process.env.WOZTELL_MEDIA_ALLOWED_HOSTS ?? "")
              .split(",")
              .map((host) => host.trim())
              .filter(Boolean),
            resolveHost: async (hostname) =>
              (await lookup(hostname, { all: true })).map((answer) => answer.address),
          });
        },
      }).ingest(actor, data);
    }),
  );
