// Checklist template fixture for demo mode (read-only — see docs/adr/0001-demo-mode-is-read-only.md).
import { useSyncExternalStore } from "react";
import type { ChecklistTemplate, ServiceType } from "@/features/checklist-templates/types";

export type {
  ChecklistTemplate,
  DocumentItem,
  ReminderRule,
  RiskRule,
  ServiceType,
} from "@/features/checklist-templates/types";
export { SERVICE_TYPES } from "@/features/checklist-templates/types";

const nowIso = () => new Date("2026-07-04T09:00:00+08:00").toISOString();

const initialTemplates: ChecklistTemplate[] = [
  {
    id: "tpl-ar-private",
    name: "Annual return — Private Ltd",
    serviceType: "Annual Return — Private Ltd",
    description: "Standard checklist for a Hong Kong private limited company annual return (NAR1).",
    active: true,
    updatedAt: nowIso(),
    documents: [
      { id: "doc-ar-priv-1", label: "Signed NAR1 form", required: true, daysBeforeDue: 7 },
      {
        id: "doc-ar-priv-2",
        label: "Register of members (updated)",
        required: true,
        daysBeforeDue: 14,
      },
      { id: "doc-ar-priv-3", label: "Register of directors", required: true, daysBeforeDue: 14 },
      { id: "doc-ar-priv-4", label: "Register of secretaries", required: true, daysBeforeDue: 14 },
      {
        id: "doc-ar-priv-5",
        label: "Business registration certificate copy",
        required: true,
        daysBeforeDue: 30,
      },
      {
        id: "doc-ar-priv-6",
        label: "Proof of registered office address",
        required: true,
        daysBeforeDue: 30,
      },
      {
        id: "doc-ar-priv-7",
        label: "ID copies of all directors",
        required: true,
        daysBeforeDue: 30,
      },
    ],
    reminders: [
      { id: "rem-ar-priv-1", label: "First reminder", daysBeforeDue: 30, channel: "WhatsApp" },
      { id: "rem-ar-priv-2", label: "Second reminder", daysBeforeDue: 14, channel: "WhatsApp" },
      { id: "rem-ar-priv-3", label: "Third reminder", daysBeforeDue: 7, channel: "WhatsApp" },
      { id: "rem-ar-priv-4", label: "Final reminder", daysBeforeDue: 2, channel: "WhatsApp" },
    ],
    riskRules: [
      {
        id: "risk-ar-priv-1",
        label: "Deadline critical",
        severity: "High",
        trigger: "Deadline < 3 days & docs incomplete",
        enabled: true,
      },
      {
        id: "risk-ar-priv-2",
        label: "Client silent",
        severity: "Medium",
        trigger: "No client reply after 3 reminders",
        enabled: true,
      },
      {
        id: "risk-ar-priv-3",
        label: "Payment overdue",
        severity: "Medium",
        trigger: "Invoice unpaid > 14 days",
        enabled: true,
      },
    ],
  },
  {
    id: "tpl-ar-public",
    name: "Annual return — Public Ltd",
    serviceType: "Annual Return — Public Ltd",
    description: "Public company AR with auditor's report and additional disclosures.",
    active: true,
    updatedAt: nowIso(),
    documents: [
      { id: "doc-ar-pub-1", label: "Signed NAR1 form", required: true, daysBeforeDue: 7 },
      {
        id: "doc-ar-pub-2",
        label: "Audited financial statements",
        required: true,
        daysBeforeDue: 21,
      },
      { id: "doc-ar-pub-3", label: "Auditor's report", required: true, daysBeforeDue: 21 },
      { id: "doc-ar-pub-4", label: "Register of members", required: true, daysBeforeDue: 14 },
      { id: "doc-ar-pub-5", label: "Register of directors", required: true, daysBeforeDue: 14 },
      { id: "doc-ar-pub-6", label: "Directors' report", required: true, daysBeforeDue: 14 },
    ],
    reminders: [
      { id: "rem-ar-pub-1", label: "First reminder", daysBeforeDue: 45, channel: "Email" },
      { id: "rem-ar-pub-2", label: "Second reminder", daysBeforeDue: 21, channel: "WhatsApp" },
      { id: "rem-ar-pub-3", label: "Final reminder", daysBeforeDue: 7, channel: "WhatsApp" },
    ],
    riskRules: [
      {
        id: "risk-ar-pub-1",
        label: "Auditor delay",
        severity: "High",
        trigger: "Audit report outstanding < 21 days to due",
        enabled: true,
      },
      {
        id: "risk-ar-pub-2",
        label: "Deadline critical",
        severity: "High",
        trigger: "Deadline < 3 days & docs incomplete",
        enabled: true,
      },
    ],
  },
  {
    id: "tpl-incorp",
    name: "Incorporation — HK Ltd",
    serviceType: "Incorporation — HK Ltd",
    description: "New Hong Kong private limited company incorporation.",
    active: true,
    updatedAt: nowIso(),
    documents: [
      { id: "doc-incorp-1", label: "NNC1 incorporation form", required: true, daysBeforeDue: 3 },
      { id: "doc-incorp-2", label: "Articles of association", required: true, daysBeforeDue: 3 },
      {
        id: "doc-incorp-3",
        label: "IRBR1 business registration notice",
        required: true,
        daysBeforeDue: 3,
      },
      {
        id: "doc-incorp-4",
        label: "ID / passport of each director & shareholder",
        required: true,
        daysBeforeDue: 5,
      },
      {
        id: "doc-incorp-5",
        label: "Proof of address for each director",
        required: true,
        daysBeforeDue: 5,
      },
    ],
    reminders: [
      { id: "rem-incorp-1", label: "Docs kick-off", daysBeforeDue: 7, channel: "WhatsApp" },
      { id: "rem-incorp-2", label: "Signature reminder", daysBeforeDue: 2, channel: "WhatsApp" },
    ],
    riskRules: [
      {
        id: "risk-incorp-1",
        label: "KYC incomplete",
        severity: "High",
        trigger: "Missing director ID > 3 days",
        enabled: true,
      },
    ],
  },
  {
    id: "tpl-cod",
    name: "Change of director",
    serviceType: "Change of Director",
    description: "Appointment or resignation of a company director (ND2A / ND2B).",
    active: true,
    updatedAt: nowIso(),
    documents: [
      { id: "doc-cod-1", label: "ND2A / ND2B form", required: true, daysBeforeDue: 5 },
      { id: "doc-cod-2", label: "Board resolution", required: true, daysBeforeDue: 5 },
      { id: "doc-cod-3", label: "Consent to act as director", required: true, daysBeforeDue: 5 },
      { id: "doc-cod-4", label: "New director ID copy", required: true, daysBeforeDue: 5 },
    ],
    reminders: [{ id: "rem-cod-1", label: "Docs reminder", daysBeforeDue: 7, channel: "WhatsApp" }],
    riskRules: [
      {
        id: "risk-cod-1",
        label: "Statutory 15-day window",
        severity: "High",
        trigger: "Filing not submitted within 15 days of change",
        enabled: true,
      },
    ],
  },
  {
    id: "tpl-dereg",
    name: "Deregistration",
    serviceType: "Deregistration",
    description: "Voluntary deregistration of a defunct solvent company (DR1).",
    active: false,
    updatedAt: nowIso(),
    documents: [
      { id: "doc-dereg-1", label: "DR1 deregistration form", required: true, daysBeforeDue: 14 },
      { id: "doc-dereg-2", label: "IRD notice of no objection", required: true, daysBeforeDue: 30 },
      {
        id: "doc-dereg-3",
        label: "Written consent from all directors",
        required: true,
        daysBeforeDue: 14,
      },
    ],
    reminders: [{ id: "rem-dereg-1", label: "IRD follow-up", daysBeforeDue: 21, channel: "Email" }],
    riskRules: [
      {
        id: "risk-dereg-1",
        label: "Outstanding tax",
        severity: "High",
        trigger: "IRD clearance not received",
        enabled: true,
      },
    ],
  },
];

const state = initialTemplates;

export function useTemplates(): ChecklistTemplate[] {
  return useSyncExternalStore(
    () => () => {},
    () => state,
    () => state,
  );
}

export function templateForService(serviceType: ServiceType): ChecklistTemplate | undefined {
  return state.find((t) => t.active && t.serviceType === serviceType);
}
