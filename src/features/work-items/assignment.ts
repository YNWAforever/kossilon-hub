import type {
  ActiveWorkload,
  AssignmentInput,
  AssignmentRecommendation,
  StaffCandidate,
} from "./types";

const URGENCY_WEIGHT = {
  none: 1,
  warning: 2,
  breach: 4,
} as const;

function workloadPoints(items: readonly ActiveWorkload[]): number {
  return items.reduce((total, item) => {
    if (!Number.isFinite(item.effortPoints) || item.effortPoints < 0) {
      throw new Error("Workload effort points must be non-negative.");
    }
    return total + item.effortPoints * URGENCY_WEIGHT[item.threshold];
  }, 0);
}

function eligible(candidate: StaffCandidate, input: AssignmentInput): boolean {
  if (!candidate.active || !candidate.available) return false;
  if (candidate.role !== input.requiredRole) return false;
  if (!candidate.teamIds.includes(input.teamId)) return false;
  if (!candidate.skills.some((skill) => skill.key === input.requiredSkillKey)) return false;
  if (input.separationOfDuties) {
    const conflictingUserId =
      input.assignmentTarget === "owner" ? input.reviewerId : input.ownerId;
    if (candidate.userId === conflictingUserId) return false;
  }
  return true;
}

function recommendationFor(
  candidate: StaffCandidate,
  input: AssignmentInput,
): Omit<AssignmentRecommendation, "rank"> {
  const skill = candidate.skills.find((item) => item.key === input.requiredSkillKey);
  if (!skill) throw new Error("Eligible assignment candidate must have the required skill.");
  if (!Number.isInteger(skill.proficiency) || skill.proficiency < 1 || skill.proficiency > 5) {
    throw new Error("Skill proficiency must be an integer from 1 to 5.");
  }

  const weightedWorkload = workloadPoints(candidate.activeWork);
  const rawWorkload = candidate.activeWork.reduce((total, item) => total + item.effortPoints, 0);
  const capacityUtilization =
    candidate.capacityPoints > 0
      ? Math.round((rawWorkload / candidate.capacityPoints) * 100)
      : 1_000;
  const continuityBonus = candidate.caseIds.includes(input.caseId) ? 30 : 0;
  const score =
    skill.proficiency * 100 - weightedWorkload - capacityUtilization + continuityBonus;

  return {
    staffId: candidate.staffId,
    userId: candidate.userId,
    score,
    factors: {
      skillProficiency: skill.proficiency,
      workloadPoints: weightedWorkload,
      capacityUtilization,
      continuityBonus,
    },
  };
}

function compareStaffIds(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

export function rankAssignmentCandidates(
  input: AssignmentInput,
): AssignmentRecommendation[] {
  const ranked = input.candidates
    .filter((candidate) => eligible(candidate, input))
    .map((candidate) => recommendationFor(candidate, input))
    .sort((left, right) => right.score - left.score || compareStaffIds(left.staffId, right.staffId));

  return ranked.map((recommendation, index) => ({
    ...recommendation,
    rank: index + 1,
  }));
}
