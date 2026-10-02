import { describe, expect, it } from "vitest";
import type { AnnualReturnCase, AnnualReturnChecklistItem, ChecklistStatus } from "./types";
import { deriveWorkViews, WORK_VIEWS, type WorkViewKey } from "./work-views";

const TODAY = "2026-09-10";
const ME = "11111111-1111-4111-8111-111111111111";
const SOMEONE_ELSE = "22222222-2222-4222-8222-222222222222";

let counter = 0;

function item(status: ChecklistStatus, label = "身分證明文件"): AnnualReturnChecklistItem {
  counter += 1;
  return {
    id: `item-${counter}`,
    caseId: "case-1",
    itemLabel: label,
    required: true,
    status,
    dueDate: TODAY,
    receivedAt: null,
    verifiedAt: null,
    documentId: null,
  };
}

function makeCase(overrides: Partial<AnnualReturnCase> = {}): AnnualReturnCase {
  counter += 1;
  return {
    id: `case-${counter}`,
    companyId: "company-1",
    companyTeamId: "team-1",
    companyName: `Company ${counter}`,
    returnYear: 2026,
    madeUpDate: "2026-06-30",
    filingDueDate: "2026-09-20",
    currentStatus: "Upcoming",
    riskLevel: "green",
    ownerId: ME,
    ownerName: "Ada Chan",
    reviewerId: null,
    reviewerName: null,
    remindersSent: 0,
    filingReference: null,
    confirmationDocumentId: null,
    lockedAt: null,
    completedAt: null,
    checklist: [],
    payment: null,
    ...overrides,
  } as AnnualReturnCase;
}

function view(results: ReturnType<typeof deriveWorkViews>, key: WorkViewKey) {
  const found = results.find((result) => result.definition.key === key);
  if (!found) throw new Error(`no view ${key}`);
  return found;
}

describe("deriveWorkViews", () => {
  it("does not offer an unpaid Kowloon-style case as ready to file", () => {
    const unpaid = makeCase({ checklist: [item("Verified")], payment: null });
    expect(view(deriveWorkViews([unpaid], TODAY, { userId: ME }), "readyToFile").rows).toEqual([]);
  });
  it("returns all five views in a stable order, released or not", () => {
    const results = deriveWorkViews([], TODAY, { userId: ME });
    expect(results.map((result) => result.definition.key)).toEqual(
      WORK_VIEWS.map((definition) => definition.key),
    );
  });

  it("chases only what the client has not sent, and only near a deadline", () => {
    const near = makeCase({ checklist: [item("Missing")], filingDueDate: "2026-09-20" });
    const far = makeCase({ checklist: [item("Missing")], filingDueDate: "2027-06-01" });
    const results = deriveWorkViews([near, far], TODAY, { userId: ME });
    expect(view(results, "chaseToday").rows.map((row) => row.caseId)).toEqual([near.id]);
  });

  // The B-2 rule, carried into the view: a document already sent is our work.
  it("does not chase a case whose only outstanding item has been received", () => {
    const case_ = makeCase({ checklist: [item("Received")] });
    const results = deriveWorkViews([case_], TODAY, { userId: ME });
    expect(view(results, "chaseToday").rows).toHaveLength(0);
    expect(view(results, "newlyReceived").rows.map((row) => row.caseId)).toEqual([case_.id]);
  });

  it("names what is missing rather than counting it", () => {
    const case_ = makeCase({ checklist: [item("Missing", "CDD"), item("Missing", "地址證明")] });
    const results = deriveWorkViews([case_], TODAY, { userId: ME });
    expect(view(results, "chaseToday").rows[0].blocker).toBe("CDD、地址證明");
  });

  it("shows me only the review work I am allowed to do", () => {
    const mine = makeCase({ ownerId: ME, checklist: [item("Received")] });
    const theirs = makeCase({ ownerId: SOMEONE_ELSE, checklist: [item("Received")] });
    const asReviewer = makeCase({
      ownerId: SOMEONE_ELSE,
      reviewerId: ME,
      checklist: [item("Received")],
    });

    const results = deriveWorkViews([mine, theirs, asReviewer], TODAY, { userId: ME });
    expect(view(results, "newlyReceived").rows).toHaveLength(3);
    expect(
      view(results, "awaitingMyReview")
        .rows.map((row) => row.caseId)
        .sort(),
    ).toEqual([mine.id, asReviewer.id].sort());
  });

  it("calls a case ready only when nothing is outstanding and nothing waits on us", () => {
    const ready = makeCase({
      checklist: [item("Verified")],
      readiness: {
        sourceVersion: "verified-local-snapshot",
        readyToPrepare: true,
        readyForApproval: true,
        readyToTransmit: false,
        manifestPayload: null,
        blockers: [],
      },
    });
    const waiting = makeCase({ checklist: [item("Received")] });
    const results = deriveWorkViews([ready, waiting], TODAY, { userId: ME });
    expect(view(results, "readyToFile").rows.map((row) => row.caseId)).toEqual([ready.id]);
  });

  // A case whose checklist we cannot see is not evidence of readiness, and
  // putting it here would invite filing against an empty list.
  it("does not call a case with no checklist rows ready to file", () => {
    const results = deriveWorkViews([makeCase({ checklist: [] })], TODAY, { userId: ME });
    expect(view(results, "readyToFile").rows).toHaveLength(0);
  });

  it("leaves filed and locked cases out of every view", () => {
    const filed = makeCase({ currentStatus: "Filed", checklist: [item("Missing")] });
    const locked = makeCase({ lockedAt: "2026-09-01T00:00:00.000Z", checklist: [item("Missing")] });
    const results = deriveWorkViews([filed, locked], TODAY, { userId: ME });
    for (const result of results) expect(result.rows).toHaveLength(0);
  });

  it("orders each view by how close the deadline is", () => {
    const later = makeCase({ filingDueDate: "2026-09-25", checklist: [item("Missing")] });
    const sooner = makeCase({ filingDueDate: "2026-09-12", checklist: [item("Missing")] });
    const results = deriveWorkViews([later, sooner], TODAY, { userId: ME });
    expect(view(results, "chaseToday").rows.map((row) => row.caseId)).toEqual([
      sooner.id,
      later.id,
    ]);
  });

  it("releases actual manual return reads while keeping connector absence explicit", () => {
    const results = deriveWorkViews([makeCase({ checklist: [item("Missing")] })], TODAY, {
      userId: ME,
    });
    const returns = view(results, "returnsAndExceptions");
    expect(returns.definition.released).toBe(true);
    expect(returns.definition.description).toContain("人工");
    expect(returns.definition.description).toContain("未配置");
    expect(returns.rows).toHaveLength(0);
  });

  it("keeps actual unresolved return facts visible even after a case closes", () => {
    const case_ = makeCase({
      currentStatus: "Filed",
      handoffExceptions: { unreconciled: 1, rejected: 1, unknown: 0, awaitingManual: 0 },
    });
    const returns = view(deriveWorkViews([case_], TODAY, { userId: ME }), "returnsAndExceptions");
    expect(returns.rows).toHaveLength(1);
    expect(returns.rows[0].blocker).toContain("1 筆待核對");
  });

  it("shows no personal review queue for a viewer with no staff identity", () => {
    const case_ = makeCase({ checklist: [item("Received")] });
    const results = deriveWorkViews([case_], TODAY, { userId: null });
    expect(view(results, "newlyReceived").rows).toHaveLength(1);
    expect(view(results, "awaitingMyReview").rows).toHaveLength(0);
  });
});
