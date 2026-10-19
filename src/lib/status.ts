import type { CaseStatus } from "./mock-data";

export type StatusTone = "green" | "yellow" | "orange" | "red" | "blue" | "neutral";

export const caseStatusTone = (status: CaseStatus): StatusTone => {
  switch (status) {
    case "Upcoming":
      return "blue";
    case "Reminder Sent":
    case "Documents Received":
    case "Payment Received":
    case "NAR1 Prepared":
    case "Ready to File":
      return "green";
    case "Documents Pending":
    case "Signature Pending":
      return "yellow";
    case "Payment Pending":
      return "orange";
    case "Filed":
    case "Completed":
      return "blue";
    default:
      return "neutral";
  }
};

export const deadlineTone = (daysLeft: number): StatusTone => {
  if (daysLeft < 0) return "red";
  if (daysLeft <= 7) return "orange";
  if (daysLeft <= 30) return "yellow";
  return "green";
};

export const toneClasses: Record<
  StatusTone,
  { bg: string; text: string; ring: string; dot: string }
> = {
  green: {
    bg: "bg-status-green-soft",
    text: "text-status-green-text",
    ring: "ring-status-green/20",
    dot: "bg-status-green",
  },
  yellow: {
    bg: "bg-status-yellow-soft",
    text: "text-status-yellow-text",
    ring: "ring-status-yellow/20",
    dot: "bg-status-yellow",
  },
  orange: {
    bg: "bg-status-orange-soft",
    text: "text-status-orange-text",
    ring: "ring-status-orange/20",
    dot: "bg-status-orange",
  },
  red: {
    bg: "bg-status-red-soft",
    text: "text-status-red-text",
    ring: "ring-status-red/20",
    dot: "bg-status-red",
  },
  blue: {
    bg: "bg-status-blue-soft",
    text: "text-status-blue-text",
    ring: "ring-status-blue/20",
    dot: "bg-status-blue",
  },
  neutral: {
    bg: "bg-muted",
    text: "text-muted-foreground",
    ring: "ring-border",
    dot: "bg-muted-foreground",
  },
};

export const formatDaysLeft = (daysLeft: number) => {
  if (daysLeft < 0) return `已逾期 ${Math.abs(daysLeft)} 日`;
  if (daysLeft === 0) return "今日到期";
  return `尚餘 ${daysLeft} 日`;
};
