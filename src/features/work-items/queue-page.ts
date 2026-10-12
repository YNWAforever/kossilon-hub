import { z } from "zod";
import { listPageSize } from "@/lib/list-page";
import type { PersistedWorkItem } from "./repository";

export const workQueuePageInputSchema = z
  .object({
    view: z.enum(["mine", "team", "breached"]).default("mine"),
    ownerId: z.string().uuid().optional(),
    unassigned: z.boolean().optional(),
    escalationState: z.enum(["none", "warning", "breach", "acknowledged"]).optional(),
    q: z.string().trim().max(200).default(""),
    workType: z.string().max(100).optional(),
    priority: z.enum(["high", "normal"]).optional(),
    workStatus: z.enum(["open", "in_progress", "blocked"]).optional(),
    sort: z.enum(["sla", "recent"]).default("sla"),
    cursor: z.string().max(8192).optional(),
    limit: listPageSize,
  })
  .strict()
  .default({});
export type WorkQueuePageInput = z.input<typeof workQueuePageInputSchema>;
export type WorkQueueSummary = Omit<
  PersistedWorkItem,
  "slaStartedAt" | "slaWarningAt" | "slaDueAt"
> & {
  slaStartedAt: string | null;
  slaWarningAt: string | null;
  slaDueAt: string | null;
};
