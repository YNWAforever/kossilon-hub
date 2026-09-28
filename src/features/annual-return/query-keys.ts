export const annualReturnQueryKeys = {
  all: ["annual-returns"] as const,
  workViews: () => ["annual-return", "work-views"] as const,
  workViewPage: (view: string, cursor?: string, asOf?: string) =>
    ["annual-return", "work-views", view, cursor, asOf] as const,
  list: (filters: object) => ["annual-returns", "list", filters] as const,
  boardPages: (filters: object) => ["annual-returns", "board-pages", filters] as const,
  boardTotals: (scope: object) => ["annual-returns", "board-totals", scope] as const,
  detail: (caseId: string) => ["annual-returns", "detail", caseId] as const,
  notes: (caseId: string) => ["annual-returns", "notes", caseId] as const,
  history: (caseId: string) => ["annual-returns", "history", caseId] as const,
  documents: (caseId: string) => ["annual-returns", "documents", caseId] as const,
  payment: (caseId: string) => ["annual-returns", "payment", caseId] as const,
  notifications: (caseId: string) => ["annual-returns", "notifications", caseId] as const,
  automationNotifications: ["annual-returns", "notifications", "automation"] as const,
};
