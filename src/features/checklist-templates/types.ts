export const SERVICE_TYPES = [
  "Annual Return — Private Ltd",
  "Annual Return — Public Ltd",
  "Incorporation — HK Ltd",
  "Change of Director",
  "Deregistration",
] as const;

export type ServiceType = (typeof SERVICE_TYPES)[number];

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
};

export type ChecklistTemplatePatch = Partial<
  Pick<
    ChecklistTemplate,
    "name" | "serviceType" | "description" | "active" | "documents" | "reminders" | "riskRules"
  >
>;
