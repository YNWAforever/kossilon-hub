export const SERVICE_TYPES = [
  "Annual Return — Private Ltd",
  "Annual Return — Public Ltd",
  "Incorporation — HK Ltd",
  "Change of Director",
  "Deregistration",
] as const;

export type ServiceType = (typeof SERVICE_TYPES)[number];

// Display labels. The values above are stored in checklist_templates.service_type
// and compared in code, so they stay English; screens render them through this map.
export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = {
  "Annual Return — Private Ltd": "周年申報 — 私人有限公司",
  "Annual Return — Public Ltd": "周年申報 — 公眾有限公司",
  "Incorporation — HK Ltd": "公司註冊 — 香港有限公司",
  "Change of Director": "董事變更",
  Deregistration: "撤銷註冊",
};

/** Falls back to the raw value so an unexpected service type is still shown. */
export function serviceTypeLabel(serviceType: string): string {
  return SERVICE_TYPE_LABELS[serviceType as ServiceType] ?? serviceType;
}

export type DocumentItem = {
  id: string;
  label: string;
  required: boolean;
  daysBeforeDue: number;
  note?: string;
};

export type ReminderRule = {
  id: string;
  label: string;
  daysBeforeDue: number;
  channel: "WhatsApp" | "Email" | "SMS";
};

export type RiskRule = {
  id: string;
  label: string;
  severity: "Low" | "Medium" | "High";
  trigger: string;
  enabled: boolean;
};

export type ChecklistTemplate = {
  id: string;
  name: string;
  serviceType: ServiceType;
  description: string;
  active: boolean;
  documents: DocumentItem[];
  reminders: ReminderRule[];
  riskRules: RiskRule[];
  updatedAt: string;
  /** Absent for old read-only fixtures. Production always has an observed revision. */
  revision?: number;
};

export type TemplateMigrationPreview = {
  revision: number;
  total: number;
  unknownLegacyCases: number;
  cases: {
    caseId: string;
    companyName: string;
    returnYear: number;
    fromRevision: number;
    toRevision: number;
    added: string[];
    removed: string[];
    closed: boolean;
  }[];
  nextCursor: string | null;
};

export type ChecklistTemplatePatch = Partial<
  Pick<
    ChecklistTemplate,
    "name" | "serviceType" | "description" | "active" | "documents" | "reminders" | "riskRules"
  >
>;
