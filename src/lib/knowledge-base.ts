import { useSyncExternalStore } from "react";

export type KnowledgeCategory =
  "Incorporation" | "Annual Return" | "Payments" | "Deregistration" | "General";

export type FaqEntry = {
  id: string;
  question: string;
  answer: string;
  category: KnowledgeCategory;
  tags: string[];
  active: boolean;
};

export type ReferenceDocument = {
  id: string;
  title: string;
  filename: string;
  category: KnowledgeCategory;
  summary: string;
  updatedAt: string;
  active: boolean;
};

type KnowledgeBaseState = {
  faqs: FaqEntry[];
  referenceDocs: ReferenceDocument[];
};

const seedFaqs: FaqEntry[] = [
  {
    id: "faq-nar1-deadline",
    question: "When is the NAR1 annual return due?",
    answer:
      "For a private Hong Kong company, the NAR1 is generally due within 42 days after the anniversary of incorporation. We prepare the filing from the latest company particulars, collect signatures where needed, and submit once the filing fee is settled.",
    category: "Annual Return",
    tags: ["NAR1", "deadline", "annual return"],
    active: true,
  },
  {
    id: "faq-nar1-penalty",
    question: "What happens if an annual return is late?",
    answer:
      "Late annual returns can attract higher registration fees and potential prosecution risk. The safest next step is to confirm the anniversary date, prepare the NAR1 immediately, and file as soon as the company records are complete.",
    category: "Annual Return",
    tags: ["late", "penalty", "Companies Registry"],
    active: true,
  },
  {
    id: "faq-inc-fees",
    question: "What are your Hong Kong incorporation fees?",
    answer:
      "Our incorporation package can include company secretary, registered office, incorporation filing, company kit, and first-year compliance setup. Final pricing depends on whether nominee, bank support, or expedited handling is needed.",
    category: "Incorporation",
    tags: ["fees", "incorporation", "quote"],
    active: true,
  },
  {
    id: "faq-inc-timeline",
    question: "How long does incorporation take?",
    answer:
      "A standard Hong Kong limited company setup is usually ready within 1-3 working days after KYC documents, company name, director/shareholder details, and payment are complete.",
    category: "Incorporation",
    tags: ["timeline", "setup", "KYC"],
    active: true,
  },
  {
    id: "faq-kyc-docs",
    question: "What KYC documents are required?",
    answer:
      "We normally request identification, residential address proof, contact details, and ownership/control information for directors, shareholders, and ultimate beneficial owners.",
    category: "General",
    tags: ["KYC", "documents", "onboarding"],
    active: true,
  },
  {
    id: "faq-payment-methods",
    question: "Which payment methods are accepted?",
    answer:
      "Clients may settle invoices by FPS, bank transfer, or cheque. Please include the company name or invoice number in the payment reference so our team can match the receipt quickly.",
    category: "Payments",
    tags: ["FPS", "bank transfer", "invoice"],
    active: true,
  },
  {
    id: "faq-payment-receipt",
    question: "How do I confirm payment?",
    answer:
      "After payment, send us the transfer slip or FPS confirmation screenshot. We will mark the invoice as received and continue the filing or service workflow.",
    category: "Payments",
    tags: ["receipt", "confirmation", "invoice"],
    active: true,
  },
  {
    id: "faq-share-transfer",
    question: "Can Kossilon help with share transfer?",
    answer:
      "Yes. We can prepare share transfer instruments, board minutes, bought and sold notes, and stamp duty submission materials once the transfer terms and parties are confirmed.",
    category: "General",
    tags: ["share transfer", "stamp duty", "board minutes"],
    active: true,
  },
  {
    id: "faq-dereg-start",
    question: "What is needed to deregister a Hong Kong company?",
    answer:
      "The company should have no outstanding liabilities, no ongoing business, and no unresolved tax matters. We usually start with tax clearance, then prepare the Companies Registry deregistration filing.",
    category: "Deregistration",
    tags: ["deregistration", "tax clearance", "NDR1"],
    active: true,
  },
  {
    id: "faq-dereg-timeline",
    question: "How long does deregistration take?",
    answer:
      "Deregistration commonly takes several months because Inland Revenue tax clearance is required before the Companies Registry step can complete.",
    category: "Deregistration",
    tags: ["timeline", "tax", "close company"],
    active: true,
  },
  {
    id: "faq-registered-office",
    question: "Do we need a Hong Kong registered office?",
    answer:
      "A Hong Kong company must maintain a local registered office address and a company secretary. Kossilon can provide both as part of an annual compliance package.",
    category: "General",
    tags: ["registered office", "company secretary"],
    active: true,
  },
  {
    id: "faq-turnaround",
    question: "What is the usual turnaround time for compliance requests?",
    answer:
      "Simple document updates are often handled within 1-2 working days after complete information is received. Registry filings may take longer depending on signatures, payment, and official processing.",
    category: "General",
    tags: ["turnaround", "SOP", "processing"],
    active: true,
  },
];

const seedReferenceDocs: ReferenceDocument[] = [
  {
    id: "doc-fee-2026",
    title: "Fee schedule 2026",
    filename: "kossilon-fee-schedule-2026.pdf",
    category: "Payments",
    summary:
      "Current service packages, government disbursements, payment methods, and expedited handling notes.",
    updatedAt: "2026-01-05",
    active: true,
  },
  {
    id: "doc-sop",
    title: "HK CoSec SOP",
    filename: "hk-cosec-operating-sop.docx",
    category: "General",
    summary:
      "Internal service levels, handoff rules, escalation steps, and standard client messaging.",
    updatedAt: "2026-02-14",
    active: true,
  },
  {
    id: "doc-nar1",
    title: "NAR1 filing guide",
    filename: "nar1-filing-guide-2026.pdf",
    category: "Annual Return",
    summary:
      "Annual return workflow, due date calculation, signing checks, and Companies Registry filing sequence.",
    updatedAt: "2026-03-02",
    active: true,
  },
  {
    id: "doc-kyc",
    title: "KYC checklist",
    filename: "client-kyc-checklist.xlsx",
    category: "General",
    summary:
      "Identity, address, ownership, and control evidence required for new and existing clients.",
    updatedAt: "2026-04-22",
    active: true,
  },
  {
    id: "doc-payment",
    title: "Payment terms",
    filename: "payment-terms-and-receipts.pdf",
    category: "Payments",
    summary:
      "FPS and bank transfer instructions, receipt matching, invoice references, and overdue handling.",
    updatedAt: "2026-05-11",
    active: true,
  },
  {
    id: "doc-dereg",
    title: "Deregistration playbook",
    filename: "deregistration-playbook.pdf",
    category: "Deregistration",
    summary:
      "Tax clearance, no-liability confirmation, board approval, NDR1 filing, and client status updates.",
    updatedAt: "2026-06-08",
    active: true,
  },
];

let state: KnowledgeBaseState = {
  faqs: seedFaqs,
  referenceDocs: seedReferenceDocs,
};

const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): KnowledgeBaseState {
  return state;
}

export function useKnowledgeBase(): KnowledgeBaseState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useFaqs(): FaqEntry[] {
  return useKnowledgeBase().faqs;
}

export function useReferenceDocs(): ReferenceDocument[] {
  return useKnowledgeBase().referenceDocs;
}

export function addFaq(): void {
  const id = `faq-${Date.now()}`;
  state = {
    ...state,
    faqs: [
      {
        id,
        question: "New FAQ question",
        answer: "Draft the answer staff should use for this scenario.",
        category: "General",
        tags: ["new"],
        active: true,
      },
      ...state.faqs,
    ],
  };
  emit();
}

export function updateFaq(id: string, patch: Partial<FaqEntry>): void {
  state = {
    ...state,
    faqs: state.faqs.map((faq) => (faq.id === id ? { ...faq, ...patch } : faq)),
  };
  emit();
}

export function duplicateFaq(id: string): void {
  const faq = state.faqs.find((entry) => entry.id === id);
  if (!faq) return;
  state = {
    ...state,
    faqs: [{ ...faq, id: `faq-${Date.now()}`, question: `${faq.question} copy` }, ...state.faqs],
  };
  emit();
}

export function deleteFaq(id: string): void {
  state = { ...state, faqs: state.faqs.filter((faq) => faq.id !== id) };
  emit();
}

export function addReferenceDoc(): void {
  const sequence = state.referenceDocs.length + 1;
  state = {
    ...state,
    referenceDocs: [
      {
        id: `doc-${Date.now()}`,
        title: `Simulated upload ${sequence}`,
        filename: `mock-reference-${sequence}.pdf`,
        category: "General",
        summary: "New mock reference document for AI retrieval demos.",
        updatedAt: new Date().toISOString().slice(0, 10),
        active: true,
      },
      ...state.referenceDocs,
    ],
  };
  emit();
}

export function updateReferenceDoc(id: string, patch: Partial<ReferenceDocument>): void {
  state = {
    ...state,
    referenceDocs: state.referenceDocs.map((doc) => (doc.id === id ? { ...doc, ...patch } : doc)),
  };
  emit();
}

export function deleteReferenceDoc(id: string): void {
  state = { ...state, referenceDocs: state.referenceDocs.filter((doc) => doc.id !== id) };
  emit();
}
