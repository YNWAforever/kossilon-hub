// Checklist template store for Kossilon CoSec OS (in-memory, client-only).
import { useSyncExternalStore } from "react";

export type ServiceType =
  | "Annual Return — Private Ltd"
  | "Annual Return — Public Ltd"
  | "Incorporation — HK Ltd"
  | "Change of Director"
  | "Deregistration";

export type DocumentItem = {
  id: string;
  label: string;
  required: boolean;
  daysBeforeDue: number; // when this doc is expected relative to case due date
  note?: string;
};

export type ReminderRule = {
  id: string;
  label: string;
  daysBeforeDue: number; // e.g. 30 -> send 30 days before due
  channel: "WhatsApp" | "Email" | "SMS";
};

export type RiskRule = {
  id: string;
  label: string;
  severity: "Low" | "Medium" | "High";
  trigger: string; // human-readable
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

const rid = () => Math.random().toString(36).slice(2, 10);
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
      { id: rid(), label: "Signed NAR1 form", required: true, daysBeforeDue: 7 },
      { id: rid(), label: "Register of members (updated)", required: true, daysBeforeDue: 14 },
      { id: rid(), label: "Register of directors", required: true, daysBeforeDue: 14 },
      { id: rid(), label: "Register of secretaries", required: true, daysBeforeDue: 14 },
      { id: rid(), label: "Business registration certificate copy", required: true, daysBeforeDue: 30 },
      { id: rid(), label: "Proof of registered office address", required: true, daysBeforeDue: 30 },
      { id: rid(), label: "ID copies of all directors", required: true, daysBeforeDue: 30 },
    ],
    reminders: [
      { id: rid(), label: "First reminder", daysBeforeDue: 30, channel: "WhatsApp" },
      { id: rid(), label: "Second reminder", daysBeforeDue: 14, channel: "WhatsApp" },
      { id: rid(), label: "Third reminder", daysBeforeDue: 7, channel: "WhatsApp" },
      { id: rid(), label: "Final reminder", daysBeforeDue: 2, channel: "WhatsApp" },
    ],
    riskRules: [
      { id: rid(), label: "Deadline critical", severity: "High", trigger: "Deadline < 3 days & docs incomplete", enabled: true },
      { id: rid(), label: "Client silent", severity: "Medium", trigger: "No client reply after 3 reminders", enabled: true },
      { id: rid(), label: "Payment overdue", severity: "Medium", trigger: "Invoice unpaid > 14 days", enabled: true },
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
      { id: rid(), label: "Signed NAR1 form", required: true, daysBeforeDue: 7 },
      { id: rid(), label: "Audited financial statements", required: true, daysBeforeDue: 21 },
      { id: rid(), label: "Auditor's report", required: true, daysBeforeDue: 21 },
      { id: rid(), label: "Register of members", required: true, daysBeforeDue: 14 },
      { id: rid(), label: "Register of directors", required: true, daysBeforeDue: 14 },
      { id: rid(), label: "Directors' report", required: true, daysBeforeDue: 14 },
    ],
    reminders: [
      { id: rid(), label: "First reminder", daysBeforeDue: 45, channel: "Email" },
      { id: rid(), label: "Second reminder", daysBeforeDue: 21, channel: "WhatsApp" },
      { id: rid(), label: "Final reminder", daysBeforeDue: 7, channel: "WhatsApp" },
    ],
    riskRules: [
      { id: rid(), label: "Auditor delay", severity: "High", trigger: "Audit report outstanding < 21 days to due", enabled: true },
      { id: rid(), label: "Deadline critical", severity: "High", trigger: "Deadline < 3 days & docs incomplete", enabled: true },
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
      { id: rid(), label: "NNC1 incorporation form", required: true, daysBeforeDue: 3 },
      { id: rid(), label: "Articles of association", required: true, daysBeforeDue: 3 },
      { id: rid(), label: "IRBR1 business registration notice", required: true, daysBeforeDue: 3 },
      { id: rid(), label: "ID / passport of each director & shareholder", required: true, daysBeforeDue: 5 },
      { id: rid(), label: "Proof of address for each director", required: true, daysBeforeDue: 5 },
    ],
    reminders: [
      { id: rid(), label: "Docs kick-off", daysBeforeDue: 7, channel: "WhatsApp" },
      { id: rid(), label: "Signature reminder", daysBeforeDue: 2, channel: "WhatsApp" },
    ],
    riskRules: [
      { id: rid(), label: "KYC incomplete", severity: "High", trigger: "Missing director ID > 3 days", enabled: true },
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
      { id: rid(), label: "ND2A / ND2B form", required: true, daysBeforeDue: 5 },
      { id: rid(), label: "Board resolution", required: true, daysBeforeDue: 5 },
      { id: rid(), label: "Consent to act as director", required: true, daysBeforeDue: 5 },
      { id: rid(), label: "New director ID copy", required: true, daysBeforeDue: 5 },
    ],
    reminders: [
      { id: rid(), label: "Docs reminder", daysBeforeDue: 7, channel: "WhatsApp" },
    ],
    riskRules: [
      { id: rid(), label: "Statutory 15-day window", severity: "High", trigger: "Filing not submitted within 15 days of change", enabled: true },
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
      { id: rid(), label: "DR1 deregistration form", required: true, daysBeforeDue: 14 },
      { id: rid(), label: "IRD notice of no objection", required: true, daysBeforeDue: 30 },
      { id: rid(), label: "Written consent from all directors", required: true, daysBeforeDue: 14 },
    ],
    reminders: [
      { id: rid(), label: "IRD follow-up", daysBeforeDue: 21, channel: "Email" },
    ],
    riskRules: [
      { id: rid(), label: "Outstanding tax", severity: "High", trigger: "IRD clearance not received", enabled: true },
    ],
  },
];

// ---------- store ----------
let state: ChecklistTemplate[] = initialTemplates;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const touch = (t: ChecklistTemplate): ChecklistTemplate => ({ ...t, updatedAt: nowIso() });

export const templatesStore = {
  get: () => state,
  subscribe: (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  update: (id: string, patch: Partial<ChecklistTemplate>) => {
    state = state.map((t) => (t.id === id ? touch({ ...t, ...patch }) : t));
    emit();
  },
  create: (serviceType: ServiceType = "Annual Return — Private Ltd") => {
    const t: ChecklistTemplate = {
      id: `tpl-${rid()}`,
      name: "Untitled template",
      serviceType,
      description: "",
      active: true,
      updatedAt: nowIso(),
      documents: [],
      reminders: [],
      riskRules: [],
    };
    state = [t, ...state];
    emit();
    return t.id;
  },
  duplicate: (id: string) => {
    const src = state.find((t) => t.id === id);
    if (!src) return;
    const copy: ChecklistTemplate = {
      ...src,
      id: `tpl-${rid()}`,
      name: `${src.name} (copy)`,
      updatedAt: nowIso(),
      documents: src.documents.map((d) => ({ ...d, id: rid() })),
      reminders: src.reminders.map((r) => ({ ...r, id: rid() })),
      riskRules: src.riskRules.map((r) => ({ ...r, id: rid() })),
    };
    state = [copy, ...state];
    emit();
    return copy.id;
  },
  remove: (id: string) => {
    state = state.filter((t) => t.id !== id);
    emit();
  },
  addDocument: (id: string) =>
    templatesStore.update(id, {
      documents: [
        ...(state.find((t) => t.id === id)?.documents ?? []),
        { id: rid(), label: "New document", required: true, daysBeforeDue: 14 },
      ],
    }),
  updateDocument: (id: string, docId: string, patch: Partial<DocumentItem>) => {
    const t = state.find((t) => t.id === id);
    if (!t) return;
    templatesStore.update(id, {
      documents: t.documents.map((d) => (d.id === docId ? { ...d, ...patch } : d)),
    });
  },
  removeDocument: (id: string, docId: string) => {
    const t = state.find((t) => t.id === id);
    if (!t) return;
    templatesStore.update(id, { documents: t.documents.filter((d) => d.id !== docId) });
  },
  addReminder: (id: string) =>
    templatesStore.update(id, {
      reminders: [
        ...(state.find((t) => t.id === id)?.reminders ?? []),
        { id: rid(), label: "New reminder", daysBeforeDue: 7, channel: "WhatsApp" },
      ],
    }),
  updateReminder: (id: string, rId: string, patch: Partial<ReminderRule>) => {
    const t = state.find((t) => t.id === id);
    if (!t) return;
    templatesStore.update(id, {
      reminders: t.reminders.map((r) => (r.id === rId ? { ...r, ...patch } : r)),
    });
  },
  removeReminder: (id: string, rId: string) => {
    const t = state.find((t) => t.id === id);
    if (!t) return;
    templatesStore.update(id, { reminders: t.reminders.filter((r) => r.id !== rId) });
  },
  addRisk: (id: string) =>
    templatesStore.update(id, {
      riskRules: [
        ...(state.find((t) => t.id === id)?.riskRules ?? []),
        { id: rid(), label: "New risk rule", severity: "Medium", trigger: "Describe the trigger…", enabled: true },
      ],
    }),
  updateRisk: (id: string, rId: string, patch: Partial<RiskRule>) => {
    const t = state.find((t) => t.id === id);
    if (!t) return;
    templatesStore.update(id, {
      riskRules: t.riskRules.map((r) => (r.id === rId ? { ...r, ...patch } : r)),
    });
  },
  removeRisk: (id: string, rId: string) => {
    const t = state.find((t) => t.id === id);
    if (!t) return;
    templatesStore.update(id, { riskRules: t.riskRules.filter((r) => r.id !== rId) });
  },
};

export function useTemplates(): ChecklistTemplate[] {
  return useSyncExternalStore(
    templatesStore.subscribe,
    templatesStore.get,
    templatesStore.get,
  );
}

// Map a service type to the active template that would preload a new case.
export function templateForService(serviceType: ServiceType): ChecklistTemplate | undefined {
  return templatesStore.get().find((t) => t.active && t.serviceType === serviceType);
}

export const SERVICE_TYPES: ServiceType[] = [
  "Annual Return — Private Ltd",
  "Annual Return — Public Ltd",
  "Incorporation — HK Ltd",
  "Change of Director",
  "Deregistration",
];
