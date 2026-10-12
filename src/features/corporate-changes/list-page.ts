import { z } from "zod";
import { businessListFields } from "@/lib/business-list";
import { CORPORATE_CHANGE_STATUSES, type CorporateChangeRequestSummary } from "./types";
export const corporateChangeListPageSchema = z
  .object({
    ...businessListFields,
    status: z.enum(["open", "all", ...CORPORATE_CHANGE_STATUSES]).default("open"),
  })
  .strict();
export type CorporateChangeListInput = z.input<typeof corporateChangeListPageSchema>;
export type CorporateChangeListRow = CorporateChangeRequestSummary & {
  dueDate: string | null;
  updatedAt: string;
  ownerName: string;
};
