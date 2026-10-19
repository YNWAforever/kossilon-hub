import type { RiskLevel } from "@/features/annual-return/types";
import type { DashboardCase } from "@/features/dashboard/types";
import { annualReturnStatusLabel } from "@/features/annual-return/labels";
import { daysBetween } from "@/lib/date-math";
import { hongKongBusinessDate } from "@/lib/hong-kong-time";
import type { StatusTone } from "@/lib/status";

export type DailyDigestSeverity = "critical" | "high" | "medium";
export type DailyDigestKind = "annual-return";

export const DAILY_DIGEST_SEVERITY_LABELS: Record<DailyDigestSeverity, string> = {
  critical: "緊急",
  high: "高",
  medium: "中",
};

export const DAILY_DIGEST_KIND_LABELS: Record<DailyDigestKind, string> = {
  "annual-return": "周年申報",
};

export type DailyDigestRoute = { to: "/annual-returns/$id"; params: { id: string } };

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
  annualReturnCases: DashboardCase[];
  now?: Date;
  maxItems?: number;
};

const severityWeight: Record<DailyDigestSeverity, number> = {
  critical: 1_500,
  high: 800,
  medium: 500,
};

/**
 * Days from the firm's operational today to a date-only due date.
 *
 * Deliberately NOT a UTC day index over the two instants. Hong Kong is UTC+8,
 * so between 00:00 and 08:00 local time the UTC day is still yesterday: a case
 * due today rendered as "due in 1d" and an overdue one as "due today" for the
 * first eight hours of every working day -- precisely the hours the morning
 * digest is read. Same primitive as the deadline pill so the two never disagree
 * on the same screen.
 */
function daysUntil(dueDate: string, now: Date): number {
  return daysBetween(hongKongBusinessDate(now), dueDate);
}

function dueLabel(daysLeft: number): string {
  if (daysLeft < 0) return `已逾期 ${Math.abs(daysLeft)} 日`;
  if (daysLeft === 0) return "今日到期";
  if (daysLeft === 1) return "明日到期";
  return `${daysLeft} 日後到期`;
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

function missingRequiredCount(case_: DashboardCase): number {
  return case_.checklist.filter((item) => item.required && item.status !== "Verified").length;
}

function annualReturnSeverity(
  case_: DashboardCase,
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

function annualReturnItem(case_: DashboardCase, now: Date): DailyDigestItem | null {
  const daysLeft = daysUntil(case_.filingDueDate, now);
  const missingRequired = missingRequiredCount(case_);
  const severity = annualReturnSeverity(case_, daysLeft, missingRequired);

  if (!severity) {
    return null;
  }

  const missingDetail = missingRequired > 0 ? `${missingRequired} 項證明文件未齊` : "證明文件齊全";

  return {
    id: `annual-return:${case_.id}`,
    kind: "annual-return",
    severity,
    title: `升級處理 ${case_.companyName} 的周年申報`,
    detail: `${annualReturnStatusLabel(case_.currentStatus)}；${dueLabel(daysLeft)}；${missingDetail}。`,
    actionLabel: "開啟案件",
    route: { to: "/annual-returns/$id", params: { id: case_.id } },
    score:
      severityWeight[severity] +
      annualReturnRiskWeight(case_.riskLevel) +
      Math.max(0, 60 - daysLeft) +
      missingRequired * 8,
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
  now = new Date(),
  maxItems = 5,
}: BuildDailyDigestInput): DailyDigest {
  const candidates = annualReturnCases
    .map((case_) => annualReturnItem(case_, now))
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
        ? `今日下班前有 ${totalPriorityCount} 項優先工作`
        : "未發現需優先處理的工作",
    items: candidates.slice(0, maxItems),
    counts,
    totalCandidateCount: candidates.length,
    generatedAt: now.toISOString(),
  };
}
