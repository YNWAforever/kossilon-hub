import type { AnnualReturnCase, RiskLevel } from "@/features/annual-return/types";
import { triageEnquiry } from "@/lib/enquiry-triage";
import type { Enquiry, Task } from "@/lib/mock-data";
import type { StatusTone } from "@/lib/status";

export type DailyDigestSeverity = "critical" | "high" | "medium";
export type DailyDigestKind = "annual-return" | "enquiry" | "task";

export type DailyDigestRoute =
  | { to: "/annual-returns/$id"; params: { id: string } }
  | { to: "/enquiries"; search: { enquiry: string } }
  | { to: "/tasks" };

export type DailyDigestItem = {
  id: string;
  kind: DailyDigestKind;
  severity: DailyDigestSeverity;
  title: string;
  detail: string;
  actionLabel: string;
  route: DailyDigestRoute;
  score: number;
};

export type DailyDigest = {
  headline: string;
  items: DailyDigestItem[];
  counts: Record<DailyDigestSeverity, number>;
  totalCandidateCount: number;
  generatedAt: string;
};

export type BuildDailyDigestInput = {
  annualReturnCases: AnnualReturnCase[];
  enquiries: Enquiry[];
  tasks: Task[];
  now?: Date;
  maxItems?: number;
};

const severityWeight: Record<DailyDigestSeverity, number> = {
  critical: 1_500,
  high: 800,
  medium: 500,
};

function dayNumber(date: Date): number {
  return Math.floor(date.getTime() / 86_400_000);
}

function daysUntil(dateValue: string, now: Date): number {
  return dayNumber(new Date(dateValue)) - dayNumber(now);
}

function dueLabel(daysLeft: number): string {
  if (daysLeft < 0) return `${Math.abs(daysLeft)}d overdue`;
  if (daysLeft === 0) return "due today";
  if (daysLeft === 1) return "due tomorrow";
  return `due in ${daysLeft}d`;
}

function annualReturnRiskWeight(riskLevel: RiskLevel): number {
  switch (riskLevel) {
    case "red":
      return 90;
    case "orange":
      return 70;
    case "yellow":
      return 40;
    case "green":
    default:
      return 0;
  }
}

function missingRequiredCount(case_: AnnualReturnCase): number {
  return case_.checklist.filter((item) => item.required && item.status !== "Verified").length;
}

function annualReturnSeverity(
  case_: AnnualReturnCase,
  daysLeft: number,
  missingRequired: number,
): DailyDigestSeverity | null {
  if (case_.currentStatus === "Completed" || case_.currentStatus === "Filed") {
    return null;
  }

  if (case_.riskLevel === "red" || daysLeft < 0) {
    return "critical";
  }

  if (case_.riskLevel === "orange" || daysLeft <= 7 || missingRequired > 0) {
    return "high";
  }

  if (case_.riskLevel === "yellow" || daysLeft <= 30) {
    return "medium";
  }

  return null;
}

function annualReturnItem(case_: AnnualReturnCase, now: Date): DailyDigestItem | null {
  const daysLeft = daysUntil(case_.filingDueDate, now);
  const missingRequired = missingRequiredCount(case_);
  const severity = annualReturnSeverity(case_, daysLeft, missingRequired);

  if (!severity) {
    return null;
  }

  const missingDetail =
    missingRequired > 0
      ? `${missingRequired} evidence ${missingRequired === 1 ? "item" : "items"} outstanding`
      : "evidence complete";

  return {
    id: `annual-return:${case_.id}`,
    kind: "annual-return",
    severity,
    title: `Escalate ${case_.companyName} annual return`,
    detail: `${case_.currentStatus}; ${dueLabel(daysLeft)}; ${missingDetail}.`,
    actionLabel: "Open case",
    route: { to: "/annual-returns/$id", params: { id: case_.id } },
    score:
      severityWeight[severity] +
      annualReturnRiskWeight(case_.riskLevel) +
      Math.max(0, 60 - daysLeft) +
      missingRequired * 8,
  };
}

function enquiryItem(enquiry: Enquiry): DailyDigestItem | null {
  const triage = triageEnquiry(enquiry);

  if (triage.band !== "urgent" && triage.band !== "priority") {
    return null;
  }

  return {
    id: `enquiry:${enquiry.id}`,
    kind: "enquiry",
    severity: "high",
    title: `Review ${enquiry.contactName} WhatsApp reply`,
    detail: `${triage.intent}; ${triage.recommendedAction}`,
    actionLabel: "Open enquiry",
    route: { to: "/enquiries", search: { enquiry: enquiry.id } },
    score: severityWeight.high + triage.score,
  };
}

function taskSeverity(task: Task, daysLeft: number): DailyDigestSeverity | null {
  if (task.done) {
    return null;
  }

  if (task.priority === "High" || daysLeft <= 1) {
    return "high";
  }

  if (task.priority === "Normal" && daysLeft <= 3) {
    return "medium";
  }

  return null;
}

function taskItem(task: Task, now: Date): DailyDigestItem | null {
  const daysLeft = daysUntil(task.dueDate, now);
  const severity = taskSeverity(task, daysLeft);

  if (!severity) {
    return null;
  }

  return {
    id: `task:${task.id}`,
    kind: "task",
    severity,
    title: task.title,
    detail: `${task.companyName}; ${dueLabel(daysLeft)}; ${task.priority.toLowerCase()} priority.`,
    actionLabel: "Open tasks",
    route: { to: "/tasks" },
    score:
      severityWeight[severity] + (task.priority === "High" ? 85 : 25) + Math.max(0, 20 - daysLeft),
  };
}

function compareItems(a: DailyDigestItem, b: DailyDigestItem): number {
  if (b.score !== a.score) {
    return b.score - a.score;
  }

  return a.title.localeCompare(b.title);
}

export function digestTone(severity: DailyDigestSeverity): StatusTone {
  switch (severity) {
    case "critical":
      return "red";
    case "high":
      return "orange";
    case "medium":
    default:
      return "yellow";
  }
}

export function buildDailyDigest({
  annualReturnCases,
  enquiries,
  tasks,
  now = new Date(),
  maxItems = 5,
}: BuildDailyDigestInput): DailyDigest {
  const candidates = [
    ...annualReturnCases.map((case_) => annualReturnItem(case_, now)),
    ...enquiries.map(enquiryItem),
    ...tasks.map((task) => taskItem(task, now)),
  ]
    .filter((item): item is DailyDigestItem => item !== null)
    .sort(compareItems);

  const counts: DailyDigest["counts"] = { critical: 0, high: 0, medium: 0 };
  for (const item of candidates) {
    counts[item.severity] += 1;
  }

  const totalPriorityCount = counts.critical + counts.high + counts.medium;

  return {
    headline:
      totalPriorityCount > 0
        ? `${totalPriorityCount} priority ${totalPriorityCount === 1 ? "action" : "actions"} before close of business`
        : "No priority actions detected",
    items: candidates.slice(0, maxItems),
    counts,
    totalCandidateCount: candidates.length,
    generatedAt: now.toISOString(),
  };
}
