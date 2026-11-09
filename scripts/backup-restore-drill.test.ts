import { describe, expect, it } from "vitest";

import { drillBranchName, restoreProblems } from "./backup-restore-drill";

const facts = {
  ledgerPresent: true,
  ledgerCount: 67,
  requestAccessTablePresent: true,
  maintenanceRuns: 120,
  companies: 4,
};

describe("backup restore drill", () => {
  it("derives a stable, timestamped branch name", () => {
    const name = drillBranchName(new Date("2026-11-09T14:50:28.000Z"));
    expect(name).toBe("backup-drill-20261109-145028");
    expect(name.length).toBeLessThan(32);
  });

  it("accepts a complete restored dataset", () => {
    expect(restoreProblems(facts)).toEqual([]);
  });

  it("fails closed on missing ledger, latest table or data", () => {
    expect(restoreProblems({ ...facts, ledgerPresent: false })).toContain(
      "schema_migrations missing",
    );
    expect(restoreProblems({ ...facts, ledgerCount: 66 })).toContain("ledger only has 66 ids");
    expect(restoreProblems({ ...facts, requestAccessTablePresent: false })).toContain(
      "request_access_requests missing",
    );
    expect(restoreProblems({ ...facts, maintenanceRuns: 0 })).toContain("no maintenance_runs data");
    expect(restoreProblems({ ...facts, companies: 0 })).toContain("no companies data");
  });
});
