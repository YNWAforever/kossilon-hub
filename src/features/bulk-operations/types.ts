import { z } from "zod";
import { ANNUAL_RETURN_STATUSES } from "@/features/annual-return/types";
export const resourceSchema = z.enum([
  "annual_return_case",
  "work_item",
  "client_company",
  "document",
]);
export const selectionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("explicit_ids"), ids: z.array(z.string().uuid()).max(5000) }).strict(),
  z
    .object({
      mode: z.literal("filtered_snapshot"),
      snapshotId: z.string().uuid(),
      excludedIds: z.array(z.string().uuid()).max(5000),
    })
    .strict(),
]);
export const scopeFiltersSchema = z
  .object({
    q: z.string().trim().min(1).max(120).optional(),
    ownerId: z.string().uuid().optional(),
    reviewerId: z.string().uuid().optional(),
    teamId: z.string().uuid().optional(),
    status: z.enum(ANNUAL_RETURN_STATUSES).optional(),
    risk: z.enum(["green", "yellow", "orange", "red"]).optional(),
    activeOnly: z.boolean().optional(),
    missingDocuments: z.boolean().optional(),
    paymentStatus: z
      .enum(["Not invoiced", "Payment pending", "Payment received", "Overdue"])
      .optional(),
    overdueOnly: z.boolean().optional(),
    includeFixtures: z.boolean().optional(),
    workType: z.string().min(1).max(100).optional(),
    workStatus: z.enum(["open", "in_progress", "blocked", "completed", "cancelled"]).optional(),
    escalationState: z.enum(["none", "warning", "breach", "acknowledged"]).optional(),
    priority: z.enum(["high", "normal"]).optional(),
    view: z.enum(["mine", "team", "breached"]).optional(),
    unassigned: z.boolean().optional(),
    clientStatus: z.enum(["active", "inactive"]).optional(),
    caseId: z.string().uuid().optional(),
  })
  .strict();
export const snapshotSchema = z
  .object({ resource: resourceSchema, filters: scopeFiltersSchema })
  .strict();
export const assignmentSchema = z
  .object({
    target: z.enum(["owner", "reviewer"]),
    assigneeId: z.string().uuid(),
    overrideReason: z.string().trim().min(1).max(2000).optional(),
  })
  .strict();
export const previewSchema = z
  .object({
    resource: z.enum(["annual_return_case", "work_item"]),
    selection: selectionSchema,
    assignment: assignmentSchema,
  })
  .strict();
export const maintenanceActionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("client_maintenance"),
      ownerId: z.string().uuid(),
      teamId: z.string().uuid(),
    })
    .strict(),
  z.object({ kind: z.literal("document_assignment"), ...assignmentSchema.shape }).strict(),
  z
    .object({
      kind: z.literal("document_return_draft"),
      reasons: z
        .record(z.string().uuid(), z.string().trim().min(1).max(500))
        .refine(
          (reasons) => Object.keys(reasons).length <= 5000,
          "At most 5000 individual reasons.",
        ),
    })
    .strict(),
  z.object({ kind: z.literal("document_list_export") }).strict(),
  z.object({ kind: z.literal("follow_up_draft") }).strict(),
  z.object({ kind: z.literal("payment_list_export") }).strict(),
]);
export const previewActionSchema = z
  .object({ resource: resourceSchema, selection: selectionSchema, action: maintenanceActionSchema })
  .strict();
export type MaintenanceAction = z.infer<typeof maintenanceActionSchema>;
export type MaintenanceActionKind = MaintenanceAction["kind"];
export type MaintenanceOutput = Record<string, string | number | boolean | null>;
export const executeSchema = z
  .object({ previewId: z.string().uuid(), idempotencyKey: z.string().min(16).max(120) })
  .strict();
export const jobSchema = z.object({ jobId: z.string().uuid() }).strict();
export const jobHistorySchema = z
  .object({
    cursor: z
      .object({ createdAt: z.string().datetime(), id: z.string().uuid() })
      .strict()
      .optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();
export type BulkJobCursor = NonNullable<z.infer<typeof jobHistorySchema>["cursor"]>;
export const resultsSchema = jobSchema
  .extend({
    cursor: z.number().int().min(0).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();
export type BulkResource = z.infer<typeof resourceSchema>;
export type BulkSelection = z.infer<typeof selectionSchema>;
export type BulkFilters = z.infer<typeof scopeFiltersSchema>;
export type PreviewInput = z.infer<typeof previewSchema>;
export type Assignment = z.infer<typeof assignmentSchema>;
export type ItemState =
  | "pending"
  | "succeeded"
  | "forbidden"
  | "locked"
  | "conflict"
  | "failed"
  | "unknown"
  | "cancelled";
export type SnapshotItem = {
  id: string;
  version: string;
  reason: "forbidden" | "locked" | "conflict" | "failed" | null;
};
export type BulkPreview = {
  previewId: string;
  count: number;
  eligibleCount: number;
  reasons: { forbidden: number; locked: number; conflict: number; failed: number };
  payloadHash: string;
  details?: { id: string; output: MaintenanceOutput }[];
};
export type JobItemResult = {
  ordinal: number;
  resourceId: string | null;
  resourceLabel: string | null;
  state: ItemState;
  reason: string | null;
  retryable: boolean;
  attempts: number;
  output?: MaintenanceOutput | null;
};
export type JobResult = {
  jobId: string;
  resource: BulkResource;
  state: "queued" | "running" | "completed" | "partial" | "cancelled";
  total: number;
  counts: Record<string, number>;
  retryableFailedCount: number;
  items: JobItemResult[];
  nextCursor: number | null;
};
export type JobLease = { jobId: string; token: string };
