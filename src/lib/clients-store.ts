// Client-side store for clients added via the "Convert to client" flow.
// Merges with the seed `companies` array from mock-data for read paths.
import { useSyncExternalStore } from "react";
import {
  companies as seedCompanies,
  teamMembers,
  type Company,
  type Enquiry,
  type TimelineEvent,
} from "@/lib/mock-data";

type ConversionState = {
  added: Company[];
  // enquiryId -> companyId
  conversions: Record<string, string>;
};

const state: ConversionState = { added: [], conversions: {} };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

const nowIso = () => new Date("2026-07-04T09:00:00+08:00").toISOString();
const rid = () => Math.random().toString(36).slice(2, 8);

export type ConvertFormData = {
  companyName: string;
  brNumber: string;
  crNumber: string;
  package: Company["package"];
  ownerId: string;
  address: string;
  serviceType: string;
  note?: string;
};

export function convertEnquiry(enquiry: Enquiry, form: ConvertFormData): Company {
  const owner = teamMembers.find((t) => t.id === form.ownerId) ?? teamMembers[0];
  const id = `c-new-${rid()}`;

  const timeline: TimelineEvent[] = [
    {
      id: `${id}-t1`,
      at: nowIso(),
      kind: "status",
      actor: "System",
      text: `Client onboarded from WhatsApp enquiry with ${enquiry.contactName} (${enquiry.phone})`,
    },
    {
      id: `${id}-t2`,
      at: nowIso(),
      kind: "note",
      actor: owner.name,
      text: `Assigned as owner. Service requested: ${form.serviceType}.`,
    },
    {
      id: `${id}-t3`,
      at: nowIso(),
      kind: "message",
      actor: "Client",
      text: `Original enquiry: "${enquiry.lastMessage}"`,
    },
    ...(form.note
      ? [
          {
            id: `${id}-t4`,
            at: nowIso(),
            kind: "note" as const,
            actor: owner.name,
            text: form.note,
          },
        ]
      : []),
  ];

  const company: Company = {
    id,
    name: form.companyName,
    brNumber: form.brNumber || "—",
    crNumber: form.crNumber || "—",
    incorporated: nowIso(),
    package: form.package,
    ownerId: owner.id,
    team: owner.team,
    contacts: [
      {
        name: enquiry.contactName,
        role: "Primary contact",
        email: `${enquiry.contactName.toLowerCase().replace(/[^a-z]+/g, ".")}@example.hk`,
        phone: enquiry.phone,
      },
    ],
    address: form.address || "Address to be confirmed",
    arDueDate: new Date(new Date(nowIso()).getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    paymentStatus: "Pending",
    invoiceAmount: form.package === "Basic" ? 2800 : form.package === "Standard" ? 3800 : 5200,
    timeline,
  };

  state.added = [company, ...state.added];
  state.conversions = { ...state.conversions, [enquiry.id]: id };
  emit();
  return company;
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSnapshot = () => state;

export function useAllCompanies(): Company[] {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return [...s.added, ...seedCompanies];
}

export function useCompanyById(id: string): Company | undefined {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return s.added.find((c) => c.id === id) ?? seedCompanies.find((c) => c.id === id);
}

export function useEnquiryConversion(enquiryId: string): string | undefined {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return s.conversions[enquiryId];
}

export function useEnquiryIdForCompany(companyId: string): string | undefined {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return Object.entries(s.conversions).find(([, cid]) => cid === companyId)?.[0];
}
