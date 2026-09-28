import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertStaffAccess } from "@/features/auth/authorization";
import { entityIdSchema } from "@/features/runtime/entity-id";

const mediaTargetSchema = z
  .object({
    messageId: entityIdSchema,
    mediaIndex: z.number().int().min(0).max(50),
    caseId: entityIdSchema,
    requirementInstanceId: entityIdSchema.optional(),
    expectedRevision: z.number().int().min(0),
  })
  .strict();
export const linkInboundMediaSchema = mediaTargetSchema;
export const correctInboundMediaSchema = mediaTargetSchema
  .extend({
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export const listMediaRequirementsSchema = z.object({ caseId: entityIdSchema }).strict();

const loadMediaContext = createServerOnlyFn(async () => {
  const [{ getRequest }, { requireStaffActor }, { currentProviderMode }] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("@/features/auth/neon-auth-server"),
    import("@/server/provider-mode"),
  ]);
  const actor = assertStaffAccess(await requireStaffActor(getRequest()));
  if (!actor.userId) throw new Error("Staff database identity is required.");
  if (currentProviderMode() !== "live") throw new Error("Demo inbox is read-only.");
  return actor;
});

export const linkInboundMedia = createServerFn({ method: "POST" })
  .validator(linkInboundMediaSchema)
  .handler(async ({ data }) => {
    const actor = await loadMediaContext();
    const [
      { linkInboundMediaForActor },
      { createDocumentStorageForProviderMode },
      { getDocumentsBucketBinding },
    ] = await Promise.all([
      import("./media-link"),
      import("@/features/documents/server-fns"),
      import("@/server/runtime-env"),
    ]);
    const storage = createDocumentStorageForProviderMode("live", getDocumentsBucketBinding());
    return linkInboundMediaForActor(actor, data, { storage });
  });

export const correctInboundMediaClassification = createServerFn({ method: "POST" })
  .validator(correctInboundMediaSchema)
  .handler(async ({ data }) => {
    const actor = await loadMediaContext();
    const { correctInboundMediaClassificationForActor } = await import("./media-link");
    return correctInboundMediaClassificationForActor(actor, data, {});
  });

export const listMediaRequirements = createServerFn({ method: "GET" })
  .validator(listMediaRequirementsSchema)
  .handler(async ({ data }) => {
    const actor = await loadMediaContext();
    const [{ createAnnualReturnRepository }, { getSqlClient }] = await Promise.all([
      import("@/features/annual-return/repository"),
      import("@/server/db/client"),
    ]);
    const annualReturns = createAnnualReturnRepository();
    await annualReturns.assertCanMutateCase(data.caseId, actor.userId!, "update_checklist");
    const sql = getSqlClient();
    return sql<
      { id: string; checklist_item_id: string; item_label: string; requirement_key: string }[]
    >`
      select r.id,r.checklist_item_id,i.item_label,r.requirement_key
      from case_requirement_instances r
      join annual_return_checklist_items i on i.id=r.checklist_item_id
      where r.case_id=${data.caseId} and r.applicability='required'
      order by i.item_label,r.requirement_key,r.id
    `;
  });
