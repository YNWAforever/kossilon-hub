import { z } from "zod";
import { businessListFields } from "@/lib/business-list";
import { INCORPORATION_STATUSES, type IncorporationCaseSummary } from "./types";
export const incorporationListPageSchema = z
  .object({
    ...businessListFields,
    status: z.enum(["open", "all", ...INCORPORATION_STATUSES]).default("open"),
  })
  .strict();
export type IncorporationListInput = z.input<typeof incorporationListPageSchema>;
export type IncorporationListRow = IncorporationCaseSummary & {
  dueDate: string | null;
  updatedAt: string;
};
