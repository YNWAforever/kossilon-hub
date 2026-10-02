import { daysBetween } from "@/lib/date-math";
import { awaitingInternalReview, outstandingSummary } from "./outstanding";
import type { AnnualReturnCase } from "./types";
import { readinessForCase } from "./readiness";

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
    label: "可準備交件",
    description: "當前文件及付款證據齊備，可準備人手批准套件；尚未外部提交。",
    released: true,
  },
  {
    key: "returnsAndExceptions",
    label: "回件與異常",
    description:
      "人工登記回件、未知結果及待人工提交的批准套件。外部連接器未配置；空白只代表範圍內沒有內部待處理紀錄，不代表外部沒有異常。",
    released: true,
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
): WorkViewResult[] {
  const mutable = cases.filter(isMutable);

  const chaseToday: WorkViewRow[] = [];
  const newlyReceived: WorkViewRow[] = [];
  const awaitingMyReview: WorkViewRow[] = [];
  const readyToFile: WorkViewRow[] = [];

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

    // Nothing outstanding and nothing waiting on us. `unknown` is excluded on
    // purpose: a case whose checklist we cannot see is not evidence of
    // readiness, and putting it here would invite filing on an empty list.
    if (readinessForCase(case_).readyForApproval) {
      readyToFile.push(baseRow(case_, today, "文件及付款已核對；待套件批准及外部提交"));
    }
  }

  const byUrgency = (left: WorkViewRow, right: WorkViewRow) =>
    left.daysRemaining - right.daysRemaining || left.companyName.localeCompare(right.companyName);

  const rowsByKey: Record<WorkViewKey, WorkViewRow[]> = {
    chaseToday: chaseToday.sort(byUrgency),
    newlyReceived: newlyReceived.sort(byUrgency),
    awaitingMyReview: awaitingMyReview.sort(byUrgency),
    readyToFile: readyToFile.sort(byUrgency),
    returnsAndExceptions: cases
      .filter((c) => {
        const h = c.handoffExceptions;
        return h && Object.values(h).some((n) => n > 0);
      })
      .map((c) => {
        const h = c.handoffExceptions!;
        return baseRow(
          c,
          today,
          `${h.unreconciled} 筆待核對回件 · ${h.rejected} 筆拒收／部分／未匹配 · ${h.unknown} 筆未知 · ${h.awaitingManual} 筆待人工提交`,
        );
      })
      .sort(byUrgency),
  };

  return WORK_VIEWS.map((definition) => ({ definition, rows: rowsByKey[definition.key] }));
}
