export const annualReturnQueryKeys = {
  all: ["annual-returns"] as const,
  list: (filters: object) => ["annual-returns", "list", filters] as const,
  detail: (caseId: string) => ["annual-returns", "detail", caseId] as const,
  notes: (caseId: string) => ["annual-returns", "notes", caseId] as const,
  documents: (caseId: string) => ["annual-returns", "documents", caseId] as const,
  payment: (caseId: string) => ["annual-returns", "payment", caseId] as const,
  notifications: (caseId: string) => ["annual-returns", "notifications", caseId] as const,
};
