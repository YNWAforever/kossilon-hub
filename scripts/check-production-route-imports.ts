import { readFile } from "node:fs/promises";

const routeRoot = new URL("../src/routes/", import.meta.url);
const routeFiles = [
  "annual-returns.$id.tsx",
  "documents.tsx",
  "payments.tsx",
  "portal.tsx",
  "whatsapp.automation.tsx",
  "settings.tsx",
];
const forbidden = [
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
];

let failures = 0;
for (const file of routeFiles) {
  const source = await readFile(new URL(file, routeRoot), "utf8");
  for (const pattern of forbidden) {
    if (source.includes(pattern)) {
      console.error(`FAIL ${file}: forbidden browser mutation ${pattern}`);
      failures += 1;
    }
  }
}
if (failures > 0) process.exitCode = 1;
else console.log(`PASS production route import check (${routeFiles.length} routes scanned)`);
