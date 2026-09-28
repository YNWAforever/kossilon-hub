import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import type { AuthenticatedActor } from "@/features/auth/types";

const reviewIdSchema = z.object({ reviewId: z.string().uuid() }).strict();
const approvalSchema = reviewIdSchema
  .extend({
    previewHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

const loadContext = createServerOnlyFn(async () => {
  const [{ getRequest }, { requireStaffActor }] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("@/features/auth/neon-auth-server"),
  ]);
  return requireStaffActor(getRequest());
});

const loadServices = createServerOnlyFn(async () => import("./reminder-handler"));
const providerMode = createServerOnlyFn(async () => {
  const { currentProviderMode } = await import("@/server/provider-mode");
  return currentProviderMode();
});

export const assertReminderApprovalRuntime = createServerOnlyFn(
  async (actor: AuthenticatedActor) => {
    const { getWhatsAppIntegrationStatusForActor } = await import("@/features/whatsapp/server-fns");
    const mode = await providerMode();
    if (mode !== "live") throw new Error("Demo messaging is read-only.");
    const state = getWhatsAppIntegrationStatusForActor(actor, process.env, mode);
    if (state.capabilityStatus.state !== "healthy")
      throw new Error(
        "WhatsApp provider is unverified. Queueing requires current provider evidence.",
      );
  },
);

export const getBulkReminderReview = createServerFn({ method: "GET" })
  .validator(reviewIdSchema)
  .handler(async ({ data }) => {
    const { getReminderReviewForActor } = await loadServices();
    return getReminderReviewForActor(await loadContext(), data.reviewId);
  });

export const approveBulkReminderReview = createServerFn({ method: "POST" })
  .validator(approvalSchema)
  .handler(async ({ data }) => {
    const actor = await loadContext();
    await assertReminderApprovalRuntime(actor);
    const { approveOneReminderReviewForActor } = await loadServices();
    return approveOneReminderReviewForActor(actor, data);
  });

export const cancelBulkReminderReview = createServerFn({ method: "POST" })
  .validator(reviewIdSchema)
  .handler(async ({ data }) => {
    const actor = await loadContext();
    if ((await providerMode()) !== "live") throw new Error("Demo messaging is read-only.");
    const { cancelReminderReviewForActor } = await loadServices();
    await cancelReminderReviewForActor(actor, data.reviewId);
    return { cancelled: true };
  });
