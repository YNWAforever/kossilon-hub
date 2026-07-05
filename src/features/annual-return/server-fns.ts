import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  createAnnualReturnRepository,
  hongKongBusinessDate,
  type AnnualReturnRepository,
} from "./repository";
import { buildReminderDraft, completionBlockers, isAllowedStatusTransition } from "./workflow";
import { ANNUAL_RETURN_STATUSES } from "./types";

const CURRENT_USER_ID = "20000000-0000-0000-0000-000000000001";

const RISK_LEVELS = ["green", "yellow", "orange", "red"] as const;
const CHECKLIST_STATUSES = ["Missing", "Received", "Verified", "Rejected"] as const;
const PAYMENT_STATUSES = [
  "Not invoiced",
  "Payment pending",
  "Payment received",
  "Overdue",
] as const;

const annualReturnStatusSchema = z.enum(ANNUAL_RETURN_STATUSES);
const listAnnualReturnCasesSchema = z
  .object({
    ownerId: z.string().uuid().optional(),
    teamId: z.string().uuid().optional(),
    reviewerId: z.string().uuid().optional(),
    risk: z.enum(RISK_LEVELS).optional(),
    status: annualReturnStatusSchema.optional(),
    missingDocuments: z.boolean().optional(),
    paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
    overdueOnly: z.boolean().optional(),
  })
  .default({});

const annualReturnCaseIdSchema = z.object({
  caseId: z.string().uuid(),
});

async function withAnnualReturnRepository<T>(
  handler: (repository: AnnualReturnRepository) => Promise<T>,
): Promise<T> {
  const repository = createAnnualReturnRepository();

  try {
    return await handler(repository);
  } finally {
    await repository.close();
  }
}

export const listAnnualReturnCases = createServerFn({ method: "GET" })
  .validator(listAnnualReturnCasesSchema)
  .handler(async ({ data }) =>
    withAnnualReturnRepository((repository) => repository.listCases(data)),
  );

export const getAnnualReturnCase = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) =>
    withAnnualReturnRepository((repository) => repository.getCase(data.id)),
  );

export const getAnnualReturnDashboardMetrics = createServerFn({ method: "GET" }).handler(async () =>
  withAnnualReturnRepository((repository) =>
    repository.dashboardMetrics(hongKongBusinessDate(), CURRENT_USER_ID),
  ),
);

export const updateAnnualReturnStatus = createServerFn({ method: "POST" })
  .validator(
    z.object({
      caseId: z.string().uuid(),
      nextStatus: annualReturnStatusSchema,
    }),
  )
  .handler(async ({ data }) =>
    withAnnualReturnRepository(async (repository) => {
      const current = await repository.getCase(data.caseId);

      if (!current) {
        throw new Error("Annual return case not found.");
      }

      if (!isAllowedStatusTransition(current.currentStatus, data.nextStatus)) {
        throw new Error(`Cannot move from ${current.currentStatus} to ${data.nextStatus}.`);
      }

      if (data.nextStatus === "Completed") {
        const blockers = completionBlockers(current);

        if (blockers.length > 0) {
          throw new Error(blockers.map((blocker) => blocker.message).join(" "));
        }
      }

      return repository.updateStatus(data.caseId, data.nextStatus, CURRENT_USER_ID);
    }),
  );

export const recordAnnualReturnReminder = createServerFn({ method: "POST" })
  .validator(
    z.object({
      caseId: z.string().uuid(),
      templateLabel: z.string().min(1),
      recipientName: z.string().min(1),
      recipientPhone: z.string().min(3),
      draftBody: z.string().min(1),
      note: z.string().default(""),
    }),
  )
  .handler(async ({ data }) =>
    withAnnualReturnRepository((repository) =>
      repository.recordReminder({
        ...data,
        actorId: CURRENT_USER_ID,
      }),
    ),
  );

export const updateAnnualReturnChecklistItem = createServerFn({ method: "POST" })
  .validator(
    z.object({
      caseId: z.string().uuid(),
      itemId: z.string().uuid(),
      status: z.enum(CHECKLIST_STATUSES),
      documentId: z.string().uuid().nullable(),
    }),
  )
  .handler(async ({ data }) =>
    withAnnualReturnRepository((repository) =>
      repository.updateChecklistItem({
        ...data,
        actorId: CURRENT_USER_ID,
      }),
    ),
  );

export const updateAnnualReturnPayment = createServerFn({ method: "POST" })
  .validator(
    z.object({
      caseId: z.string().uuid(),
      status: z.enum(PAYMENT_STATUSES),
      paymentProofDocumentId: z.string().uuid().nullable(),
    }),
  )
  .handler(async ({ data }) =>
    withAnnualReturnRepository((repository) =>
      repository.updatePayment({
        ...data,
        actorId: CURRENT_USER_ID,
      }),
    ),
  );

export const updateAnnualReturnFilingProof = createServerFn({ method: "POST" })
  .validator(
    z.object({
      caseId: z.string().uuid(),
      filingReference: z.string().min(1),
      confirmationDocumentId: z.string().uuid(),
    }),
  )
  .handler(async ({ data }) =>
    withAnnualReturnRepository((repository) =>
      repository.updateFilingProof({
        ...data,
        actorId: CURRENT_USER_ID,
      }),
    ),
  );

export const buildAnnualReturnReminderDraft = createServerFn({ method: "GET" })
  .validator(annualReturnCaseIdSchema)
  .handler(async ({ data }) =>
    withAnnualReturnRepository(async (repository) => {
      const case_ = await repository.getCase(data.caseId);

      if (!case_) {
        throw new Error("Annual return case not found.");
      }

      return { draftBody: buildReminderDraft(case_) };
    }),
  );
