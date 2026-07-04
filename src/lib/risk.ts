// Risk evaluation + reminder cadence scheduling for annual return cases.
// Combines a case's live state with its checklist template's risk rules and
// reminder cadence to produce a risk level, list of triggered rules, an
// adjusted reminder schedule, and escalation actions.

import {
  daysUntil,
  teamMembers,
  type AnnualReturnCase,
  type Company,
} from "@/lib/mock-data";
import {
  templateForService,
  type ChecklistTemplate,
  type ReminderRule,
  type RiskRule,
  type ServiceType,
} from "@/lib/templates";

export type RiskLevel = "Low" | "Medium" | "High";

export type TriggeredRule = {
  rule: RiskRule;
  reason: string;
};

export type ScheduledReminder = {
  id: string;
  label: string;
  channel: ReminderRule["channel"];
  daysBeforeDue: number; // negative if already overdue
  source: "template" | "risk-boost";
  status: "sent" | "scheduled" | "overdue";
};

export type EscalationStep = {
  when: string;
  actor: string;
  action: string;
};

export type RiskEvaluation = {
  template?: ChecklistTemplate;
  level: RiskLevel;
  triggered: TriggeredRule[];
  reminders: ScheduledReminder[];
  escalations: EscalationStep[];
  summary: string;
};

// ---------- rule matchers ----------
// Match risk rules by keyword patterns in the trigger string, so free-text
// rules authored in Settings still work.
type Matcher = (ctx: EvalContext) => string | null;

type EvalContext = {
  case: AnnualReturnCase;
  company?: Company;
  daysLeft: number;
  missingRequired: number;
  totalRequired: number;
  paymentOverdueDays: number;
};

const matchers: Array<{ test: RegExp; matcher: Matcher }> = [
  {
    test: /deadline.*<\s*3.*docs.*incomplete/i,
    matcher: (c) =>
      c.daysLeft < 3 && c.missingRequired > 0
        ? `Due in ${c.daysLeft} day(s) with ${c.missingRequired} document(s) missing`
        : null,
  },
  {
    test: /deadline.*<\s*3/i,
    matcher: (c) => (c.daysLeft < 3 ? `Due in ${c.daysLeft} day(s)` : null),
  },
  {
    test: /(audit).*(21|three weeks)/i,
    matcher: (c) =>
      c.daysLeft < 21 && c.missingRequired > 0
        ? `Audit-related documents outstanding with ${c.daysLeft} days to due`
        : null,
  },
  {
    test: /payment.*(overdue|unpaid).*(14|two weeks)/i,
    matcher: (c) =>
      c.paymentOverdueDays > 14
        ? `Invoice unpaid for ${c.paymentOverdueDays} day(s)`
        : null,
  },
  {
    test: /(no.*reply|unresponsive|silent).*(3|three)/i,
    matcher: (c) =>
      c.case.remindersSent >= 3 && c.missingRequired > 0
        ? `${c.case.remindersSent} reminders sent, client still not fully responsive`
        : null,
  },
  {
    test: /(kyc|missing.*id)/i,
    matcher: (c) =>
      c.missingRequired > 0
        ? `${c.missingRequired} required KYC/ID document(s) still missing`
        : null,
  },
  {
    test: /(15.*day|statutory)/i,
    matcher: (c) =>
      c.daysLeft < 0
        ? `Statutory filing window exceeded by ${Math.abs(c.daysLeft)} day(s)`
        : null,
  },
  {
    test: /(ird|tax)/i,
    matcher: (c) =>
      c.missingRequired > 0
        ? `IRD clearance / tax documents outstanding`
        : null,
  },
];

function evaluateRule(rule: RiskRule, ctx: EvalContext): string | null {
  for (const m of matchers) {
    if (m.test.test(rule.trigger)) return m.matcher(ctx);
  }
  // Unknown trigger — treat as informational watch (not auto-triggered).
  return null;
}

const rank: Record<RiskLevel, number> = { Low: 0, Medium: 1, High: 2 };

// ---------- reminder scheduling ----------
function buildSchedule(
  template: ChecklistTemplate | undefined,
  daysLeft: number,
  remindersSent: number,
  level: RiskLevel,
): ScheduledReminder[] {
  const base = (template?.reminders ?? []).map<ScheduledReminder>((r, i) => ({
    id: r.id,
    label: r.label,
    channel: r.channel,
    daysBeforeDue: r.daysBeforeDue,
    source: "template",
    status:
      remindersSent > i
        ? "sent"
        : r.daysBeforeDue > daysLeft
          ? "overdue"
          : "scheduled",
  }));

  const boosts: ScheduledReminder[] = [];
  if (level === "Medium" && daysLeft > 2) {
    // Squeeze in a mid-cycle nudge
    const mid = Math.max(2, Math.floor(daysLeft / 2));
    boosts.push({
      id: "boost-mid",
      label: "Risk-boost reminder",
      channel: "WhatsApp",
      daysBeforeDue: mid,
      source: "risk-boost",
      status: "scheduled",
    });
  }
  if (level === "High") {
    // Daily / every-other-day cadence until due
    for (let d = Math.min(daysLeft, 6); d >= 1; d -= 2) {
      if (base.some((b) => b.daysBeforeDue === d)) continue;
      boosts.push({
        id: `boost-${d}`,
        label: `Urgent chase (T-${d}d)`,
        channel: "WhatsApp",
        daysBeforeDue: d,
        source: "risk-boost",
        status: "scheduled",
      });
    }
    if (daysLeft <= 0) {
      boosts.push({
        id: "boost-overdue",
        label: "Overdue escalation call",
        channel: "SMS",
        daysBeforeDue: daysLeft,
        source: "risk-boost",
        status: "overdue",
      });
    }
  }

  return [...base, ...boosts].sort((a, b) => b.daysBeforeDue - a.daysBeforeDue);
}

function buildEscalations(
  level: RiskLevel,
  case_: AnnualReturnCase,
): EscalationStep[] {
  const owner = teamMembers.find((t) => t.id === case_.ownerId);
  const teamLead =
    teamMembers.find(
      (t) => t.team === owner?.team && t.role === "Manager",
    ) ?? teamMembers.find((t) => t.role === "Manager");
  const admin = teamMembers.find((t) => t.role === "Admin");

  if (level === "Low") {
    return [
      {
        when: "On schedule",
        actor: owner?.name ?? "Owner",
        action: "Continue template cadence, no escalation",
      },
    ];
  }
  if (level === "Medium") {
    return [
      {
        when: "Now",
        actor: owner?.name ?? "Owner",
        action: "Reach out to client via preferred channel",
      },
      {
        when: "If no reply in 48h",
        actor: teamLead?.name ?? "Team lead",
        action: "Notified via in-app alert",
      },
    ];
  }
  return [
    {
      when: "Now",
      actor: owner?.name ?? "Owner",
      action: "Call client directly and log outcome",
    },
    {
      when: "Within 24h",
      actor: teamLead?.name ?? "Team lead",
      action: "Take joint ownership of the case",
    },
    {
      when: "Within 48h",
      actor: admin?.name ?? "Admin",
      action: "Auto-flagged for partner review",
    },
  ];
}

// ---------- public API ----------
export function evaluateRisk(
  case_: AnnualReturnCase,
  company: Company | undefined,
  serviceType: ServiceType = "Annual Return — Private Ltd",
): RiskEvaluation {
  const template = templateForService(serviceType);
  const daysLeft = daysUntil(case_.dueDate);
  const requiredItems = case_.checklist; // all seed items are required
  const missingRequired = requiredItems.filter((i) => !i.received).length;
  const totalRequired = requiredItems.length;
  const paymentOverdueDays =
    company?.paymentStatus === "Overdue" ? 20 : company?.paymentStatus === "Pending" ? 5 : 0;

  const ctx: EvalContext = {
    case: case_,
    company,
    daysLeft,
    missingRequired,
    totalRequired,
    paymentOverdueDays,
  };

  const triggered: TriggeredRule[] = [];
  for (const rule of template?.riskRules ?? []) {
    if (!rule.enabled) continue;
    const reason = evaluateRule(rule, ctx);
    if (reason) triggered.push({ rule, reason });
  }

  // Baseline: if nothing triggered but the case is overdue, still surface risk.
  let level: RiskLevel = "Low";
  for (const t of triggered) {
    if (rank[t.rule.severity] > rank[level]) level = t.rule.severity;
  }
  if (level === "Low" && daysLeft < 0 && !["Filed", "Completed"].includes(case_.status)) {
    level = "High";
  } else if (level === "Low" && daysLeft <= 7 && missingRequired > 0) {
    level = "Medium";
  }

  const reminders = buildSchedule(template, daysLeft, case_.remindersSent, level);
  const escalations = buildEscalations(level, case_);

  const summary =
    level === "High"
      ? `High risk — ${triggered.length || 1} condition(s) require immediate action.`
      : level === "Medium"
        ? `Elevated risk — tighten cadence and monitor client response.`
        : `On track — proceed with the standard template cadence.`;

  return { template, level, triggered, reminders, escalations, summary };
}

export const riskTone = (l: RiskLevel) =>
  l === "High" ? "red" : l === "Medium" ? "orange" : "green";
