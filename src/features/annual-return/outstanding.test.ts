import { describe, expect, it } from "vitest";
import {
  awaitingInternalReview,
  hasOutstandingClientWork,
  outstandingSummary,
  shouldChaseClient,
  isAwaitingInternalReview,
  isOutstandingForClient,
  outstandingForClient,
  type ChecklistItemState,
} from "./outstanding";
import type { ChecklistStatus } from "./types";

function item(status: ChecklistStatus, required = true): ChecklistItemState & { label: string } {
  return { status, required, label: `${status}${required ? "" : " (optional)"}` };
}

describe("isOutstandingForClient", () => {
  it("counts a document the client has not sent", () => {
    expect(isOutstandingForClient(item("Missing"))).toBe(true);
  });

  it("counts a document that came back wrong, because a replacement is genuinely needed", () => {
    expect(isOutstandingForClient(item("Rejected"))).toBe(true);
  });

  // The defect. Received means the client sent it and staff have not reviewed it
  // yet; asking for it again is asking for something already in hand.
  it("does not count a document the client has already sent", () => {
    expect(isOutstandingForClient(item("Received"))).toBe(false);
  });

  it("does not count a verified document", () => {
    expect(isOutstandingForClient(item("Verified"))).toBe(false);
  });

  it("never chases a client for an optional item", () => {
    expect(isOutstandingForClient(item("Missing", false))).toBe(false);
  });
});

describe("isAwaitingInternalReview", () => {
  it("is exactly the received-and-unreviewed set", () => {
    expect(isAwaitingInternalReview(item("Received"))).toBe(true);
    expect(isAwaitingInternalReview(item("Missing"))).toBe(false);
    expect(isAwaitingInternalReview(item("Verified"))).toBe(false);
    expect(isAwaitingInternalReview(item("Rejected"))).toBe(false);
  });

  // An optional document someone sent still has to be looked at; the work is
  // ours regardless of whether we were entitled to ask for it.
  it("includes an optional item, because reviewing it is still our work", () => {
    expect(isAwaitingInternalReview(item("Received", false))).toBe(true);
  });
});

describe("the two sets together", () => {
  const checklist = [
    item("Missing"),
    item("Received"),
    item("Verified"),
    item("Rejected"),
    item("Missing", false),
  ];

  it("splits the work so nothing is on both sides at once", () => {
    const client = outstandingForClient(checklist);
    const ours = awaitingInternalReview(checklist);
    expect(client.map((entry) => entry.status).sort()).toEqual(["Missing", "Rejected"]);
    expect(ours.map((entry) => entry.status)).toEqual(["Received"]);
    for (const entry of client) expect(ours).not.toContain(entry);
  });

  it("preserves the caller's own item shape rather than narrowing it", () => {
    // The client portal projects a narrower checklist than the staff one, and
    // these predicates must not force it to widen.
    expect(outstandingForClient(checklist)[0].label).toBe("Missing");
  });
});

describe("hasOutstandingClientWork", () => {
  // deriveProductionFollowUpDrafts had no outstanding-work test at all, so every
  // mutable case produced a chase draft -- including ones with nothing to ask for.
  it("is false when the client has sent everything and we are reviewing it", () => {
    expect(hasOutstandingClientWork({ checklist: [item("Received"), item("Verified")] })).toBe(
      false,
    );
  });

  it("is true while anything is still missing or rejected", () => {
    expect(hasOutstandingClientWork({ checklist: [item("Received"), item("Missing")] })).toBe(true);
    expect(hasOutstandingClientWork({ checklist: [item("Rejected")] })).toBe(true);
  });

  it("is false for a case with no checklist at all rather than throwing", () => {
    expect(hasOutstandingClientWork({})).toBe(false);
    expect(hasOutstandingClientWork({ checklist: [] })).toBe(false);
  });

  it("is false when only optional items are missing", () => {
    expect(hasOutstandingClientWork({ checklist: [item("Missing", false)] })).toBe(false);
  });
});

describe("outstandingSummary", () => {
  it("separates nothing-outstanding from we-do-not-know", () => {
    expect(outstandingSummary({ checklist: [item("Verified")] })).toEqual({ kind: "none" });
    expect(outstandingSummary({ checklist: [] })).toEqual({ kind: "unknown" });
    expect(outstandingSummary({})).toEqual({ kind: "unknown" });
  });

  it("returns the outstanding items themselves so a caller can name them", () => {
    const summary = outstandingSummary({ checklist: [item("Missing"), item("Received")] });
    expect(summary.kind).toBe("outstanding");
    expect(summary.kind === "outstanding" && summary.items).toHaveLength(1);
  });
});

describe("shouldChaseClient", () => {
  it("suppresses the chase only when nothing is genuinely outstanding", () => {
    expect(shouldChaseClient({ checklist: [item("Received"), item("Verified")] })).toBe(false);
  });

  it("still chases while something is missing", () => {
    expect(shouldChaseClient({ checklist: [item("Missing")] })).toBe(true);
  });

  // A case with no checklist rows is an anomaly -- createCase expands a template
  // into items, so a real case has them. Reading that as "nothing outstanding"
  // would trade a client being over-chased for a case that silently stops being
  // chased before a statutory deadline, which is the worse error.
  it("still chases a case whose checklist we cannot see, rather than going quiet", () => {
    expect(shouldChaseClient({ checklist: [] })).toBe(true);
    expect(shouldChaseClient({})).toBe(true);
  });
});
