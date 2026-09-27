import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { entityIdSchema } from "@/features/runtime/entity-id";
import { listPaymentObservationsForActor, reconcilePaymentForActor } from "./reconciliation";

const listSchema = z.object({ caseId: entityIdSchema }).strict();
const reconcileSchema = z
  .object({
    observationId: entityIdSchema,
    caseId: entityIdSchema,
    proofVersionId: entityIdSchema.optional(),
    expectedRevision: z.number().int().positive(),
    decision: z.enum(["match", "reject"]),
    reason: z.string().trim().min(1).max(500).optional(),
    confirmation: z
      .object({
        invoiceRef: z.string().trim().min(1).max(200),
        amountMinor: z.number().int().positive().safe(),
        currency: z.string().regex(/^[A-Z]{3}$/),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((data, context) => {
    if (data.decision === "match" && (!data.proofVersionId || !data.confirmation)) {
      context.addIssue({
        code: "custom",
        message: "Match requires current proof and explicit invoice, amount and currency.",
      });
    }
    if (data.decision === "reject" && !data.reason) {
      context.addIssue({ code: "custom", message: "Reject requires a reason." });
    }
  });

const getActor = createServerOnlyFn(async () => {
  const [{ getRequest }, { getCurrentAnnualReturnActor }] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("@/features/annual-return/session"),
  ]);
  return getCurrentAnnualReturnActor(getRequest());
});

export const listPaymentObservations = createServerFn({ method: "GET" })
  .validator(listSchema)
  .handler(async ({ data }) => listPaymentObservationsForActor(await getActor(), data.caseId));

export const reconcilePaymentAction = createServerFn({ method: "POST" })
  .validator(reconcileSchema)
  .handler(async ({ data }) => reconcilePaymentForActor(await getActor(), data));
