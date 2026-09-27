import { z } from "zod";

const uuid = z.string().uuid();
export const bulkPreviewInputSchema = z
  .object({
    action: z.literal("assign"),
    selection: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("ids"), ids: z.array(uuid).min(1).max(1000) }).strict(),
      z
        .object({
          kind: z.literal("filter"),
          resource: z.literal("work-items"),
          filters: z
            .object({
              teamId: uuid.optional(),
              statuses: z.array(z.enum(["open", "in_progress", "blocked"])).optional(),
            })
            .strict(),
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
  .strict();
export type BulkPreviewInput = z.output<typeof bulkPreviewInputSchema>;
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
  action: "assign";
  selectionCount: number;
  eligibleCount: number;
  skippedCount: number;
  conflictCount: number;
  expiresAt: string;
  itemsPreview: {
    resourceId: string;
    revision: number;
    state: "eligible" | "skipped" | "conflict";
  }[];
};
export type BulkOperation = {
  id: string;
  action: "assign";
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
    revisionBefore: number;
    revisionAfter: number | null;
    auditRef: string | null;
  }[];
};
