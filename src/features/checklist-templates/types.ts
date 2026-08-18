export type ServiceType =
  | "Annual Return — Private Ltd"
  | "Annual Return — Public Ltd"
  | "Incorporation — HK Ltd"
  | "Change of Director"
  | "Deregistration";

export const SERVICE_TYPES: ServiceType[] = [
  "Annual Return — Private Ltd",
  "Annual Return — Public Ltd",
  "Incorporation — HK Ltd",
  "Change of Director",
  "Deregistration",
];

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
