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

    const commandCenter = readFileSync(
      new URL(
        "../features/annual-return/components/production-command-center.tsx",
        import.meta.url,
      ),
      "utf8",
    );

    expect(route).toContain("ProductionAnnualReturnCaseDetail");
    expect(route).toContain("dataMode");

    // Enforced rather than left to convention: a production screen that reaches
    // into a demo store renders fixtures to real users.
    for (const source of [detail, actions, commandCenter]) {
      expect(source).not.toContain("annual-return-store");
      expect(source).not.toContain("client-portal-store");
    }
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

  it("keeps the production WhatsApp inbox on staff-authorized server functions", () => {
    const route = readFileSync(new URL("./whatsapp.tsx", import.meta.url), "utf8");
    const inbox = readFileSync(
      new URL("../features/whatsapp/components/production-inbox.tsx", import.meta.url),
      "utf8",
    );
    const serverFunctions = readFileSync(
      new URL("../features/whatsapp/server-fns.ts", import.meta.url),
      "utf8",
    );

    expect(route).toContain("ProductionWhatsAppInbox");
    expect(route).toContain("dataMode");

    // app-data and ai-agent are the demo fixtures and the mock assistant. The
    // AiAssistantPanel additionally reads two demo stores, so it cannot appear on
    // a production screen at all.
    expect(inbox).not.toContain("lib/app-data");
    expect(inbox).not.toContain("lib/ai-agent");
    expect(inbox).not.toContain("ai-assistant-panel");
    expect(inbox).not.toContain("annual-return-store");
    expect(inbox).not.toContain("client-portal-store");

    for (const command of ["listWhatsAppConversations", "listWhatsAppConversationMessages"]) {
      expect(inbox).toContain(command);
      expect(serverFunctions).toContain("export const " + command + " = createServerFn");
    }
    expect(serverFunctions).toContain("requireStaffActor");
    expect(serverFunctions).toContain("assertStaffAccess");

    // The status response names the firm's unconfigured bindings and its provider
    // mode. Without this the guard is enforced only by inspection: deleting the
    // requireStaffActor call leaves every other test green.
    expect(serverFunctions).toMatch(
      /getWhatsAppIntegrationStatus = createServerFn[\s\S]{0,300}?requireStaffActor\(getRequest\(\)\)/,
    );
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
