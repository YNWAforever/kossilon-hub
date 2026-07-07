export type EnquiryIntent =
  "Annual Return" | "Incorporation" | "Payment" | "Deregistration" | "KYC" | "General";

export type Enquiry = {
  id: string;
  clientId?: string;
  name: string;
  phone: string;
  intent: EnquiryIntent;
  status: "New" | "In progress" | "Waiting client" | "Converted";
  lastMessage: string;
  lastMessageAt: string;
};

export type ClientCase = {
  id: string;
  companyName: string;
  contactName: string;
  phone: string;
  status: "Preparing" | "Waiting documents" | "Ready to file" | "Filed";
  annualReturnCaseId: string;
  dueDate: string;
  basisDate: string;
  missingDocs: string[];
  paymentStatus: "Paid" | "Pending" | "Overdue";
  checklistTemplateId: string;
};

export type ChecklistTemplate = {
  id: string;
  name: string;
  items: string[];
};

export const enquiries: Enquiry[] = [
  {
    id: "wa-lee",
    clientId: "c-aurora",
    name: "Mandy Lee",
    phone: "+852 9123 4567",
    intent: "Annual Return",
    status: "Converted",
    lastMessage:
      "Hi Kossilon, when is our NAR1 annual return due and what documents are still missing?",
    lastMessageAt: "09:42",
  },
  {
    id: "wa-chan",
    name: "Henry Chan",
    phone: "+852 6333 1188",
    intent: "Incorporation",
    status: "In progress",
    lastMessage:
      "I want to set up a Hong Kong limited company. What are your fees and how long does it take?",
    lastMessageAt: "10:18",
  },
  {
    id: "wa-wong",
    clientId: "c-harbour",
    name: "Gloria Wong",
    phone: "+852 9011 2200",
    intent: "Payment",
    status: "Waiting client",
    lastMessage:
      "Can you remind me how to settle the annual return filing invoice? Is FPS accepted?",
    lastMessageAt: "11:05",
  },
  {
    id: "wa-ng",
    name: "Patrick Ng",
    phone: "+852 6777 9421",
    intent: "Deregistration",
    status: "New",
    lastMessage:
      "Our company has stopped trading. What is the deregistration process and do we need tax clearance?",
    lastMessageAt: "13:27",
  },
];

export const clients: ClientCase[] = [
  {
    id: "c-aurora",
    companyName: "Aurora Trading Limited",
    contactName: "Mandy Lee",
    phone: "+852 9123 4567",
    status: "Waiting documents",
    annualReturnCaseId: "ar-aurora",
    dueDate: "2026-08-12",
    basisDate: "2026-07-15",
    missingDocs: ["Signed NAR1", "Updated significant controller register"],
    paymentStatus: "Pending",
    checklistTemplateId: "tpl-annual-return",
  },
  {
    id: "c-harbour",
    companyName: "Harbour Pixel Studio Limited",
    contactName: "Gloria Wong",
    phone: "+852 9011 2200",
    status: "Ready to file",
    annualReturnCaseId: "ar-harbour",
    dueDate: "2026-07-29",
    basisDate: "2026-07-01",
    missingDocs: [],
    paymentStatus: "Paid",
    checklistTemplateId: "tpl-annual-return",
  },
  {
    id: "c-summit",
    companyName: "Summit Bamboo Holdings Limited",
    contactName: "Thomas Yu",
    phone: "+852 6888 3344",
    status: "Filed",
    annualReturnCaseId: "ar-summit",
    dueDate: "2026-06-20",
    basisDate: "2026-05-23",
    missingDocs: [],
    paymentStatus: "Paid",
    checklistTemplateId: "tpl-annual-return",
  },
];

export const checklistTemplates: ChecklistTemplate[] = [
  {
    id: "tpl-annual-return",
    name: "Annual return filing",
    items: [
      "Confirm company particulars",
      "Collect signed NAR1",
      "Verify significant controller register",
      "Confirm filing fee payment",
      "Submit to Companies Registry",
    ],
  },
  {
    id: "tpl-incorporation",
    name: "Incorporation onboarding",
    items: [
      "Collect director and shareholder IDs",
      "Confirm company name availability",
      "Prepare incorporation form NNC1",
      "Set up registered office and company secretary",
    ],
  },
  {
    id: "tpl-deregistration",
    name: "Deregistration",
    items: [
      "Confirm no outstanding liabilities",
      "Prepare IR1263 tax clearance",
      "Collect board approval",
      "File NDR1 after tax clearance",
    ],
  },
];

export function findClientForEnquiry(enquiry: Enquiry): ClientCase | undefined {
  return clients.find((client) => client.id === enquiry.clientId || client.phone === enquiry.phone);
}

export function findEnquiryForClient(clientId: string): Enquiry | undefined {
  const client = clients.find((candidate) => candidate.id === clientId);
  return enquiries.find(
    (enquiry) => enquiry.clientId === clientId || (client && enquiry.phone === client.phone),
  );
}

export function findClientForAnnualReturnCase(caseId: string): ClientCase | undefined {
  return clients.find((client) => client.annualReturnCaseId === caseId);
}

export function daysUntil(date: string): number {
  const today = new Date();
  const target = new Date(`${date}T00:00:00`);
  return Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
}
