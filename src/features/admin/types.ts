import { z } from "zod";
export const STAFF_ROLES = ["Admin", "Manager", "Staff", "Client"] as const;
export const staffFiltersSchema = z
  .object({
    q: z.string().trim().min(1).max(120).optional(),
    role: z.enum(STAFF_ROLES).optional(),
    teamId: z.string().uuid().optional(),
    active: z.boolean().optional(),
    cursor: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();
export const updateStaffSchema = z
  .object({
    userId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    role: z.enum(STAFF_ROLES),
    teamId: z.string().uuid().nullable(),
    active: z.boolean(),
  })
  .strict();
export const reassignmentPreviewSchema = z
  .object({ userId: z.string().uuid(), expectedVersion: z.number().int().positive() })
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
    ownerId?: string | null;
    reviewerId?: string | null;
  }[];
  workItems: {
    id: string;
    title: string;
    version: number;
    ownerId?: string | null;
    reviewerId?: string | null;
  }[];
  truncated: boolean;
  openBusinessCases?: number;
  ownedCompanies?: number;
  unresolvedJobs?: number;
  businessItems?: BusinessHandoverItem[];
};

export const businessHandoverSchema = z
  .object({
    userId: z.string().uuid(),
    expectedVersion: z.number().int().positive(),
    recipientId: z.string().uuid(),
    operationId: z.string().uuid(),
    item: z
      .object({
        kind: z.enum(["incorporation", "corporate_change_request", "client_company"]),
        id: z.string().uuid(),
        version: z.string().regex(/^[a-f0-9]{32}$/),
      })
      .strict(),
  })
  .strict();
export type BusinessHandoverItem = {
  kind: "incorporation" | "corporate_change_request" | "client_company";
  id: string;
  version: string;
  label: string;
  status: string;
};
export type BusinessHandoverReceipt = {
  operationId: string;
  resourceId: string;
  kind: BusinessHandoverItem["kind"];
  state: "succeeded" | "conflict";
  recipientId: string;
};
