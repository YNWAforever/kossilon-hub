import { z } from "zod";
export const PAYMENT_RETURN_REASONS = [
  "unreadable",
  "amount_mismatch",
  "date_mismatch",
  "duplicate_proof",
  "wrong_account",
  "other",
] as const;
const source = {
  caseId: z.string().uuid(),
  paymentId: z.string().uuid(),
  documentId: z.string().uuid(),
  proofVersionId: z.string().uuid(),
  expectedVersion: z.string().regex(/^[0-9a-f]{32}$/),
};
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (value) => !isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value,
    "Actual valid date required",
  );
export const recordPaymentEvidenceSchema = z
  .object({
    ...source,
    amount: z
      .string()
      .regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/)
      .refine((v) => Number(v) > 0, "Amount must be positive"),
    receivedOn: date,
    reference: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export const paymentReviewSchema = z
  .object({
    ...source,
    decision: z.enum(["verified", "rejected"]),
    reasonCode: z.enum(PAYMENT_RETURN_REASONS).optional(),
    reasonText: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.decision === "rejected" && (!value.reasonCode || !value.reasonText))
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Concrete return reason is required" });
  });
export type PaymentReviewInput = z.infer<typeof paymentReviewSchema>;
