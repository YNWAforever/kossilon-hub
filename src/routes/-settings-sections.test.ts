import { describe, expect, it } from "vitest";

import { settingsSectionsForMode } from "./-settings-sections";

// Checklist templates are now backed by a real table, repository, and Admin-gated
// server functions, so they show in both modes. The knowledge base still lives only
// in a browser store: there is no table, no repository, and no production code reads
// it. Rendering its editor in production meant an Admin edited state that was
// discarded on reload and would not have changed anything even if it had persisted.
describe("settingsSectionsForMode", () => {
  it("hides the remaining browser-store sections in production", () => {
    expect(settingsSectionsForMode("production")).toEqual({
      checklistTemplates: true,
      knowledgeBase: false,
      servicePackages: false,
      whatsappIntegration: true,
    });
  });

  it("shows every section in demo", () => {
    expect(settingsSectionsForMode("demo")).toEqual({
      checklistTemplates: true,
      knowledgeBase: true,
      servicePackages: true,
      whatsappIntegration: true,
    });
  });

  it("keeps the server-backed integration panel in both modes", () => {
    // getWhatsAppIntegrationStatus is a real server function, so this section is
    // the one thing on the screen that reports production truth.
    expect(settingsSectionsForMode("demo").whatsappIntegration).toBe(true);
    expect(settingsSectionsForMode("production").whatsappIntegration).toBe(true);
  });
});
