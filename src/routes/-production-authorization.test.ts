import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The name-by-name denylist that used to live here is gone: the demo stores no
// longer export a write path, so there is nothing for a production route to
// import. The invariant is structural now, not a list to keep in sync — which
// is just as well, because this copy had already drifted out of step with the
// build gate it mirrored.
describe("production route authorization contract", () => {
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

  it("keeps production annual-return actions behind staff server functions", () => {
    const route = readFileSync(new URL("./annual-returns.$id.tsx", import.meta.url), "utf8");
    const detail = readFileSync(
      new URL("../features/annual-return/components/production-case-detail.tsx", import.meta.url),
      "utf8",
    );
    const actions = readFileSync(
      new URL("../features/annual-return/components/production-case-actions.ts", import.meta.url),
      "utf8",
    );
    const serverFunctions = readFileSync(
      new URL("../features/annual-return/server-fns.ts", import.meta.url),
      "utf8",
    );

    expect(route).toContain("ProductionAnnualReturnCaseDetail");
    expect(route).toContain("dataMode");
    expect(detail).not.toContain("annual-return-store");
    expect(detail).not.toContain("client-portal-store");
    expect(actions).not.toContain("annual-return-store");
    expect(actions).not.toContain("client-portal-store");
    expect(serverFunctions).toContain("assertStaffAccess");
    expect(serverFunctions).toContain("getCurrentAnnualReturnActorId");

    for (const command of [
      "assignAnnualReturnCaseOwner",
      "updateAnnualReturnStatus",
      "updateAnnualReturnChecklistItem",
      "updateAnnualReturnPayment",
      "addAnnualReturnCaseNote",
      "queueAnnualReturnWhatsAppReminderMessage",
      "updateAnnualReturnFilingProof",
    ]) {
      expect(actions).toContain(command);
      expect(serverFunctions).toContain("export const " + command + " = createServerFn");
    }
  });

  it("keeps evidence review and receipt acceptance behind actor-authorized server actions", () => {
    const evidenceActions = readFileSync(
      new URL("../features/annual-return/evidence-server-fns.ts", import.meta.url),
      "utf8",
    );

    expect(evidenceActions).toContain("reviewAnnualReturnEvidenceForActor");
    expect(evidenceActions).toContain("acceptAnnualReturnFilingReceiptForActor");
    expect(evidenceActions).toContain("getCurrentAnnualReturnActor(getRequest())");
    expect(evidenceActions).toContain("assertStaffAccess");
  });
});
