import { daysBetween } from "@/lib/date-math";
import { awaitingInternalReview, outstandingSummary } from "./outstanding";
import type { AnnualReturnCase } from "./types";
import type { ReadinessResult } from "./readiness";

/**
 * The five things a staff member does in a day.
 *
 * The board answers "what cases exist". These answer "what do I do now", which
 * is a different question and the one the navigation never asked -- thirteen
 * destinations across Operations, Messaging and Administration, none of them
 * today-shaped.
 *
 * A view whose capability is not released yet shows its real status. It does not
 * borrow another view's rows to look populated, and it never shows a completion
 * that did not happen.
 */

export type WorkViewKey =
  | "chaseToday"
  | "newlyReceived"
  | "awaitingMyReview"
  | "readyToFile"
  | "returnsAndExceptions";

export type WorkViewDefinition = {
  key: WorkViewKey;
  label: string;
  /** What the row means, said in the view rather than left to be inferred. */
  description: string;
  /** False while the capability behind it has not shipped. */
  released: boolean;
  unavailableReason?: string;
};

export const WORK_VIEWS: readonly WorkViewDefinition[] = [
  {
    key: "chaseToday",
    label: "今日要追",
    description: "客戶仍未提供的文件，並且限期在三十天內。",
    released: true,
  },
  {
    key: "newlyReceived",
    label: "新收到文件",
    description: "客戶已提交、尚未有人覆核的文件。",
    released: true,
  },
  {
    key: "awaitingMyReview",
    label: "等我覆核",
    description: "由你負責或覆核的案件中，已收到待覆核的文件。",
    released: true,
  },
  {
    key: "readyToFile",
    label: "可以交件",
    description: "已批准當前套件、付款及文件均已核實，可以記錄人手交件。",
    released: false,
    unavailableReason:
      "套件批准及付款核實資料尚未接通，暫不能判定哪些案件可以交件。請開啟案件逐項覆核；空白不代表沒有工作。",
  },
  {
    key: "returnsAndExceptions",
    label: "回件與異常",
    // A complete scoped server snapshot is required to claim the queue is empty.
    description: "已登記回件中的待核對、拒件與部分回件；內部伺服器同步仍待設定。",
    released: false,
    unavailableReason:
      "回件清單尚未取得完整的當前伺服器資料。" + "請開啟案件核對人手回件；空白不代表沒有異常。",
  },
];

/** How close a deadline has to be before it is today's problem. */
export const CHASE_HORIZON_DAYS = 30;

export type WorkViewRow = {
  caseId: string;
  companyName: string;
  returnYear: number;
  filingDueDate: string;
  daysRemaining: number;
  ownerName: string;
  /** Why this row is here, in words a staff member can act on. */
  blocker: string;
};

export type WorkViewResult = {
  definition: WorkViewDefinition;
  rows: WorkViewRow[];
};

function isMutable(case_: AnnualReturnCase): boolean {
  return (
    case_.currentStatus !== "Filed" &&
    case_.currentStatus !== "Completed" &&
    !case_.lockedAt &&
    !case_.completedAt
  );
}

function baseRow(case_: AnnualReturnCase, today: string, blocker: string): WorkViewRow {
  return {
    caseId: case_.id,
    companyName: case_.companyName,
    returnYear: case_.returnYear,
    filingDueDate: case_.filingDueDate,
    daysRemaining: daysBetween(today, case_.filingDueDate),
    ownerName: case_.ownerName,
    blocker,
  };
}

export function deriveWorkViews(
  cases: readonly AnnualReturnCase[],
  today: string,
  viewer: { userId: string | null },
  readiness?: {
    complete: boolean;
    byCaseId: ReadonlyMap<string, Pick<ReadinessResult, "canRecordSubmission">>;
  },
  returnExceptions?: {
    complete: boolean;
    openCountByCaseId: ReadonlyMap<string, number>;
  },
): WorkViewResult[] {
  const mutable = cases.filter(isMutable);

  const chaseToday: WorkViewRow[] = [];
  const newlyReceived: WorkViewRow[] = [];
  const awaitingMyReview: WorkViewRow[] = [];
  const readyToFile: WorkViewRow[] = [];
  const returnsAndExceptions: WorkViewRow[] = [];

  for (const case_ of mutable) {
    const summary = outstandingSummary(case_);
    const received = awaitingInternalReview(case_.checklist ?? []);
    const daysRemaining = daysBetween(today, case_.filingDueDate);

    if (summary.kind === "outstanding" && daysRemaining <= CHASE_HORIZON_DAYS) {
      chaseToday.push(
        baseRow(
          case_,
          today,
          // Named, not counted: "3 documents" does not tell anyone what to ask for.
          summary.items
            .map((item) => ("itemLabel" in item ? String(item.itemLabel) : "文件"))
            .join("、"),
        ),
      );
    }

    if (received.length > 0) {
      const blocker = `${received.length} 份文件待覆核`;
      newlyReceived.push(baseRow(case_, today, blocker));
      // Owner or reviewer, matching who getAnnualReturnActionPermission lets act
      // on the case -- so this tab never shows work the viewer cannot do.
      if (
        viewer.userId &&
        (case_.ownerId === viewer.userId || case_.reviewerId === viewer.userId)
      ) {
        awaitingMyReview.push(baseRow(case_, today, blocker));
      }
    }

    // The package approval and verified payment are not on AnnualReturnCase.
    // A complete server snapshot is required; a checklist-only case is never
    // described as ready to file.
    if (readiness?.complete && readiness.byCaseId.get(case_.id)?.canRecordSubmission) {
      readyToFile.push(baseRow(case_, today, "套件已批准，待人手交件"));
    }
  }

  if (returnExceptions?.complete) {
    // A return can arrive after a case was filed or locked. Never hide it.
    for (const case_ of cases) {
      const count = returnExceptions.openCountByCaseId.get(case_.id) ?? 0;
      if (count > 0) {
        returnsAndExceptions.push(baseRow(case_, today, count + " 份回件待核對或處理"));
      }
    }
  }

  const byUrgency = (left: WorkViewRow, right: WorkViewRow) =>
    left.daysRemaining - right.daysRemaining || left.companyName.localeCompare(right.companyName);

  const rowsByKey: Record<WorkViewKey, WorkViewRow[]> = {
    chaseToday: chaseToday.sort(byUrgency),
    newlyReceived: newlyReceived.sort(byUrgency),
    awaitingMyReview: awaitingMyReview.sort(byUrgency),
    readyToFile: readyToFile.sort(byUrgency),
    returnsAndExceptions: returnsAndExceptions.sort(byUrgency),
  };

  return WORK_VIEWS.map((definition) => ({
    definition:
      (definition.key === "readyToFile" && readiness?.complete) ||
      (definition.key === "returnsAndExceptions" && returnExceptions?.complete)
        ? { ...definition, released: true, unavailableReason: undefined }
        : definition,
    rows: rowsByKey[definition.key],
  }));
}
