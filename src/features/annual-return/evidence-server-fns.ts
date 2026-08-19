import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertStaffAccess } from "@/features/auth/authorization";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { AnnualReturnEvidenceService } from "./evidence-service";

const reviewEvidenceSchema = z
  .object({
    caseId: z.string().uuid(),
    documentId: z.string().uuid(),
    checklistItemId: z.string().uuid().optional(),
    decision: z.enum(["verified", "rejected"]),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

const acceptFilingReceiptSchema = z
  .object({
    caseId: z.string().uuid(),
    documentId: z.string().uuid(),
    filingReference: z.string().trim().min(1).max(200),
  })
  .strict();

export type AnnualReturnEvidenceCommandDependencies = {
  service: AnnualReturnEvidenceService;
};

function requireStaffUserId(actor: AuthenticatedActor): string {
  const staff = assertStaffAccess(actor);

  if (!staff.userId) {
    throw new Error("Forbidden: a staff database identity is required.");
  }

  return staff.userId;
}

export async function reviewAnnualReturnEvidenceForActor(
  actor: AuthenticatedActor,
  input: z.input<typeof reviewEvidenceSchema>,
  dependencies: AnnualReturnEvidenceCommandDependencies,
) {
  const actorId = requireStaffUserId(actor);
  const data = reviewEvidenceSchema.parse(input);
  return dependencies.service.reviewEvidence({
    ...data,
    actorId,
  });
}

export async function acceptAnnualReturnFilingReceiptForActor(
  actor: AuthenticatedActor,
  input: z.input<typeof acceptFilingReceiptSchema>,
  dependencies: AnnualReturnEvidenceCommandDependencies,
) {
  const actorId = requireStaffUserId(actor);
  const data = acceptFilingReceiptSchema.parse(input);
  return dependencies.service.acceptFilingReceipt({
    ...data,
    actorId,
  });
}

const loadDefaultAnnualReturnEvidenceContext = createServerOnlyFn(async () => {
  const [{ getRequest }, { getCurrentAnnualReturnActor }, { createAnnualReturnEvidenceService }] =
    await Promise.all([
      import("@tanstack/react-start/server"),
      import("./session"),
      import("./evidence-service"),
    ]);
  const actor = await getCurrentAnnualReturnActor(getRequest());
  return {
    actor,
    dependencies: {
      service: createAnnualReturnEvidenceService(),
    } satisfies AnnualReturnEvidenceCommandDependencies,
  };
});

export const reviewAnnualReturnEvidenceAction = createServerFn({ method: "POST" })
  .validator(reviewEvidenceSchema)
  .handler(async ({ data }) => {
    const { actor, dependencies } = await loadDefaultAnnualReturnEvidenceContext();
    return reviewAnnualReturnEvidenceForActor(actor, data, dependencies);
  });

export const acceptAnnualReturnFilingReceiptAction = createServerFn({ method: "POST" })
  .validator(acceptFilingReceiptSchema)
  .handler(async ({ data }) => {
    const { actor, dependencies } = await loadDefaultAnnualReturnEvidenceContext();
    return acceptAnnualReturnFilingReceiptForActor(actor, data, dependencies);
  });
