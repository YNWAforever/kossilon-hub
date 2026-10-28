import { ROLE_LABELS } from "@/features/auth/role-labels";
import { z } from "zod";
export const STAFF_ROLES = ["Admin", "Manager", "Staff", "Client"] as const;

/** Display labels; the role values themselves are stored and compared in code. */
export const STAFF_ROLE_LABELS: Record<(typeof STAFF_ROLES)[number], string> = ROLE_LABELS;
export const staffFiltersSchema = z
  .object({
    q: z.string().trim().min(1).max(120).optional(),
    role: z.enum(STAFF_ROLES).optional(),
    teamId: z.string().guid().optional(),
    active: z.boolean().optional(),
    cursor: z.string().guid().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();
export const updateStaffSchema = z
  .object({
    userId: z.string().guid(),
    expectedVersion: z.number().int().positive(),
    role: z.enum(STAFF_ROLES),
    teamId: z.string().guid().nullable(),
    active: z.boolean(),
  })
  .strict();
export const reassignmentPreviewSchema = z
  .object({ userId: z.string().guid(), expectedVersion: z.number().int().positive() })
  .strict();
const recipientSchema = reassignmentPreviewSchema;
export const handoverSelectionSchema = reassignmentPreviewSchema
  .extend({
    owner: recipientSchema.nullable(),
    reviewer: recipientSchema.nullable(),
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
export const handoverPageSchema = handoverSelectionSchema
  .extend({
    cursor: z.number().int().nonnegative().optional(),
    fingerprint: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
export const handoverCommandSchema = handoverSelectionSchema
  .extend({
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    operationId: z.string().guid(),
  })
  .strict();
export type HandoverSelection = z.infer<typeof handoverSelectionSchema>;
export type HandoverCommand = z.infer<typeof handoverCommandSchema>;
export type HandoverEntry = {
  kind: "annual_return" | "incorporation" | "corporate_change" | "work_item";
  id: string;
  title: string;
  status: string;
  owner: boolean;
  reviewer: boolean;
};
export type HandoverPage = {
  fingerprint: string;
  caseCount: number;
  workItemCount: number;
  entries: HandoverEntry[];
  nextCursor: number | null;
};
export type HandoverReceipt = {
  operationId: string;
  userId: string;
  actorId: string;
  expectedVersion: number;
  caseCount: number;
  workItemCount: number;
  remainingCases: number;
  remainingWorkItems: number;
  replayed: boolean;
};
export type HandoverCancellation =
  | { status: "cancelled"; operationId: string }
  | { status: "committed"; receipt: HandoverReceipt };
export const handoverReceiptSchema = z
  .object({
    operationId: z.string().guid(),
    userId: z.string().guid(),
    actorId: z.string().guid(),
    expectedVersion: z.number().int().positive(),
    caseCount: z.number().int().nonnegative(),
    workItemCount: z.number().int().nonnegative(),
    remainingCases: z.number().int().nonnegative(),
    remainingWorkItems: z.number().int().nonnegative(),
    replayed: z.boolean(),
  })
  .strict();
export type StaffFilters = z.infer<typeof staffFiltersSchema>;
export type UpdateStaffInput = z.infer<typeof updateStaffSchema>;
export type StaffMember = {
  userId: string;
  displayName: string;
  email: string;
  role: UpdateStaffInput["role"];
  teamId: string | null;
  teamName: string | null;
  active: boolean;
  expectedVersion: number;
  openCases: number;
  openWorkItems: number;
  lastLogin: null;
  stateMismatch: boolean;
};
export type StaffPage = { staff: StaffMember[]; nextCursor: string | null };
export type HandoverPreview = {
  userId: string;
  expectedVersion: number;
  openCases: number;
  openWorkItems: number;
  cases: {
    id: string;
    companyName: string;
    status: string;
    caseType?: "annual_return" | "incorporation" | "corporate_change";
  }[];
  workItems: { id: string; title: string; version: number }[];
  truncated: boolean;
};
