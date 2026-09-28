export type DomainItemResult = {
  state: "succeeded" | "skipped" | "conflict";
  reasonCode: string | null;
  revision: number;
  auditRef: string;
};
