import { z } from "zod";
import { listPageSize } from "@/lib/list-page";
import type { DocumentSummary } from "@/features/documents/repository";
import type { AnnualReturnPayment } from "./types";
export const paymentWorkspaceInput = z
  .object({
    mode: z.enum(["review", "outstanding"]).default("review"),
    q: z.string().trim().max(200).default(""),
    cursor: z.string().max(8192).optional(),
    limit: listPageSize,
  })
  .strict()
  .default({});
export type PaymentWorkspaceInput = z.input<typeof paymentWorkspaceInput>;
type PaymentWorkspaceBase = {
  caseId: string;
  companyName: string;
  filingDueDate: string;
  sourceVersion: string;
  payment: Pick<AnnualReturnPayment, "id" | "amount" | "status" | "dueDate" | "paidAt"> & {
    receivedAmount: number;
    balance: number;
  };
  proofCount: number;
};
export type PaymentWorkspaceRow = PaymentWorkspaceBase &
  (
    | { kind: "review"; rowId: string; document: DocumentSummary }
    | { kind: "outstanding"; rowId: string; document: DocumentSummary | null }
  );
