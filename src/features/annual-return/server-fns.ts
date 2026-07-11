import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { getSqlClient } from "@/server/db/client";
import {
  createAnnualReturnRepository,
  hongKongBusinessDate,
  type AnnualReturnRepository,
} from "./repository";
import { createWhatsAppRepository } from "@/features/whatsapp/repository";
import { getCurrentAnnualReturnActorId } from "./session";
import { buildReminderDraft, completionBlockers, isAllowedStatusTransition } from "./workflow";
import { ANNUAL_RETURN_STATUSES, type AnnualReturnCase, type AnnualReturnStatus } from "./types";
import { queueAnnualReturnWhatsAppReminder } from "./whatsapp-reminders";

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
export const queueAnnualReturnWhatsAppReminderSchema = z.object({
  caseId: z.string().uuid(),
  recipientName: z.string().min(1),
  recipientPhone: z.string().min(3),
});
const updateChecklistItemSchema = z
  .object({
    caseId: z.string().uuid(),
    itemId: z.string().uuid(),
    status: z.enum(CHECKLIST_STATUSES),
    documentId: z.string().uuid().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.status === "Verified" && !data.documentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["documentId"],
        message: "documentId is required when verifying a checklist item.",
      });
    }
  });
const updatePaymentSchema = z
  .object({
    caseId: z.string().uuid(),
    status: z.enum(PAYMENT_STATUSES),
    paymentProofDocumentId: z.string().uuid().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.status === "Payment received" && !data.paymentProofDocumentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["paymentProofDocumentId"],
        message: "paymentProofDocumentId is required when payment is received.",
      });
    }
  });

export function assertAnnualReturnStatusActionAllowed(
  current: AnnualReturnCase,
  nextStatus: AnnualReturnStatus,
): void {
  if (nextStatus === "Completed") {
    const blockers = completionBlockers(current);

    if (blockers.length > 0) {
      throw new Error(blockers.map((blocker) => blocker.message).join(" "));
    }

    return;
  }

  if (!isAllowedStatusTransition(current.currentStatus, nextStatus)) {
    throw new Error(`Cannot move from ${current.currentStatus} to ${nextStatus}.`);
  }
}

async function withAnnualReturnRepository<T>(
  handler: (repository: AnnualReturnRepository, actorId: string) => Promise<T>,
): Promise<T> {
  const actorId = await getCurrentAnnualReturnActorId(getRequest());
  const repository = createAnnualReturnRepository();

  try {
    return await handler(repository, actorId);
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
  withAnnualReturnRepository((repository, actorId) =>
    repository.dashboardMetrics(hongKongBusinessDate(), actorId),
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
    withAnnualReturnRepository(async (repository, actorId) => {
      const current = await repository.getCase(data.caseId);

      if (!current) {
        throw new Error("Annual return case not found.");
      }

      assertAnnualReturnStatusActionAllowed(current, data.nextStatus);

      return repository.updateStatus(data.caseId, data.nextStatus, actorId);
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
    withAnnualReturnRepository((repository, actorId) =>
      repository.recordReminder({
        ...data,
        actorId,
      }),
    ),
  );

export const queueAnnualReturnWhatsAppReminderMessage = createServerFn({ method: "POST" })
  .validator(queueAnnualReturnWhatsAppReminderSchema)
  .handler(async ({ data }) => {
    const actorId = await getCurrentAnnualReturnActorId(getRequest());
    const sql = getSqlClient();

    return sql.begin(async (tx) => {
      const annualReturnRepository = createAnnualReturnRepository({ sql: tx });
      const whatsAppRepository = createWhatsAppRepository({ sql: tx });

      try {
        const case_ = await annualReturnRepository.getCase(data.caseId);

        if (!case_) {
          throw new Error("Annual return case not found.");
        }

        const result = await queueAnnualReturnWhatsAppReminder({
          annualReturnRepository,
          whatsAppRepository,
          case_,
          actorId,
          recipientName: data.recipientName,
          recipientPhone: data.recipientPhone,
        });

        return {
          caseId: result.case.id,
          remindersSent: result.case.remindersSent,
          currentStatus: result.case.currentStatus,
          messageId: result.message.id,
          messageStatus: result.message.status,
        };
      } finally {
        await annualReturnRepository.close();
        await whatsAppRepository.close();
      }
    });
  });

export const updateAnnualReturnChecklistItem = createServerFn({ method: "POST" })
  .validator(updateChecklistItemSchema)
  .handler(async ({ data }) =>
    withAnnualReturnRepository((repository, actorId) =>
      repository.updateChecklistItem({
        ...data,
        actorId,
      }),
    ),
  );

export const updateAnnualReturnPayment = createServerFn({ method: "POST" })
  .validator(updatePaymentSchema)
  .handler(async ({ data }) =>
    withAnnualReturnRepository((repository, actorId) =>
      repository.updatePayment({
        ...data,
        actorId,
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
    withAnnualReturnRepository((repository, actorId) =>
      repository.updateFilingProof({
        ...data,
        actorId,
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
