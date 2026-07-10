// Knowledge base store for FAQs and reference documents used by the mocked AI agent.
import { useSyncExternalStore } from "react";

export type FaqCategory =
  "Incorporation" | "Annual Return" | "Payments" | "Deregistration" | "General";

export const FAQ_CATEGORIES: FaqCategory[] = [
  "Incorporation",
  "Annual Return",
  "Payments",
  "Deregistration",
  "General",
];

export type FaqEntry = {
  id: string;
  question: string;
  answer: string; // markdown
  category: FaqCategory;
  tags: string[];
  active: boolean;
  updatedAt: string;
};

export type ReferenceDoc = {
  id: string;
  title: string;
  filename: string;
  category: FaqCategory;
  summary: string;
  updatedAt: string;
  active: boolean;
  sizeKb: number;
  mime?: string;
  pageCount?: number;
  // Real extracted content — present when the doc was uploaded (not seeded).
  extractedText?: string;
  chunks?: string[];
  indexedAt?: string;
};

const nowIso = () => new Date("2026-07-04T09:00:00+08:00").toISOString();
const rid = () => Math.random().toString(36).slice(2, 10);

const seedFaqs: FaqEntry[] = [
  {
    id: "faq-fees",
    question: "What are your fees for annual return filing?",
    answer:
      "Our **Annual Return** filing fees are:\n\n- **Basic** — HKD 2,800 (filing only)\n- **Standard** — HKD 3,800 (filing + 1 change)\n- **Premium** — HKD 5,200 (full-service + advisory)\n\nGovernment fee HKD 105 is billed separately.",
    category: "Payments",
    tags: ["fees", "annual return", "pricing", "package"],
    active: true,
    updatedAt: nowIso(),
  },
  {
    id: "faq-nar1-timing",
    question: "When must the NAR1 be filed?",
    answer:
      "The NAR1 must be filed within **42 days after the anniversary of incorporation**. Late filing triggers escalating penalties from HKD 870 up to HKD 3,480.",
    category: "Annual Return",
    tags: ["NAR1", "deadline", "42 days", "penalty"],
    active: true,
    updatedAt: nowIso(),
  },
  {
    id: "faq-ar-docs",
    question: "What documents do you need to file our annual return?",
    answer:
      "We need:\n\n1. Signed **NAR1** form\n2. Updated **register of members**\n3. Register of **directors** and **secretaries**\n4. Copy of your **BR certificate**\n5. Proof of registered office address\n6. ID copies of all directors\n\nWe'll send a WhatsApp checklist so you can upload each file.",
    category: "Annual Return",
    tags: ["documents", "checklist", "nar1", "kyc"],
    active: true,
    updatedAt: nowIso(),
  },
  {
    id: "faq-incorp",
    question: "How much does it cost to open a HK Limited company?",
    answer:
      "Our incorporation package is **HKD 4,800** all-in and includes:\n\n- NNC1 filing with Companies Registry\n- Business Registration certificate (1 year)\n- Company kit (chop, common seal, share certificates)\n- Registered office for 3 months\n\nTurnaround is **2–3 working days** once we have KYC docs.",
    category: "Incorporation",
    tags: ["incorporation", "cost", "hk ltd", "new company"],
    active: true,
    updatedAt: nowIso(),
  },
  {
    id: "faq-incorp-docs",
    question: "What do you need to incorporate a new company?",
    answer:
      "For each director and shareholder we need:\n\n- HKID or passport copy\n- Proof of residential address (within 3 months)\n- Proposed company name (English + Chinese optional)\n\nWe'll draft the **NNC1**, **Articles of Association**, and **IRBR1** for signature.",
    category: "Incorporation",
    tags: ["kyc", "documents", "incorporation"],
    active: true,
    updatedAt: nowIso(),
  },
  {
    id: "faq-change-director",
    question: "How do I change a director?",
    answer:
      "You must notify the Companies Registry within **15 days** of the change by filing **ND2A** (appointment) or **ND2B** (cessation). We charge HKD 1,200 per change and turnaround is 1–2 working days.",
    category: "General",
    tags: ["director", "change", "nd2a", "nd2b"],
    active: true,
    updatedAt: nowIso(),
  },
  {
    id: "faq-dereg",
    question: "How do I deregister a dormant company?",
    answer:
      "Voluntary deregistration requires:\n\n1. **IRD Notice of No Objection** (takes ~4 weeks)\n2. **DR1** form with written consent from all directors\n3. Company must be solvent and inactive\n\nOur fee: HKD 3,800 (excl. HKD 420 gov fee). Full process takes **6–9 months**.",
    category: "Deregistration",
    tags: ["deregistration", "dr1", "ird", "dormant"],
    active: true,
    updatedAt: nowIso(),
  },
  {
    id: "faq-payment-methods",
    question: "How can I pay the invoice?",
    answer:
      "We accept:\n\n- **FPS** (fastest, free)\n- **Bank transfer** (HSBC, HKD account)\n- **Credit card** via Stripe link (+2.9% surcharge)\n\nInvoices are payable within **14 days**.",
    category: "Payments",
    tags: ["payment", "fps", "bank", "invoice", "credit card"],
    active: true,
    updatedAt: nowIso(),
  },
  {
    id: "faq-share-transfer",
    question: "Is stamp duty required for share transfer?",
    answer:
      "Yes — HK charges **0.2%** stamp duty on the higher of consideration or net asset value, split between buyer and seller. We prepare Bought & Sold Notes and Contract Note for HKD 2,500.",
    category: "General",
    tags: ["share transfer", "stamp duty", "ird"],
    active: true,
    updatedAt: nowIso(),
  },
  {
    id: "faq-registered-office",
    question: "Do you provide a registered office address?",
    answer:
      "Yes. Our Central office can be used as your **registered address** for HKD 2,400/year, including mail scanning and forwarding.",
    category: "General",
    tags: ["registered office", "address", "mail"],
    active: true,
    updatedAt: nowIso(),
  },
  {
    id: "faq-nominee",
    question: "Do you provide nominee director services?",
    answer:
      "We do **not** offer nominee director services — they carry compliance risk under HK's SCR requirements. We can introduce you to a licensed TCSP partner if needed.",
    category: "General",
    tags: ["nominee", "director", "scr", "compliance"],
    active: true,
    updatedAt: nowIso(),
  },
  {
    id: "faq-turnaround",
    question: "How long does annual return filing take?",
    answer:
      "Once we receive all signed documents, filing with the Companies Registry takes **1 working day**. We'll confirm via WhatsApp with the stamped NAR1 receipt.",
    category: "Annual Return",
    tags: ["turnaround", "annual return", "filing"],
    active: true,
    updatedAt: nowIso(),
  },
];

const seedDocs: ReferenceDoc[] = [
  {
    id: "doc-fees-2026",
    title: "Kossilon Fee Schedule 2026",
    filename: "kossilon-fees-2026.pdf",
    category: "Payments",
    summary: "All service packages, government fees, and add-on charges effective January 2026.",
    updatedAt: nowIso(),
    active: true,
    sizeKb: 218,
  },
  {
    id: "doc-sop",
    title: "HK Company Secretary SOP",
    filename: "cosec-sop-v3.pdf",
    category: "General",
    summary:
      "Internal standard operating procedures for onboarding, annual filings, and client communication.",
    updatedAt: nowIso(),
    active: true,
    sizeKb: 812,
  },
  {
    id: "doc-nar1-guide",
    title: "NAR1 Filing Guide",
    filename: "nar1-filing-guide.pdf",
    category: "Annual Return",
    summary:
      "Step-by-step walkthrough of preparing and filing the NAR1 form with the Companies Registry.",
    updatedAt: nowIso(),
    active: true,
    sizeKb: 356,
  },
  {
    id: "doc-kyc",
    title: "KYC Document Checklist",
    filename: "kyc-checklist.pdf",
    category: "Incorporation",
    summary:
      "Complete list of KYC documents required per director and shareholder for HK incorporations.",
    updatedAt: nowIso(),
    active: true,
    sizeKb: 92,
  },
  {
    id: "doc-payment-terms",
    title: "Payment Terms & Conditions",
    filename: "payment-terms.pdf",
    category: "Payments",
    summary: "Invoice terms, accepted payment methods, late-payment policy, and refund conditions.",
    updatedAt: nowIso(),
    active: true,
    sizeKb: 145,
  },
  {
    id: "doc-dereg-play",
    title: "Deregistration Playbook",
    filename: "deregistration-playbook.pdf",
    category: "Deregistration",
    summary:
      "End-to-end playbook covering IRD clearance, DR1 preparation, and 6-month wait period.",
    updatedAt: nowIso(),
    active: true,
    sizeKb: 274,
  },
];

// ---------- store ----------
type State = { faqs: FaqEntry[]; docs: ReferenceDoc[] };

const STORAGE_KEY = "kossilon.kb.v1";

function loadPersisted(): Partial<State> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<State>;
  } catch {
    return {};
  }
}

const persisted = loadPersisted();
const state: State = {
  faqs: persisted.faqs ?? seedFaqs,
  docs: persisted.docs ?? seedDocs,
};

const listeners = new Set<() => void>();
const emit = () => {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* quota — ignore */
    }
  }
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSnapshot = () => state;
const touch = () => new Date().toISOString();

export const kbStore = {
  get: () => state,

  // ----- FAQs -----
  addFaq: () => {
    const f: FaqEntry = {
      id: `faq-${rid()}`,
      question: "New question",
      answer: "New answer…",
      category: "General",
      tags: [],
      active: true,
      updatedAt: touch(),
    };
    state.faqs = [f, ...state.faqs];
    emit();
    return f.id;
  },
  updateFaq: (id: string, patch: Partial<FaqEntry>) => {
    state.faqs = state.faqs.map((f) => (f.id === id ? { ...f, ...patch, updatedAt: touch() } : f));
    emit();
  },
  duplicateFaq: (id: string) => {
    const src = state.faqs.find((f) => f.id === id);
    if (!src) return;
    state.faqs = [
      { ...src, id: `faq-${rid()}`, question: `${src.question} (copy)`, updatedAt: touch() },
      ...state.faqs,
    ];
    emit();
  },
  removeFaq: (id: string) => {
    state.faqs = state.faqs.filter((f) => f.id !== id);
    emit();
  },
  importFaqs: (rows: Array<Partial<FaqEntry> & { question: string; answer: string }>) => {
    const now = touch();
    const existing = new Map(state.faqs.map((f) => [f.question.trim().toLowerCase(), f]));
    let added = 0;
    let updated = 0;
    for (const r of rows) {
      const key = r.question.trim().toLowerCase();
      const cat = (FAQ_CATEGORIES as string[]).includes(r.category as string)
        ? (r.category as FaqCategory)
        : "General";
      const tags = Array.isArray(r.tags)
        ? r.tags
            .map(String)
            .map((t) => t.trim())
            .filter(Boolean)
        : [];
      const active = r.active === undefined ? true : Boolean(r.active);
      const dup = existing.get(key);
      if (dup) {
        Object.assign(dup, {
          answer: r.answer,
          category: cat,
          tags: tags.length ? tags : dup.tags,
          active,
          updatedAt: now,
        });
        updated++;
      } else {
        const f: FaqEntry = {
          id: `faq-${rid()}`,
          question: r.question.trim(),
          answer: r.answer,
          category: cat,
          tags,
          active,
          updatedAt: now,
        };
        state.faqs = [f, ...state.faqs];
        existing.set(key, f);
        added++;
      }
    }
    emit();
    return { added, updated };
  },

  // ----- Documents -----
  addDoc: (partial?: Partial<ReferenceDoc>) => {
    const d: ReferenceDoc = {
      id: `doc-${rid()}`,
      title: partial?.title ?? "New reference document",
      filename: partial?.filename ?? `reference-${rid()}.pdf`,
      category: partial?.category ?? "General",
      summary: partial?.summary ?? "Add a short summary the AI can cite…",
      updatedAt: touch(),
      active: true,
      sizeKb: partial?.sizeKb ?? Math.floor(50 + Math.random() * 500),
    };
    state.docs = [d, ...state.docs];
    emit();
    return d.id;
  },
  updateDoc: (id: string, patch: Partial<ReferenceDoc>) => {
    state.docs = state.docs.map((d) => (d.id === id ? { ...d, ...patch, updatedAt: touch() } : d));
    emit();
  },
  removeDoc: (id: string) => {
    state.docs = state.docs.filter((d) => d.id !== id);
    emit();
  },
  uploadDoc: async (file: File, opts?: { category?: FaqCategory; title?: string }) => {
    const { parseFile } = await import("@/lib/doc-parser");
    const parsed = await parseFile(file);
    const now = touch();
    const d: ReferenceDoc = {
      id: `doc-${rid()}`,
      title: opts?.title ?? file.name.replace(/\.[^.]+$/, ""),
      filename: file.name,
      category: opts?.category ?? "General",
      summary: parsed.summary,
      updatedAt: now,
      active: true,
      sizeKb: Math.max(1, Math.round(file.size / 1024)),
      mime: file.type || undefined,
      pageCount: parsed.pageCount,
      extractedText: parsed.text,
      chunks: parsed.chunks,
      indexedAt: now,
    };
    state.docs = [d, ...state.docs];
    emit();
    return d.id;
  },
};

export function useFaqs(): FaqEntry[] {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return s.faqs;
}
export function useReferenceDocs(): ReferenceDoc[] {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return s.docs;
}

export function useKnowledgeBase() {
  return {
    faqs: useFaqs(),
    referenceDocs: useReferenceDocs(),
  };
}

export function filterFaqEntries(
  faqs: FaqEntry[],
  query: string,
  category: FaqCategory | "All" = "All",
): FaqEntry[] {
  const normalizedQuery = query.trim().toLowerCase();

  return faqs.filter(
    (faq) =>
      (category === "All" || faq.category === category) &&
      (normalizedQuery === "" ||
        faq.question.toLowerCase().includes(normalizedQuery) ||
        faq.answer.toLowerCase().includes(normalizedQuery) ||
        faq.tags.some((tag) => tag.toLowerCase().includes(normalizedQuery))),
  );
}

// Non-hook accessors for the AI agent module (deterministic, no re-render tie).
export const getActiveFaqs = () => state.faqs.filter((f) => f.active);
export const getActiveDocs = () => state.docs.filter((d) => d.active);
