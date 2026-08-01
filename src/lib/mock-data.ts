// Mock data for Kossilon Company Secretary OS. Deterministic seeds.

export type Role = "Admin" | "Manager" | "Staff";

export type TeamMember = {
  id: string;
  name: string;
  initials: string;
  role: Role;
  team: string;
  email: string;
  clientsOwned: number;
};

export type CaseStatus =
  | "Upcoming"
  | "Reminder Sent"
  | "Documents Pending"
  | "Documents Received"
  | "Payment Pending"
  | "Payment Received"
  | "NAR1 Prepared"
  | "Signature Pending"
  | "Ready to File"
  | "Filed"
  | "Completed";

export const CASE_STATUSES: CaseStatus[] = [
  "Upcoming",
  "Reminder Sent",
  "Documents Pending",
  "Documents Received",
  "Payment Pending",
  "Payment Received",
  "NAR1 Prepared",
  "Signature Pending",
  "Ready to File",
  "Filed",
  "Completed",
];

export type TimelineEvent = {
  id: string;
  at: string; // ISO
  kind: "status" | "message" | "document" | "payment" | "note" | "reminder";
  actor: string;
  text: string;
};

export type Contact = {
  name: string;
  role: string;
  email: string;
  phone: string;
};

export type ChecklistItem = {
  id: string;
  label: string;
  received: boolean;
  requiredBy?: string;
  file?: string;
  note?: string;
};

export type Company = {
  id: string;
  name: string;
  brNumber: string;
  crNumber: string;
  incorporated: string;
  package: "Basic" | "Standard" | "Premium";
  ownerId: string; // TeamMember id
  team: string;
  contacts: Contact[];
  address: string;
  arDueDate: string; // ISO
  paymentStatus: "Paid" | "Pending" | "Overdue";
  invoiceAmount: number;
  timeline: TimelineEvent[];
};

export type AnnualReturnCase = {
  id: string;
  companyId: string;
  companyName: string;
  status: CaseStatus;
  dueDate: string; // ISO
  ownerId: string;
  ownerName: string;
  nextAction: string;
  checklist: ChecklistItem[];
  remindersSent: number;
  notes: { at: string; author: string; text: string }[];
};

export type EnquiryIntent =
  | "New Incorporation"
  | "Annual Return"
  | "Change of Director"
  | "Deregistration"
  | "General Question"
  | "Payment Query";

export type Enquiry = {
  id: string;
  contactName: string;
  phone: string;
  lastMessage: string;
  lastMessageAt: string;
  intent: EnquiryIntent;
  intentConfidence: number;
  quoteStatus: "None" | "Draft" | "Sent" | "Accepted" | "Declined";
  assignedTo?: string;
  unread: number;
  messages: { from: "client" | "staff" | "bot"; text: string; at: string }[];
};

export type Task = {
  id: string;
  title: string;
  companyName: string;
  dueDate: string;
  priority: "Low" | "Normal" | "High";
  assigneeId: string;
  done: boolean;
};

export type Team = {
  id: string;
  name: string;
  lead: string;
  memberIds: string[];
  clientCount: number;
};

// ---------- seeds ----------

const today = new Date("2026-07-04T09:00:00+08:00");
const iso = (daysFromToday: number, hours = 9) => {
  const d = new Date(today);
  d.setDate(d.getDate() + daysFromToday);
  d.setHours(hours, 0, 0, 0);
  return d.toISOString();
};

export const currentUser = {
  id: "u-amy",
  name: "Amy Chan",
  role: "Admin" as Role,
  initials: "AC",
  email: "amy@kossilon.hk",
};

export const teamMembers: TeamMember[] = [
  {
    id: "u-amy",
    name: "Amy Chan",
    initials: "AC",
    role: "Admin",
    team: "Filing Team A",
    email: "amy@kossilon.hk",
    clientsOwned: 12,
  },
  {
    id: "u-ken",
    name: "Ken Wong",
    initials: "KW",
    role: "Manager",
    team: "Filing Team A",
    email: "ken@kossilon.hk",
    clientsOwned: 18,
  },
  {
    id: "u-mei",
    name: "Mei Lam",
    initials: "ML",
    role: "Staff",
    team: "Filing Team A",
    email: "mei@kossilon.hk",
    clientsOwned: 24,
  },
  {
    id: "u-jon",
    name: "Jonathan Ho",
    initials: "JH",
    role: "Staff",
    team: "Filing Team B",
    email: "jon@kossilon.hk",
    clientsOwned: 21,
  },
  {
    id: "u-pri",
    name: "Priya Singh",
    initials: "PS",
    role: "Manager",
    team: "Filing Team B",
    email: "priya@kossilon.hk",
    clientsOwned: 16,
  },
  {
    id: "u-raj",
    name: "Raj Kumar",
    initials: "RK",
    role: "Staff",
    team: "Filing Team B",
    email: "raj@kossilon.hk",
    clientsOwned: 19,
  },
  {
    id: "u-sam",
    name: "Sam Tse",
    initials: "ST",
    role: "Staff",
    team: "New Business",
    email: "sam@kossilon.hk",
    clientsOwned: 8,
  },
];

export const teams: Team[] = [
  {
    id: "t-a",
    name: "Filing Team A",
    lead: "Ken Wong",
    memberIds: ["u-amy", "u-ken", "u-mei"],
    clientCount: 54,
  },
  {
    id: "t-b",
    name: "Filing Team B",
    lead: "Priya Singh",
    memberIds: ["u-jon", "u-pri", "u-raj"],
    clientCount: 56,
  },
  { id: "t-c", name: "New Business", lead: "Sam Tse", memberIds: ["u-sam"], clientCount: 8 },
];

const companyNames = [
  "Harbour Trading Ltd",
  "Kowloon Textiles Ltd",
  "Victoria Peak Holdings",
  "Wanchai Foods Ltd",
  "Central Fintech Ltd",
  "Star Ferry Logistics",
  "Nathan Road Retail Ltd",
  "Aberdeen Marine Ltd",
  "Sha Tin Property Ltd",
  "Mongkok Digital Ltd",
  "Tsim Sha Tsui Media Ltd",
  "Causeway Commerce Ltd",
  "Lantau Green Energy Ltd",
  "North Point Consulting Ltd",
  "Sai Kung Ventures Ltd",
  "Repulse Bay Advisors Ltd",
  "Discovery Bay Tech Ltd",
  "Cheung Sha Wan Apparel",
  "Kwun Tong Manufacturing",
  "Yau Ma Tei Publishing Ltd",
];

const dueOffsets = [-8, -3, -1, 2, 4, 6, 9, 12, 15, 18, 22, 26, 29, 34, 41, 55, 72, 90, 110, 130];
const statusPool: CaseStatus[] = [
  "Overdue" as never, // placeholder; replaced by real status by offset
  "Documents Pending",
  "Payment Pending",
  "Signature Pending",
  "Documents Received",
  "NAR1 Prepared",
  "Ready to File",
  "Reminder Sent",
  "Upcoming",
  "Payment Received",
  "Documents Pending",
  "Reminder Sent",
  "Upcoming",
  "Upcoming",
  "Upcoming",
  "Filed",
  "Filed",
  "Completed",
  "Completed",
  "Completed",
];

const packages: Array<Company["package"]> = ["Basic", "Standard", "Premium"];
const paymentStatuses: Array<Company["paymentStatus"]> = ["Paid", "Pending", "Overdue"];

const makeChecklist = (companyId: string, allReceived = false): ChecklistItem[] => {
  const base = [
    "Signed NAR1 form",
    "Register of members (updated)",
    "Register of directors",
    "Register of secretaries",
    "Business registration certificate copy",
    "Proof of registered office address",
    "ID copies of all directors",
  ];
  return base.map((label, i) => ({
    id: `${companyId}-doc-${i}`,
    label,
    received: allReceived ? true : (i + companyId.length) % 3 !== 0,
    requiredBy: iso(3 + (i % 5)),
    file:
      allReceived || i % 2 === 0
        ? `${label.toLowerCase().replace(/[^a-z]+/g, "-")}.pdf`
        : undefined,
  }));
};

const makeTimeline = (companyId: string, name: string): TimelineEvent[] => [
  {
    id: `${companyId}-t1`,
    at: iso(-30),
    kind: "status",
    actor: "System",
    text: `Annual return cycle opened for ${name}`,
  },
  {
    id: `${companyId}-t2`,
    at: iso(-20),
    kind: "reminder",
    actor: "System",
    text: "First reminder sent via WhatsApp",
  },
  {
    id: `${companyId}-t3`,
    at: iso(-14),
    kind: "message",
    actor: "Client",
    text: "Requested extension of 5 days",
  },
  {
    id: `${companyId}-t4`,
    at: iso(-10),
    kind: "document",
    actor: "Mei Lam",
    text: "Received register of directors",
  },
  {
    id: `${companyId}-t5`,
    at: iso(-7),
    kind: "payment",
    actor: "System",
    text: "Invoice INV-2026-0142 issued (HKD 3,800)",
  },
  {
    id: `${companyId}-t6`,
    at: iso(-3),
    kind: "note",
    actor: "Ken Wong",
    text: "Chased director for signature; will call again Monday",
  },
  {
    id: `${companyId}-t7`,
    at: iso(-1),
    kind: "reminder",
    actor: "System",
    text: "Second reminder scheduled for tomorrow",
  },
];

export const companies: Company[] = companyNames.map((name, i) => {
  const id = `c-${i + 1}`;
  const ownerId = teamMembers[i % teamMembers.length].id;
  const owner = teamMembers.find((t) => t.id === ownerId)!;
  return {
    id,
    name,
    brNumber: `${60000000 + i * 137}`,
    crNumber: `${1200000 + i * 41}`,
    incorporated: iso(-365 * (2 + (i % 8))),
    package: packages[i % packages.length],
    ownerId,
    team: owner.team,
    contacts: [
      {
        name: `${name.split(" ")[0]} Director`,
        role: "Director",
        email: `director@${name.toLowerCase().replace(/[^a-z]+/g, "")}.hk`,
        phone: `+852 9${100 + i}0 ${1000 + i}`,
      },
      {
        name: `${name.split(" ")[0]} Finance`,
        role: "Finance Contact",
        email: `finance@${name.toLowerCase().replace(/[^a-z]+/g, "")}.hk`,
        phone: `+852 9${200 + i}0 ${2000 + i}`,
      },
    ],
    address: `${i + 1}/F, ${name.split(" ")[0]} Building, ${["Central", "Wan Chai", "Kowloon", "Sha Tin", "Tsuen Wan"][i % 5]}, Hong Kong`,
    arDueDate: iso(dueOffsets[i]),
    paymentStatus: paymentStatuses[i % paymentStatuses.length],
    invoiceAmount: 2800 + (i % 5) * 400,
    timeline: makeTimeline(id, name),
  };
});

const nextActionByStatus: Record<CaseStatus, string> = {
  Upcoming: "Send initial checklist",
  "Reminder Sent": "Await client response (3-day follow-up)",
  "Documents Pending": "Chase missing documents",
  "Documents Received": "Verify documents & issue invoice",
  "Payment Pending": "Send payment reminder",
  "Payment Received": "Prepare NAR1 form",
  "NAR1 Prepared": "Send NAR1 for director signature",
  "Signature Pending": "Chase director for signature",
  "Ready to File": "File with Companies Registry",
  Filed: "Update client & archive documents",
  Completed: "Cycle complete — schedule next reminder",
};

export const cases: AnnualReturnCase[] = companies.map((c, i) => {
  const offset = dueOffsets[i];
  // If overdue, force overdue-appropriate status
  let status: CaseStatus = statusPool[i] as CaseStatus;
  if (offset < 0 && !["Filed", "Completed"].includes(status)) {
    status = i % 2 === 0 ? "Documents Pending" : "Payment Pending";
  }
  if (offset > 60) status = i % 2 === 0 ? "Filed" : "Completed";

  const owner = teamMembers.find((t) => t.id === c.ownerId)!;
  return {
    id: `ar-${c.id}`,
    companyId: c.id,
    companyName: c.name,
    status,
    dueDate: c.arDueDate,
    ownerId: owner.id,
    ownerName: owner.name,
    nextAction: nextActionByStatus[status],
    checklist: makeChecklist(c.id, status === "Filed" || status === "Completed"),
    remindersSent: Math.max(0, Math.floor((30 - offset) / 10)),
    notes: [
      { at: iso(-5), author: owner.name, text: "Called director; will send documents this week." },
      { at: iso(-2), author: "Amy Chan", text: "Confirmed BR certificate is up to date." },
    ],
  };
});

// ---------- enquiries / WhatsApp ----------

const enquiryContacts = [
  { name: "Jason Lau", phone: "+852 9012 3456" },
  { name: "Vanessa Ho", phone: "+852 9887 2201" },
  { name: "Marco Chen", phone: "+852 9223 4471" },
  { name: "Ivy Cheung", phone: "+852 6612 8890" },
  { name: "Terence Ng", phone: "+852 9088 4412" },
  { name: "Sophie Yiu", phone: "+852 9345 0071" },
  { name: "Bosco Fung", phone: "+852 6890 3321" },
  { name: "Rachel Kwan", phone: "+852 9200 5510" },
];

const intents: EnquiryIntent[] = [
  "New Incorporation",
  "Annual Return",
  "Change of Director",
  "Deregistration",
  "General Question",
  "Payment Query",
  "New Incorporation",
  "Annual Return",
];

export const enquiries: Enquiry[] = enquiryContacts.map((c, i) => ({
  id: `e-${i + 1}`,
  contactName: c.name,
  phone: c.phone,
  lastMessage: [
    "Hi, I want to open a HK company. What's the fee?",
    "My annual return is due next month, can you help?",
    "Need to change one director, how long does it take?",
    "Want to deregister a dormant company.",
    "Is stamp duty required for share transfer?",
    "Invoice INV-2026-0102 — has this been received?",
    "Do you provide nominee director services?",
    "AR reminder received. Sending docs today.",
  ][i],
  lastMessageAt: iso(0, 8 + i),
  intent: intents[i],
  intentConfidence: 0.72 + (i % 5) * 0.05,
  quoteStatus: (
    [
      "None",
      "Draft",
      "Sent",
      "Accepted",
      "None",
      "None",
      "Sent",
      "None",
    ] as Enquiry["quoteStatus"][]
  )[i],
  assignedTo: i % 3 === 0 ? undefined : teamMembers[i % teamMembers.length].id,
  unread: i % 2 === 0 ? Math.max(1, i % 4) : 0,
  messages: [
    { from: "client", text: "Hi, need some help.", at: iso(-1, 14) },
    {
      from: "bot",
      text: "Hi! This is Kossilon assistant. May I know what you need help with?",
      at: iso(-1, 14),
    },
    { from: "client", text: "Annual return / new company", at: iso(-1, 15) },
    {
      from: "staff",
      text: "Sure, we can help. Sending you our package details now.",
      at: iso(0, 8 + i),
    },
  ],
}));

// ---------- tasks ----------

export const tasks: Task[] = [
  {
    id: "tk-1",
    title: "Chase director signature — Harbour Trading Ltd",
    companyName: "Harbour Trading Ltd",
    dueDate: iso(0),
    priority: "High",
    assigneeId: "u-amy",
    done: false,
  },
  {
    id: "tk-2",
    title: "Verify register of members — Kowloon Textiles Ltd",
    companyName: "Kowloon Textiles Ltd",
    dueDate: iso(1),
    priority: "Normal",
    assigneeId: "u-mei",
    done: false,
  },
  {
    id: "tk-3",
    title: "Send invoice — Wanchai Foods Ltd",
    companyName: "Wanchai Foods Ltd",
    dueDate: iso(2),
    priority: "Normal",
    assigneeId: "u-amy",
    done: false,
  },
  {
    id: "tk-4",
    title: "File NAR1 — Central Fintech Ltd",
    companyName: "Central Fintech Ltd",
    dueDate: iso(3),
    priority: "High",
    assigneeId: "u-ken",
    done: false,
  },
  {
    id: "tk-5",
    title: "Prepare quote — new enquiry Jason Lau",
    companyName: "—",
    dueDate: iso(1),
    priority: "Normal",
    assigneeId: "u-sam",
    done: false,
  },
  {
    id: "tk-6",
    title: "Follow up payment — Nathan Road Retail Ltd",
    companyName: "Nathan Road Retail Ltd",
    dueDate: iso(-1),
    priority: "High",
    assigneeId: "u-jon",
    done: false,
  },
  {
    id: "tk-7",
    title: "Archive filed documents — Sha Tin Property Ltd",
    companyName: "Sha Tin Property Ltd",
    dueDate: iso(4),
    priority: "Low",
    assigneeId: "u-mei",
    done: true,
  },
];

// ---------- derived helpers ----------

export const daysUntil = (isoDate: string) => {
  const d = new Date(isoDate).getTime();
  const t = today.getTime();
  return Math.round((d - t) / (1000 * 60 * 60 * 24));
};

export const formatDateTime = (isoDate: string) => {
  const d = new Date(isoDate);
  return d.toLocaleString("en-HK", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export const dashboardMetrics = () => {
  const dueIn7 = cases.filter((c) => {
    const d = daysUntil(c.dueDate);
    return d >= 0 && d <= 7 && !["Filed", "Completed"].includes(c.status);
  }).length;
  const dueIn30 = cases.filter((c) => {
    const d = daysUntil(c.dueDate);
    return d >= 0 && d <= 30 && !["Filed", "Completed"].includes(c.status);
  }).length;
  const overdue = cases.filter(
    (c) => daysUntil(c.dueDate) < 0 && !["Filed", "Completed"].includes(c.status),
  ).length;
  const missingDocs = cases.reduce(
    (sum, c) => sum + c.checklist.filter((i) => !i.received).length,
    0,
  );
  const paymentPending = companies.filter((c) => c.paymentStatus !== "Paid").length;
  const whatsappToday = enquiries.reduce((s, e) => s + (e.unread || 0), 0) + 12;
  const myCases = cases.filter(
    (c) => c.ownerId === currentUser.id && !["Completed"].includes(c.status),
  ).length;
  const teamWorkload = teamMembers.reduce((s, m) => s + m.clientsOwned, 0);
  return {
    dueIn7,
    dueIn30,
    overdue,
    missingDocs,
    paymentPending,
    whatsappToday,
    myCases,
    teamWorkload,
  };
};

export const upcomingCases = () =>
  [...cases]
    .filter((c) => !["Filed", "Completed"].includes(c.status))
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
    .slice(0, 8);

export const teamWorkloadRows = () =>
  teamMembers.map((m) => ({
    ...m,
    activeCases: cases.filter(
      (c) => c.ownerId === m.id && !["Completed", "Filed"].includes(c.status),
    ).length,
    overdue: cases.filter(
      (c) =>
        c.ownerId === m.id &&
        daysUntil(c.dueDate) < 0 &&
        !["Filed", "Completed"].includes(c.status),
    ).length,
  }));
