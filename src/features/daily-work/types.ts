import { z } from "zod";
import { listPageSize, type ListPage } from "@/lib/list-page";
import { WORK_VIEWS, type WorkViewKey } from "@/features/annual-return/work-views";
export const DAILY_SOURCES = [
  "annual_return",
  "incorporation",
  "corporate_change_request",
] as const;
export type DailyWorkSource = (typeof DAILY_SOURCES)[number];
export const dailyWorkInputSchema = z
  .object({
    q: z.string().trim().max(200).default(""),
    scope: z.enum(["mine", "team"]).default("mine"),
    sourceType: z.enum(["all", ...DAILY_SOURCES]).default("all"),
    view: z
      .custom<"all" | WorkViewKey>((v) => v === "all" || WORK_VIEWS.some((x) => x.key === v))
      .default("all"),
    sort: z.enum(["deadline", "company"]).default("deadline"),
    companyId: z.string().uuid().optional(),
    history: z.boolean().default(false),
    cursor: z.string().max(8192).optional(),
    limit: listPageSize,
  })
  .strict()
  .refine((v) => v.view === "all" || v.sourceType === "annual_return", {
    message: "Annual return categories require the annual return source.",
  })
  .refine((v) => !v.history || v.view === "all", {
    message: "History cannot bypass an annual return work category.",
  });
export type DailyWorkInput = z.input<typeof dailyWorkInputSchema>;
export type DailyWorkRow = {
  workKey: string;
  sourceType: DailyWorkSource;
  sourceId: string;
  companyId: string | null;
  companyName: string;
  dueDate: string | null;
  ownerName: string;
  blocker: string;
  nextAction: { label: string; href: string; enabled: boolean; reason?: string };
  updatedAt: string;
};
export type DailySourceStatus = {
  sourceType: DailyWorkSource;
  status: "available" | "unavailable";
  total: number | null;
  reason?: string;
  supportId?: string;
};
export type DailyWorkPage = ListPage<DailyWorkRow> & {
  sources: DailySourceStatus[];
  partial: boolean;
  businessDate: string;
};
