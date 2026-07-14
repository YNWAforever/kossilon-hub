import { describe, expect, it } from "vitest";
import { rankAssignmentCandidates } from "./assignment";
import type { AssignmentInput, StaffCandidate } from "./types";

const baseCandidate: StaffCandidate = {
  staffId: "amy-id",
  userId: "amy-user",
  role: "Staff",
  teamIds: ["filing-team"],
  active: true,
  available: true,
  capacityPoints: 100,
  skills: [{ key: "annual-return-review", proficiency: 4 }],
  activeWork: [],
  caseIds: [],
};

const input: AssignmentInput = {
  assignmentTarget: "owner",
  requiredRole: "Staff",
  requiredSkillKey: "annual-return-review",
  teamId: "filing-team",
  caseId: "case-1",
  ownerId: null,
  reviewerId: null,
  separationOfDuties: true,
  candidates: [
    baseCandidate,
    {
      ...baseCandidate,
      staffId: "mei-id",
      userId: "mei-user",
      skills: [{ key: "annual-return-review", proficiency: 3 }],
    },
  ],
};

describe("assignment recommendations", () => {
  it("ranks eligible staff and explains score factors", () => {
    const recommendations = rankAssignmentCandidates(input);

    expect(recommendations.map((item) => item.staffId)).toEqual(["amy-id", "mei-id"]);
    expect(recommendations[0]).toMatchObject({
      rank: 1,
      factors: {
        skillProficiency: 4,
        workloadPoints: 0,
        capacityUtilization: 0,
      },
    });
  });

  it("excludes inactive, unavailable, wrong-team, wrong-role, unskilled, and conflicted staff", () => {
    const excluded: StaffCandidate[] = [
      { ...baseCandidate, staffId: "inactive", active: false },
      { ...baseCandidate, staffId: "unavailable", available: false },
      { ...baseCandidate, staffId: "wrong-team", teamIds: ["other-team"] },
      { ...baseCandidate, staffId: "wrong-role", role: "Client" },
      { ...baseCandidate, staffId: "unskilled", skills: [] },
      { ...baseCandidate, staffId: "reviewer", userId: "reviewer-user" },
    ];

    expect(
      rankAssignmentCandidates({
        ...input,
        reviewerId: "reviewer-user",
        candidates: [...excluded, baseCandidate],
      }).map((item) => item.staffId),
    ).toEqual(["amy-id"]);
  });
  it("excludes the opposite assignment role when duties must be separated", () => {
    const existingOwner = { ...baseCandidate, staffId: "owner", userId: "owner-user" };
    const existingReviewer = { ...baseCandidate, staffId: "reviewer", userId: "reviewer-user" };
    const independent = { ...baseCandidate, staffId: "independent", userId: "independent-user" };

    expect(
      rankAssignmentCandidates({
        ...input,
        reviewerId: "reviewer-user",
        candidates: [existingReviewer, independent],
      }).map((item) => item.staffId),
    ).toEqual(["independent"]);
    expect(
      rankAssignmentCandidates({
        ...input,
        assignmentTarget: "reviewer",
        ownerId: "owner-user",
        candidates: [existingOwner, independent],
      }).map((item) => item.staffId),
    ).toEqual(["independent"]);
  });

  it("weights breached and at-risk work more heavily than ordinary work", () => {
    const ordinary: StaffCandidate = {
      ...baseCandidate,
      staffId: "ordinary-id",
      activeWork: [{ threshold: "none", effortPoints: 10 }],
    };
    const urgent: StaffCandidate = {
      ...baseCandidate,
      staffId: "urgent-id",
      activeWork: [
        { threshold: "warning", effortPoints: 5 },
        { threshold: "breach", effortPoints: 5 },
      ],
    };

    const recommendations = rankAssignmentCandidates({
      ...input,
      candidates: [urgent, ordinary],
    });

    expect(recommendations.map((item) => item.staffId)).toEqual(["ordinary-id", "urgent-id"]);
    expect(recommendations[1]?.factors.workloadPoints).toBeGreaterThan(
      recommendations[0]?.factors.workloadPoints ?? 0,
    );
  });

  it("penalizes capacity utilization and rewards case continuity", () => {
    const overloaded: StaffCandidate = {
      ...baseCandidate,
      staffId: "overloaded-id",
      capacityPoints: 20,
      activeWork: [{ threshold: "none", effortPoints: 20 }],
    };
    const continuity: StaffCandidate = {
      ...baseCandidate,
      staffId: "continuity-id",
      activeWork: [{ threshold: "none", effortPoints: 5 }],
      caseIds: ["case-1"],
    };

    expect(
      rankAssignmentCandidates({ ...input, candidates: [overloaded, continuity] }).map(
        (item) => item.staffId,
      ),
    ).toEqual(["continuity-id", "overloaded-id"]);
  });

  it("breaks exact ties by stable staff id", () => {
    expect(
      rankAssignmentCandidates({
        ...input,
        candidates: [
          { ...baseCandidate, staffId: "z-id" },
          { ...baseCandidate, staffId: "a-id" },
        ],
      }).map((item) => item.staffId),
    ).toEqual(["a-id", "z-id"]);
  });

  it("does not mutate input candidates", () => {
    const candidates = structuredClone(input.candidates);
    rankAssignmentCandidates(input);
    expect(input.candidates).toEqual(candidates);
  });
});
