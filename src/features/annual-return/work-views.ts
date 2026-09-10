import { daysBetween } from "@/lib/date-math";
import { awaitingInternalReview, outstandingSummary } from "./outstanding";
import type { AnnualReturnCase } from "./types";

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
    description: "所有需要的文件已齊備並覆核完成。",
    released: true,
  },
  {
    key: "returnsAndExceptions",
    label: "回件與異常",
    // Phase E built the model behind this -- package_handoffs, handoff_returns,
    // the reconciliation rule and the destination adapter -- but the destination
    // itself is the firm's internal server, and its protocol, address and rights
    // are not known to this repository.
    //
    // So the view stays unreleased, and the reason names the specific thing that
    // is missing rather than a phase number. An empty list here would read as
    // "no exceptions", which is a claim nothing in this build can make: no
    // package has been transmitted, so no return can have arrived, so the
    // absence of exceptions is the absence of the whole process.
    description: "外部交件後的回件核對。",
    released: false,
    unavailableReason:
      "回件核對需要外部交件連接器（BLOCKED_INTEGRATION: external-handoff-destination）。" +
      "尚未有任何套件成功交出，因此不會有回件。現時請沿用人手記錄；這裡的空白不代表沒有異常。",
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
    if (summary.kind === "none" && received.length === 0) {
      readyToFile.push(baseRow(case_, today, "文件齊備"));
    }
  }

  const byUrgency = (left: WorkViewRow, right: WorkViewRow) =>
    left.daysRemaining - right.daysRemaining || left.companyName.localeCompare(right.companyName);

  const rowsByKey: Record<WorkViewKey, WorkViewRow[]> = {
    chaseToday: chaseToday.sort(byUrgency),
    newlyReceived: newlyReceived.sort(byUrgency),
    awaitingMyReview: awaitingMyReview.sort(byUrgency),
    readyToFile: readyToFile.sort(byUrgency),
    // Deliberately empty, and the definition says why rather than letting an
    // empty list be read as "no exceptions".
    returnsAndExceptions: [],
  };

  return WORK_VIEWS.map((definition) => ({ definition, rows: rowsByKey[definition.key] }));
}
