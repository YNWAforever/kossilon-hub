import { describe, expect, it } from "vitest";

import { settingsSectionsForMode } from "./-settings-sections";

// Checklist templates and the knowledge base live only in browser stores: there
// is no table for either, no repository, and no production code reads them. The
// screen used to render both editors unconditionally, so in production an Admin
// edited state that was discarded on reload and would not have changed anything
// even if it had persisted.
describe("settingsSectionsForMode", () => {
  it("hides the browser-store sections in production", () => {
    expect(settingsSectionsForMode("production")).toEqual({
      checklistTemplates: false,
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
