import { describe, expect, it } from "vitest";
import {
  assignmentLabels,
  activeAssignmentOptions,
  caseBusinessContext,
} from "./assignment-labels";
import type { AnnualReturnCase } from "@/features/annual-return/types";

describe("actionable work assignment identity and business context", () => {
  const options = [
    {
      userId: "20000000-0000-0000-0000-000000000001",
      displayName: "Amy Chan",
      teamName: "Annual Return",
      active: true,
      workload: 2,
    },
    {
      userId: "20000000-0000-0000-0000-000000000002",
      displayName: "Amy Chan",
      teamName: "Evidence",
      active: true,
      workload: 3,
    },
    {
      userId: "20000000-0000-0000-0000-000000000003",
      displayName: "Ken Wong",
      teamName: "Evidence",
      active: false,
      workload: 0,
    },
  ];
  it("uses real names and teams for same names with identical UUID prefixes", () => {
    const labels = assignmentLabels(options);
    expect(labels.get(options[0].userId)).toContain("Amy Chan · Annual Return");
    expect(labels.get(options[1].userId)).toContain("Amy Chan · Evidence");
    expect(new Set(labels.values()).size).toBe(3);
    expect([...labels.values()].some((s) => s.includes("Staff 20000000"))).toBe(false);
    const collisions = assignmentLabels([
      { ...options[0], teamName: "Team" },
      { ...options[1], teamName: "Team" },
    ]);
    expect(collisions.get(options[0].userId)).not.toEqual(collisions.get(options[1].userId));
  });
  it("never offers inactive assignees", () =>
    expect(activeAssignmentOptions(options).map((o) => o.userId)).toEqual(
      options.slice(0, 2).map((o) => o.userId),
    ));
  it("keeps payment business blockers independently of an on-track SLA", () => {
    const context = caseBusinessContext(
      {
        id: "case",
        filingDueDate: "2026-11-01",
        currentStatus: "Payment pending",
        readiness: {
          sourceVersion: "v",
          blockers: [
            {
              code: "payment_not_received",
              stage: "prepare",
              message: "Payment missing",
              action: "/payments",
            },
          ],
        },
      } as AnnualReturnCase,
      "2026-10-01",
    );
    expect(context?.blockers.map((b) => b.code)).toEqual(["payment_not_received"]);
  });
  it("shows legal overdue when evidence is complete, and unknown when readiness is missing", () => {
    const case_ = {
      id: "case",
      filingDueDate: "2026-09-01",
      currentStatus: "Ready to file",
      readiness: { sourceVersion: "v", blockers: [] },
    } as unknown as AnnualReturnCase;
    expect(caseBusinessContext(case_, "2026-10-01")?.blockers.map((b) => b.code)).toEqual([
      "statutory_overdue",
    ]);
    expect(caseBusinessContext({ ...case_, readiness: undefined }, "2026-10-01")).toBeNull();
  });
});
