import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const routeRoot = new URL("../src/routes/", import.meta.url);
const PRODUCTION_ROUTE_FILES = [
  "annual-returns.$id.tsx",
  "documents.tsx",
  "payments.tsx",
  "portal.tsx",
  "whatsapp.automation.tsx",
  "settings.tsx",
] as const;
const FORBIDDEN_BROWSER_MUTATIONS = [
  "assignOwner(",
  "markDocumentMissing(",
  "markDocumentReceived(",
  "updatePaymentStatus(",
  "updateSignatureStatus(",
  "updateReviewStatus(",
  "completeChecklistItem(",
  "reopenChecklistItem(",
  "togglePacketRequirement(",
  "submitFilingPacket(",
  "acceptFilingReceipt(",
  "addCaseNote(",
  "sendFollowUpNow(",
  "uploadClientDocument(",
  "replaceClientDocument(",
  "reviewClientDocument(",
  "uploadPaymentProof(",
  "acceptPaymentProof(",
  "rejectPaymentProof(",
  "sendDocumentReviewFollowUpNow(",
  "sendPaymentProofFollowUpNow(",
] as const;

export type ProductionRouteScanInput = {
  routeFiles: readonly string[];
  readRoute(file: string): Promise<string>;
};

export type ProductionRouteScanResult = {
  scanned: number;
  failures: Array<{ file: string; pattern: string }>;
};

export async function scanProductionRoutes(
  input: ProductionRouteScanInput,
): Promise<ProductionRouteScanResult> {
  const failures: ProductionRouteScanResult["failures"] = [];
  for (const file of input.routeFiles) {
    const source = await input.readRoute(file);
    for (const pattern of FORBIDDEN_BROWSER_MUTATIONS) {
      if (source.includes(pattern)) failures.push({ file, pattern });
    }
  }
  return { scanned: input.routeFiles.length, failures };
}

async function main(): Promise<void> {
  const result = await scanProductionRoutes({
    routeFiles: PRODUCTION_ROUTE_FILES,
    readRoute: (file) => readFile(new URL(file, routeRoot), "utf8"),
  });

  for (const failure of result.failures) {
    console.error(`FAIL ${failure.file}: forbidden browser mutation ${failure.pattern}`);
  }
  if (result.failures.length > 0) process.exitCode = 1;
  else console.log(`PASS production route import check (${result.scanned} routes scanned)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
