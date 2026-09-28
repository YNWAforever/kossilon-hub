import { z } from "zod";
import { ANNUAL_RETURN_STATUSES } from "@/features/annual-return/types";

const uuid = z.string().uuid();
export const bulkResourceSelectionSchema = z.union([
  z
    .object({
      kind: z.literal("ids"),
      resource: z.enum(["clients", "annual-return-cases", "work-items"]),
      ids: z.array(uuid).min(1).max(1000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("filter"),
      resource: z.literal("clients"),
      filters: z
        .object({
          q: z.string().trim().max(200).optional(),
          status: z.enum(["all", "active", "inactive"]).optional(),
          teamId: uuid.optional(),
        })
        .strict(),
      excludedIds: z.array(uuid).max(1000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("filter"),
      resource: z.literal("annual-return-cases"),
      filters: z
        .object({
          q: z.string().trim().max(200).optional(),
          status: z.enum(ANNUAL_RETURN_STATUSES).optional(),
          risk: z.enum(["green", "yellow", "orange", "red"]).optional(),
          ownerId: uuid.optional(),
          overdueOnly: z.boolean().optional(),
        })
        .strict(),
      excludedIds: z.array(uuid).max(1000),
    })
    .strict(),
  z
    .object({
      kind: z.literal("filter"),
      resource: z.literal("work-items"),
      filters: z.union([
        z
          .object({
            teamId: uuid.optional(),
            statuses: z.array(z.enum(["open", "in_progress", "blocked"])).optional(),
          })
          .strict(),
        z
          .object({
            view: z.enum(["mine", "team", "breached"]),
            owner: z.union([z.literal("all"), z.literal("unassigned"), uuid]),
            workType: z.string().max(100),
            sla: z.enum([
              "all",
              "not-configured",
              "not-started",
              "on-track",
              "at-risk",
              "breached",
              "acknowledged",
              "unavailable",
            ]),
            priority: z.enum(["all", "high", "normal"]),
            status: z.enum(["all", "open", "in_progress", "blocked"]),
            q: z.string().max(200),
          })
          .strict(),
      ]),
      excludedIds: z.array(uuid).max(1000),
    })
    .strict(),
]);
export const bulkExportInputSchema = z.object({ selection: bulkResourceSelectionSchema }).strict();
export type BulkExportInput = z.output<typeof bulkExportInputSchema>;
const domainSelection = z
  .object({ kind: z.literal("ids"), ids: z.array(uuid).min(1).max(1000) })
  .strict();
const paymentItem = z
  .object({
    observationId: uuid,
    caseId: uuid,
    expectedRevision: z.number().int().positive(),
    decision: z.enum(["match", "reject"]),
    reason: z.string().trim().max(500).optional(),
    proofVersionId: uuid.optional(),
    confirmation: z
      .object({
        invoiceRef: z.string().trim().min(1).max(200),
        amountMinor: z.number().int().positive(),
        currency: z.string().regex(/^[A-Z]{3}$/),
      })
      .strict()
      .optional(),
  })
  .strict();
const prepareItem = z
  .object({ caseId: uuid, expectedRevision: z.number().int().nonnegative() })
  .strict();
const submissionItem = z
  .object({
    caseId: uuid,
    packageId: uuid,
    manifestHash: z.string().regex(/^[a-f0-9]{64}$/),
    submittedAt: z.string().min(1).max(40),
    destinationLabel: z.string().trim().min(1).max(120),
    externalReference: z.string().trim().min(1).max(200),
    proofVersionId: uuid,
    expectedRevision: z.number().int().positive(),
  })
  .strict();
const returnItem = z
  .object({
    caseId: uuid,
    externalReference: z.string().trim().min(1).max(200),
    manifestHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    outcome: z.enum(["accepted", "rejected", "partial"]),
    detail: z.string().trim().max(2000).nullable().optional(),
    source: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("manual"), proofVersionId: uuid }).strict(),
      z.object({ kind: z.literal("internal"), sourceObjectRecordId: uuid }).strict(),
    ]),
  })
  .strict();
export const bulkPreviewInputSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("assign"),
      selection: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("ids"), ids: z.array(uuid).min(1).max(1000) }).strict(),
        z
          .object({
            kind: z.literal("filter"),
            resource: z.literal("work-items"),
            filters: z.union([
              z
                .object({
                  teamId: uuid.optional(),
                  statuses: z.array(z.enum(["open", "in_progress", "blocked"])).optional(),
                })
                .strict(),
              z
                .object({
                  view: z.enum(["mine", "team", "breached"]),
                  owner: z.union([z.literal("all"), z.literal("unassigned"), uuid]),
                  workType: z.string().max(100),
                  sla: z.enum([
                    "all",
                    "not-configured",
                    "not-started",
                    "on-track",
                    "at-risk",
                    "breached",
                    "acknowledged",
                    "unavailable",
                  ]),
                  priority: z.enum(["all", "high", "normal"]),
                  status: z.enum(["all", "open", "in_progress", "blocked"]),
                  q: z.string().max(200),
                })
                .strict(),
            ]),
            excludedIds: z.array(uuid).max(1000),
          })
          .strict(),
      ]),
      parameters: z
        .object({
          assigneeId: uuid,
          assignmentTarget: z.enum(["owner", "reviewer"]),
          overrideReason: z.string().trim().min(1).max(500).optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("caseAssign"),
      selection: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("ids"), ids: z.array(uuid).min(1).max(1000) }).strict(),
        z
          .object({
            kind: z.literal("filter"),
            resource: z.literal("annual-return-cases"),
            filters: z
              .object({
                q: z.string().trim().max(200).optional(),
                status: z.enum(ANNUAL_RETURN_STATUSES).optional(),
                risk: z.enum(["green", "yellow", "orange", "red"]).optional(),
                ownerId: uuid.optional(),
                overdueOnly: z.boolean().optional(),
              })
              .strict(),
            excludedIds: z.array(uuid).max(1000),
          })
          .strict(),
      ]),
      parameters: z.object({ ownerId: uuid }).strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("reminderDrafts"),
      selection: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("ids"), ids: z.array(uuid).min(1).max(1000) }).strict(),
        z
          .object({
            kind: z.literal("filter"),
            resource: z.literal("annual-return-cases"),
            filters: z
              .object({
                q: z.string().trim().max(200).optional(),
                status: z.enum(ANNUAL_RETURN_STATUSES).optional(),
                risk: z.enum(["green", "yellow", "orange", "red"]).optional(),
                ownerId: uuid.optional(),
                overdueOnly: z.boolean().optional(),
              })
              .strict(),
            excludedIds: z.array(uuid).max(1000),
          })
          .strict(),
      ]),
      parameters: z.object({}).strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("clientAssign"),
      selection: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("ids"), ids: z.array(uuid).min(1).max(1000) }).strict(),
        z
          .object({
            kind: z.literal("filter"),
            resource: z.literal("clients"),
            filters: z
              .object({
                q: z.string().trim().max(200).optional(),
                status: z.enum(["all", "active", "inactive"]).optional(),
                teamId: uuid.optional(),
              })
              .strict(),
            excludedIds: z.array(uuid).max(1000),
          })
          .strict(),
      ]),
      parameters: z.object({ ownerId: uuid }).strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("tag"),
      selection: bulkResourceSelectionSchema,
      parameters: z
        .object({
          tag: z
            .string()
            .trim()
            .min(1)
            .max(64)
            .refine((value) =>
              [...value].every((char) => {
                const code = char.codePointAt(0)!;
                return code >= 32 && code !== 127;
              }),
            ),
          mode: z.enum(["add", "remove"]),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("reconcilePayments"),
      selection: domainSelection,
      parameters: z.object({ items: z.array(paymentItem).min(1).max(1000) }).strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("preparePackages"),
      selection: domainSelection,
      parameters: z.object({ items: z.array(prepareItem).min(1).max(1000) }).strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("recordSubmissions"),
      selection: domainSelection,
      parameters: z.object({ items: z.array(submissionItem).min(1).max(1000) }).strict(),
    })
    .strict(),
  z
    .object({
      action: z.literal("matchReturns"),
      selection: domainSelection,
      parameters: z.object({ items: z.array(returnItem).min(1).max(1000) }).strict(),
    })
    .strict(),
]);
export type BulkPreviewInput = z.output<typeof bulkPreviewInputSchema>;
export type ActiveDomainAction =
  | "reconcilePayments"
  | "preparePackages"
  | "recordSubmissions"
  | "matchReturns";
export type BulkAction =
  | BulkPreviewInput["action"]
  | "classifyDocuments"
  | "assignReview"
  | "retryAnalysis"
  | "importApply";
export const bulkCommitInputSchema = z
  .object({
    previewId: uuid,
    previewHash: z.string().regex(/^[a-f0-9]{64}$/),
    idempotencyKey: z.string().trim().min(8).max(128),
  })
  .strict();
export type BulkCommitInput = z.output<typeof bulkCommitInputSchema>;
export type BulkItemState =
  | "pending"
  | "running"
  | "succeeded"
  | "skipped"
  | "conflict"
  | "forbidden"
  | "failed"
  | "needs-reconciliation"
  | "cancelled";
export type BulkOperationState =
  | "queued"
  | "running"
  | "completed"
  | "completed-with-errors"
  | "cancelled";
export type BulkPreview = {
  id: string;
  previewHash: string;
  action: BulkPreviewInput["action"];
  selectionCount: number;
  eligibleCount: number;
  skippedCount: number;
  conflictCount: number;
  expiresAt: string;
  itemsPreview: {
    resourceId: string;
    revision: number | null;
    state: "eligible" | "skipped" | "conflict" | "forbidden";
    reasonCode?: string | null;
    oldOwnerId?: string | null;
    oldTeamId?: string | null;
    newOwnerId?: string | null;
    newTeamId?: string | null;
    recipientName?: string | null;
    recipientE164?: string | null;
    renderedText?: string | null;
    sendMode?: "text" | "template" | null;
    reviewId?: string | null;
  }[];
};
export type BulkOperation = {
  id: string;
  action: BulkPreviewInput["action"] | "importApply";
  state: BulkOperationState;
  createdBy: string;
  createdAt: string;
  counts: Record<BulkItemState, number>;
};
export type BulkOperationView = BulkOperation & {
  items: {
    itemId: string;
    resourceId: string;
    state: BulkItemState;
    reasonCode: string | null;
    revisionBefore: number | null;
    revisionAfter: number | null;
    auditRef: string | null;
    reviewId?: string | null;
  }[];
};

/** Fixed identifiers and reason codes only; evidence bytes stay in domain records. */
export type BulkManualReviewItem = {
  operationId: string;
  itemId: string;
  action: ActiveDomainAction;
  resourceId: string;
  state: "conflict" | "forbidden" | "failed" | "needs-reconciliation";
  reasonCode: string | null;
  auditRef: string | null;
  updatedAt: string;
};
