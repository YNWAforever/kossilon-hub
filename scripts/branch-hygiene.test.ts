import { describe, expect, it } from "vitest";

import { planBranchCleanup } from "./branch-hygiene";

const branch = (name: string, sha = "a".repeat(40)) => ({ name, sha, protected: false });

describe("branch cleanup planning", () => {
  it("classifies merged, open-PR, unmerged and protected branches", () => {
    const plan = planBranchCleanup({
      branches: [
        branch("main"),
        branch("demo"),
        { ...branch("protected-by-rule"), protected: true },
        branch("merged/one"),
        branch("merged/two"),
        branch("open/pr"),
        branch("unmerged/one"),
        branch("missing/compare"),
        branch("retain/me"),
      ],
      aheadBy: {
        "merged/one": 0,
        "merged/two": 0,
        "open/pr": 0,
        "unmerged/one": 3,
        "retain/me": 0,
      },
      openPrHeads: new Set(["open/pr"]),
      retain: ["retain/me"],
    });

    expect(plan.safeToDelete).toEqual(["merged/one", "merged/two"]);
    expect(plan.openPullRequests).toEqual(["open/pr"]);
    expect(plan.unmerged).toEqual(["missing/compare", "unmerged/one"]);
    expect(plan.retained).toEqual(["demo", "main", "protected-by-rule", "retain/me"]);
  });

  it("fails closed when a branch has no compare data", () => {
    const plan = planBranchCleanup({
      branches: [branch("unknown")],
      aheadBy: {},
      openPrHeads: new Set(),
    });

    expect(plan.safeToDelete).toEqual([]);
    expect(plan.unmerged).toEqual(["unknown"]);
  });

  it("never treats main or demo as deletable even with zero ahead", () => {
    const plan = planBranchCleanup({
      branches: [branch("main"), branch("demo")],
      aheadBy: { main: 0, demo: 0 },
      openPrHeads: new Set(),
    });

    expect(plan.safeToDelete).toEqual([]);
    expect(plan.retained).toEqual(["demo", "main"]);
  });
});
