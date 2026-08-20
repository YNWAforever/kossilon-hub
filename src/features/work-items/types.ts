export type Weekday =
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday"
  | "sunday";

export type BusinessInterval = {
  start: string;
  end: string;
};

export type BusinessCalendarHoliday = {
  date: string;
  closed: boolean;
  workingIntervals?: readonly BusinessInterval[];
};

export type BusinessCalendar = {
  id: string;
  timezone: string;
  weeklySchedule: Record<Weekday, readonly BusinessInterval[]>;
  holidays: readonly BusinessCalendarHoliday[];
};

export type SlaPolicyVersion = {
  id: string;
  warningMinutes: number;
  dueMinutes: number;
};

export type SlaSnapshot = {
  policyVersionId: string;
  startedAt: string;
  warningAt: string;
  dueAt: string;
};

export type WorkItemCaseType = "annual_return";

export type WorkItemStatus = "open" | "in_progress" | "blocked" | "completed" | "cancelled";

export type SlaThreshold = "none" | "warning" | "breach";

export type WorkItem = {
  id: string;
  status: WorkItemStatus;
  priority: number;
  ownerId: string | null;
  reviewerId: string | null;
  slaWarningAt: string;
  slaDueAt: string;
  slaBreachedAt: string | null;
};

export type AssignmentRole = "Admin" | "Manager" | "Staff" | "Client";

export type StaffSkill = {
  key: string;
  proficiency: number;
};

export type ActiveWorkload = {
  threshold: SlaThreshold;
  effortPoints: number;
};

export type StaffCandidate = {
  staffId: string;
  userId: string;
  role: AssignmentRole;
  teamIds: readonly string[];
  active: boolean;
  available: boolean;
  capacityPoints: number;
  skills: readonly StaffSkill[];
  activeWork: readonly ActiveWorkload[];
  caseIds: readonly (string | null)[];
};

export type AssignmentInput = {
  assignmentTarget: "owner" | "reviewer";
  requiredRole: AssignmentRole;
  requiredSkillKey: string;
  teamId: string;
  caseId: string | null;
  ownerId: string | null;
  reviewerId: string | null;
  separationOfDuties: boolean;
  candidates: readonly StaffCandidate[];
};

export type AssignmentScoreFactors = {
  skillProficiency: number;
  workloadPoints: number;
  capacityUtilization: number;
  continuityBonus: number;
};

export type AssignmentRecommendation = {
  rank: number;
  staffId: string;
  userId: string;
  score: number;
  factors: AssignmentScoreFactors;
};
