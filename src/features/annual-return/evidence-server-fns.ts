import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { assertStaffAccess } from "@/features/auth/authorization";
import type { AuthenticatedActor } from "@/features/auth/types";
import { getCurrentAnnualReturnActor } from "./session";
import {
  createAnnualReturnEvidenceService,
  type AnnualReturnEvidenceService,
} from "./evidence-service";

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

export const reviewAnnualReturnEvidenceAction = createServerFn({ method: "POST" })
  .validator(reviewEvidenceSchema)
  .handler(async ({ data }) => {
    const actor = await getCurrentAnnualReturnActor(getRequest());
    return reviewAnnualReturnEvidenceForActor(actor, data, {
      service: createAnnualReturnEvidenceService(),
    });
  });

export const acceptAnnualReturnFilingReceiptAction = createServerFn({ method: "POST" })
  .validator(acceptFilingReceiptSchema)
  .handler(async ({ data }) => {
    const actor = await getCurrentAnnualReturnActor(getRequest());
    return acceptAnnualReturnFilingReceiptForActor(actor, data, {
      service: createAnnualReturnEvidenceService(),
    });
  });
