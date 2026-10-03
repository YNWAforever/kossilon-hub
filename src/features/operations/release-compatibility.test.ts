import { describe, expect, it } from "vitest";
import {
  evaluateHistoricalReleaseCompatibility,
  type ReleaseCompatibilityInput,
} from "./release-compatibility";

function approvedInput(): ReleaseCompatibilityInput {
  const approved = {
    id: "reviewed-release",
    targetEnvironmentId: "staging/project/branch/database",
    payloadSha256: "a".repeat(64),
    manifestSha256: "b".repeat(64),
    compatibleBuildSha: "c".repeat(40),
    expectedHistoricalLedgerSha256: "d".repeat(64),
    expectedPostReleaseCatalogSha256: "e".repeat(64),
  };
  return {
    buildSha: approved.compatibleBuildSha,
    targetEnvironmentId: approved.targetEnvironmentId,
    approved,
    receipt: {
      id: approved.id,
      payloadSha256: approved.payloadSha256,
      manifestSha256: approved.manifestSha256,
    },
    historicalLedgerSha256: approved.expectedHistoricalLedgerSha256,
    postReleaseCatalogSha256: approved.expectedPostReleaseCatalogSha256,
    expectedRuntimeContractKeys: ["columns", "constraints", "valid-indexes", "tenant-access"],
    runtimeContracts: ["columns", "constraints", "valid-indexes", "tenant-access"].map((key) => ({
      key,
      matches: true,
    })),
  };
}

describe("approved historical release compatibility", () => {
  it("exact approved receipt allows the application schema but never the ordinary migrator", () => {
    expect(evaluateHistoricalReleaseCompatibility(approvedInput())).toEqual({
      applicationSchemaCompatible: true,
      ordinaryMigrationAllowed: false,
      historyState: "divergent",
      blockers: [],
    });
  });

  it("a database receipt alone never grants compatibility", () => {
    const input = approvedInput();
    input.approved = null;
    const result = evaluateHistoricalReleaseCompatibility(input);
    expect(result.applicationSchemaCompatible).toBe(false);
    expect(result.blockers).toContain("approved-release-missing");
  });

  it.each([
    [
      "payload",
      (input: ReleaseCompatibilityInput) => {
        input.receipt!.payloadSha256 = "f".repeat(64);
      },
    ],
    [
      "manifest",
      (input: ReleaseCompatibilityInput) => {
        input.receipt!.manifestSha256 = "f".repeat(64);
      },
    ],
    [
      "build",
      (input: ReleaseCompatibilityInput) => {
        input.buildSha = "f".repeat(40);
      },
    ],
    [
      "ledger",
      (input: ReleaseCompatibilityInput) => {
        input.historicalLedgerSha256 = "f".repeat(64);
      },
    ],
    [
      "post-release catalog",
      (input: ReleaseCompatibilityInput) => {
        input.postReleaseCatalogSha256 = "f".repeat(64);
      },
    ],
    [
      "environment",
      (input: ReleaseCompatibilityInput) => {
        input.targetEnvironmentId = "other/environment";
      },
    ],
    [
      "missing receipt",
      (input: ReleaseCompatibilityInput) => {
        input.receipt = null;
      },
    ],
    [
      "unknown receipt",
      (input: ReleaseCompatibilityInput) => {
        input.receipt!.id = "unknown-release";
      },
    ],
    [
      "failed contract",
      (input: ReleaseCompatibilityInput) => {
        input.runtimeContracts[0].matches = false;
      },
    ],
    [
      "empty observed contracts",
      (input: ReleaseCompatibilityInput) => {
        input.runtimeContracts = [];
      },
    ],
    [
      "empty reviewed contract set",
      (input: ReleaseCompatibilityInput) => {
        input.expectedRuntimeContractKeys = [];
      },
    ],
    [
      "missing reviewed key",
      (input: ReleaseCompatibilityInput) => {
        input.runtimeContracts.pop();
      },
    ],
    [
      "duplicate observed key",
      (input: ReleaseCompatibilityInput) => {
        input.runtimeContracts.push(input.runtimeContracts[0]);
      },
    ],
    [
      "unknown observed key",
      (input: ReleaseCompatibilityInput) => {
        input.runtimeContracts.push({ key: "unknown", matches: true });
      },
    ],
    [
      "duplicate reviewed key",
      (input: ReleaseCompatibilityInput) => {
        input.expectedRuntimeContractKeys.push("columns");
      },
    ],
    [
      "invalid digest",
      (input: ReleaseCompatibilityInput) => {
        input.approved!.payloadSha256 = "not-a-hash";
        input.receipt!.payloadSha256 = "not-a-hash";
      },
    ],
    [
      "missing build identity",
      (input: ReleaseCompatibilityInput) => {
        input.buildSha = "";
        input.approved!.compatibleBuildSha = "";
      },
    ],
    [
      "empty target identity",
      (input: ReleaseCompatibilityInput) => {
        input.targetEnvironmentId = "";
        input.approved!.targetEnvironmentId = "";
      },
    ],
  ])("refuses %s without releasing migration authority", (_label, change) => {
    const input = approvedInput();
    change(input);
    const result = evaluateHistoricalReleaseCompatibility(input);
    expect(result.applicationSchemaCompatible).toBe(false);
    expect(result.ordinaryMigrationAllowed).toBe(false);
    expect(result.historyState).toBe("divergent");
    expect(result.blockers.length).toBeGreaterThan(0);
  });
});
