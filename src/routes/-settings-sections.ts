import type { DataMode } from "@/features/runtime/data-mode";

/**
 * Which sections this screen may show, by data mode.
 *
 * Checklist templates are now backed by a real `checklist_templates` table, repository,
 * and Admin-gated server functions (see `src/features/checklist-templates/`), so they show
 * in both modes — demo read-only, production with working controls.
 *
 * The knowledge base is still held in a browser store: there is no table, no repository, and
 * no production code reads it. Rendering its editor in production meant an Admin edited state
 * that was discarded on reload, with no persistence and no authorization, and that would not
 * have changed anything even if it had persisted. Service packages are hardcoded fee tiers,
 * which is worse than useless on a production screen someone might quote from.
 *
 * The WhatsApp panel stays in both modes: `getWhatsAppIntegrationStatus` is a real server
 * function, so it is the one part of this screen that reports production truth.
 */
export function settingsSectionsForMode(dataMode: DataMode) {
  const demo = dataMode === "demo";
  return {
    checklistTemplates: true,
    knowledgeBase: demo,
    servicePackages: demo,
    whatsappIntegration: true,
  };
}
