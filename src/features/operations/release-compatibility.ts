export type ReleaseReceipt = {
  id: string;
  payloadSha256: string;
  manifestSha256: string;
};

export type ApprovedRelease = {
  id: string;
  targetEnvironmentId: string;
  payloadSha256: string;
  manifestSha256: string;
  compatibleBuildSha: string;
  expectedHistoricalLedgerSha256: string;
  expectedPostReleaseCatalogSha256: string;
};

export type ReleaseCompatibilityInput = {
  buildSha: string;
  targetEnvironmentId: string;
  approved: ApprovedRelease | null;
  receipt: ReleaseReceipt | null;
  historicalLedgerSha256: string;
  postReleaseCatalogSha256: string;
  runtimeContracts: { key: string; matches: boolean }[];
  expectedRuntimeContractKeys: string[];
};

export type ReleaseCompatibility = {
  applicationSchemaCompatible: boolean;
  ordinaryMigrationAllowed: false;
  historyState: "divergent";
  blockers: string[];
};

/** Schema compatibility only. The reviewed artifact is supplied by the server,
 * never inferred from the database receipt or accepted from a browser. */
export function evaluateHistoricalReleaseCompatibility(
  input: ReleaseCompatibilityInput,
): ReleaseCompatibility {
  const blockers: string[] = [];
  const approved = input.approved;
  const receipt = input.receipt;
  if (!approved) blockers.push("approved-release-missing");
  if (!receipt) blockers.push("release-receipt-missing");
  const compare = (
    key: string,
    observed: string | undefined,
    expected: string | undefined,
    pattern?: RegExp,
  ) => {
    if (
      !observed?.trim() ||
      !expected?.trim() ||
      (pattern && (!pattern.test(observed) || !pattern.test(expected)))
    ) {
      blockers.push(`${key}-invalid`);
    } else if (observed !== expected) {
      blockers.push(`${key}-mismatch`);
    }
  };
  const sha256 = /^[a-f0-9]{64}$/;
  if (approved) {
    compare("build", input.buildSha, approved.compatibleBuildSha, /^[a-f0-9]{40}$/);
    compare("target-environment", input.targetEnvironmentId, approved.targetEnvironmentId);
    compare(
      "historical-ledger",
      input.historicalLedgerSha256,
      approved.expectedHistoricalLedgerSha256,
      sha256,
    );
    compare(
      "post-release-catalog",
      input.postReleaseCatalogSha256,
      approved.expectedPostReleaseCatalogSha256,
      sha256,
    );
    if (receipt) {
      compare("release-id", receipt.id, approved.id);
      compare("payload", receipt.payloadSha256, approved.payloadSha256, sha256);
      compare("manifest", receipt.manifestSha256, approved.manifestSha256, sha256);
    }
  }
  const expected = new Set(input.expectedRuntimeContractKeys);
  if (expected.size === 0) blockers.push("reviewed-contract-set-empty");
  if (expected.size !== input.expectedRuntimeContractKeys.length)
    blockers.push("reviewed-contract-key-duplicate");
  if (input.expectedRuntimeContractKeys.some((key) => !key.trim()))
    blockers.push("reviewed-contract-key-invalid");
  const observed = new Set<string>();
  for (const contract of input.runtimeContracts) {
    if (observed.has(contract.key)) blockers.push(`contract-duplicate:${contract.key}`);
    if (!expected.has(contract.key)) blockers.push(`contract-unknown:${contract.key}`);
    if (contract.matches !== true) blockers.push(`contract-failed:${contract.key}`);
    observed.add(contract.key);
  }
  for (const key of expected) {
    if (!observed.has(key)) blockers.push(`contract-missing:${key}`);
  }
  return {
    applicationSchemaCompatible: blockers.length === 0,
    ordinaryMigrationAllowed: false,
    historyState: "divergent",
    blockers,
  };
}
