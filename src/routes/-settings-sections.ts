import type { DataMode } from "@/features/runtime/data-mode";

/**
 * Which sections this screen may show, by data mode.
 *
 * Checklist templates and the knowledge base are held in browser stores — there
 * is no table for either, no repository, and nothing in production reads them.
 * Rendering their editors in production meant an Admin edited state that was
 * discarded on reload, with no persistence and no authorization, and that would
 * not have changed a single case even if it had persisted. Service packages are
 * hardcoded fee tiers, which is worse than useless on a production screen
 * someone might quote from.
 *
 * The WhatsApp panel stays in both modes: `getWhatsAppIntegrationStatus` is a
 * real server function, so it is the one part of this screen that reports
 * production truth.
 */
export function settingsSectionsForMode(dataMode: DataMode) {
  const demo = dataMode === "demo";
  return {
    checklistTemplates: demo,
    knowledgeBase: demo,
    servicePackages: demo,
    whatsappIntegration: true,
  };
}
