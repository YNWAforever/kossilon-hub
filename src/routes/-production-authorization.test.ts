import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const routeFiles = [
  "annual-returns.$id.tsx",
  "documents.tsx",
  "payments.tsx",
  "portal.tsx",
  "whatsapp.automation.tsx",
  "settings.tsx",
];

const forbiddenBrowserMutations = [
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

describe("production route authorization contract", () => {
  it("does not let production routes mutate browser-owned stores", () => {
    for (const file of routeFiles) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      for (const mutation of forbiddenBrowserMutations) {
        expect(source, `${file} still owns ${mutation}`).not.toContain(mutation);
      }
    }
  });

  it("keeps document routes on private server functions", () => {
    const documents = readFileSync(new URL("./documents.tsx", import.meta.url), "utf8");
    const portal = readFileSync(new URL("./portal.tsx", import.meta.url), "utf8");
    expect(documents).toContain("listDocuments");
    expect(documents).toContain("downloadDocument");
    expect(portal).toContain("createDocumentUploadIntent");
    expect(portal).toContain("finalizeDocumentUpload");
    expect(portal).not.toContain("publicUrl");
  });

  it("resolves production data mode without identifier-shape fallbacks", () => {
    const root = readFileSync(new URL("./__root.tsx", import.meta.url), "utf8");
    const router = readFileSync(new URL("../router.tsx", import.meta.url), "utf8");

    expect(router).toContain("currentDataMode()");
    expect(router).toContain("dataMode");
    expect(root).toContain('dataMode !== "demo"');
    expect(root).not.toContain('dataMode === "production"');
    expect(root).not.toMatch(/uuid|identifier.*demo|demo.*identifier/i);
  });
});
