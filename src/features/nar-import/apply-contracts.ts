import { z } from "zod";
import type { JsonValue } from "./repository";
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(v);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Invalid calendar date");
export const narRowInputsSchema = z
  .object({
    templateId: z.string().uuid().optional(),
    ownerId: z.string().uuid().optional(),
    feeAmount: z.number().int().positive().max(100000000).optional(),
    invoiceNumber: z.string().trim().min(1).max(120).optional(),
    madeUpDate: date.optional(),
    acknowledgeDueDifference: z.boolean().optional(),
    acknowledgeYearDifference: z.boolean().optional(),
    acknowledgeSourceIssues: z.boolean().optional(),
  })
  .strict();
export type NarRowInputs = z.infer<typeof narRowInputsSchema>;
export const narPreviewSchema = z
  .object({
    batchId: z.string().uuid(),
    rowIds: z.array(z.string().uuid()).min(1).max(500),
    inputs: z.record(z.string().uuid(), narRowInputsSchema).default({}),
    dataOrigin: z.enum(["historical", "client"]).default("historical"),
    activateCurrentYear: z.boolean().default(false),
  })
  .strict();
export const narExecuteSchema = z
  .object({ previewId: z.string().uuid(), idempotencyKey: z.string().trim().min(1).max(120) })
  .strict();
export type CaseValue = {
  id: string;
  company_id: string;
  return_year: number;
  filing_due_date: string;
  made_up_date: string;
  current_status: string;
  import_origin: "historical" | "client" | null;
  locked_at: string | null;
  completed_at: string | null;
  reminders_sent: number;
  filing_reference: string | null;
  [key: string]: JsonValue;
};
export type NarPreviewItem = {
  rowId: string;
  revision: string;
  dataOrigin: "client" | "historical";
  input: NarRowInputs;
  original: CaseValue | null;
  candidate: {
    companyId: string | null;
    returnYear: number | null;
    madeUpDate: string | null;
    filingDueDate: string | null;
    invoiceNumber: string | null;
    feeAmount: number | null;
  };
  diff: {
    field:
      | "companyId"
      | "returnYear"
      | "madeUpDate"
      | "filingDueDate"
      | "invoiceNumber"
      | "feeAmount";
    before: string | number | null;
    after: string | number | null;
  }[];
  requiredInputs: string[];
  conflicts: string[];
  command: "create" | "update" | "unchanged" | "already_applied";
  raw: JsonValue;
  parserVersion: string;
};

export const narYearConfirmationSchema = z
  .object({
    batchId: z.string().uuid(),
    expectedVersion: z.string().regex(/^[a-f0-9]{32}$/),
    returnYear: z.number().int().min(1900).max(2100),
    reason: z.string().trim().min(10).max(1000),
    acknowledgeSheetDifference: z.boolean().default(false),
  })
  .strict();
