import { daysBetween } from "./workflow";

export type ReminderMilestone = "1_month" | "2_week" | "1_week";

export const REMINDER_MILESTONES: readonly ReminderMilestone[] = ["1_month", "2_week", "1_week"];

const MILESTONE_OFFSET_DAYS: Record<ReminderMilestone, number> = {
  "1_month": 30,
  "2_week": 14,
  "1_week": 7,
};

// Most urgent first: walking this order and returning the first due milestone
// means a case that becomes eligible late (e.g. created 10 days before its
// deadline) jumps straight to the nearest applicable milestone — 1_month and
// 2_week are never fired for it, with no separate "moot" bookkeeping needed.
// Derived from REMINDER_MILESTONES (rather than hand-duplicated in reverse) so
// the two lists can't drift apart if a milestone is ever added or removed.
const MILESTONES_BY_URGENCY: readonly ReminderMilestone[] = [...REMINDER_MILESTONES].reverse();

export function dueMilestone(
  filingDueDate: string,
  today: string,
  firedMilestones: readonly ReminderMilestone[],
): ReminderMilestone | null {
  const daysRemaining = daysBetween(today, filingDueDate);

  // The first (most urgent) milestone whose threshold is satisfied is the one
  // that determines this tick's outcome — fire it if it hasn't fired yet,
  // otherwise stop and return null immediately. Do NOT fall through to check a
  // less-urgent milestone: that would let a case whose most-urgent applicable
  // reminder already fired cascade into firing every remaining milestone, one
  // per subsequent cron tick.
  for (const milestone of MILESTONES_BY_URGENCY) {
    if (daysRemaining <= MILESTONE_OFFSET_DAYS[milestone]) {
      return firedMilestones.includes(milestone) ? null : milestone;
    }
  }

  return null;
}
