import type { AnnualReturnCase } from "@/features/annual-return/types";
import type { ReadinessBlocker } from "@/features/annual-return/readiness";

export type AssignmentOption = {
  userId: string;
  displayName: string;
  teamName: string | null;
  active: boolean;
  workload: number;
};
export type CaseBusinessContext = {
  filingDueDate: string;
  sourceVersion: string | null;
  blockers: ReadinessBlocker[];
};
export function activeAssignmentOptions<T extends AssignmentOption>(options: readonly T[]): T[] {
  return options.filter((o) => o.active);
}
/** Only names/teams and safe user identifiers, never email addresses. */
export function assignmentLabels(options: readonly AssignmentOption[]): Map<string, string> {
  const base = (o: AssignmentOption) =>
    `${o.displayName.trim() || "姓名待補"} · ${o.teamName?.trim() || "團隊待補"}`;
  return new Map(
    options.map((o) => {
      const same = options.filter((other) => other.userId !== o.userId && base(other) === base(o));
      let size = 8;
      while (
        size < o.userId.length &&
        same.some((other) => other.userId.slice(-size) === o.userId.slice(-size))
      )
        size++;
      return [o.userId, `${base(o)}${same.length ? ` · ${o.userId.slice(-size)}` : ""}`];
    }),
  );
}
export function caseBusinessContext(
  case_: AnnualReturnCase,
  today: string,
): CaseBusinessContext | null {
  if (!case_.readiness) return null;
  const closed = ["Filed", "Completed"].includes(case_.currentStatus);
  const blockers = closed ? [] : case_.readiness.blockers.filter((b) => b.stage === "prepare");
  if (!closed && case_.filingDueDate < today)
    blockers.unshift({
      code: "statutory_overdue",
      stage: "prepare",
      message: `法定申報日 ${case_.filingDueDate} 已過，需跟進交件。`,
      action: `/annual-returns/${case_.id}`,
    });
  return {
    filingDueDate: case_.filingDueDate,
    sourceVersion: case_.readiness.sourceVersion,
    blockers,
  };
}
