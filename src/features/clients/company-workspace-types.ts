import { z } from "zod";
import { listPageSize } from "@/lib/list-page";
export const COMPANY_WORKSPACE_TABS = [
  "overview",
  "cases",
  "documents",
  "payments",
  "activity",
] as const;
export type CompanyWorkspaceTab = (typeof COMPANY_WORKSPACE_TABS)[number];
export const companyWorkspaceInput = z
  .object({
    companyId: z.string().uuid(),
    q: z.string().trim().max(200).default(""),
    cursor: z.string().max(8192).optional(),
    limit: listPageSize,
    history: z.boolean().default(false),
    kind: z
      .enum(["all", "annual_return", "incorporation", "corporate_change_request"])
      .default("all"),
    eventType: z.string().max(80).default("all"),
  })
  .strict();
export type CompanyWorkspaceInput = z.input<typeof companyWorkspaceInput>;
export type CompanyWorkspaceSummary = {
  companyId: string;
  companyName: string;
  openCases: number;
  documents: number;
  paymentCases: number;
  outstandingAmount: string;
  partial: boolean;
  observedAt: string;
  scopeNotice: string;
};
export type CompanyActivity = {
  id: string;
  eventType: string;
  actorName: string;
  description: string;
  createdAt: string;
};
export type CompanyWorkspaceSearch = {
  tab: CompanyWorkspaceTab;
  q: string;
  cursor?: string;
  history: boolean;
  kind: "all" | "annual_return" | "incorporation" | "corporate_change_request";
  eventType: string;
  returnTo?: string;
};
