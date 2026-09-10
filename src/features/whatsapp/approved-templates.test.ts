import { describe, expect, it } from "vitest";
import {
  APPROVED_TEMPLATES,
  assertApprovedTemplate,
  findApprovedTemplate,
} from "./approved-templates";
import { fallbackTemplateFor } from "./fallback-templates";

describe("assertApprovedTemplate", () => {
  it("accepts every name the codebase actually sends", () => {
    for (const templateName of [
      "annual_return_reengagement",
      "service_subscription_reengagement",
      "annual_return_document_replacement",
      "annual_return_payment_proof_replacement",
      "annual_return_manual_reminder",
    ]) {
      const approved = findApprovedTemplate(templateName);
      expect(approved, `${templateName} must be listed`).not.toBeNull();
      expect(() =>
        assertApprovedTemplate({ templateName, languageCode: approved!.languageCode }),
      ).not.toThrow();
    }
  });

  /**
   * The defect. Three staff-initiated names were reaching the wire with no
   * runbook entry, no checklist and no approval step. Outside the 24-hour window
   * WOZTELL rejects an unapproved template with ok:0, and the runbook records
   * that the failure reaches a console.error and is nulled out after 90 days --
   * so it surfaces as an aggregate count and nothing else.
   */
  it("refuses a name nobody has written down, and names it", () => {
    expect(() =>
      assertApprovedTemplate({ templateName: "annual_return_new_idea", languageCode: "en" }),
    ).toThrow(/annual_return_new_idea/);
  });

  /**
   * Meta treats each language as a separate template. The runbook warns that
   * authoring one under zh_TW, zh_CN or bare zh instead of zh_HK makes the send
   * fail silently in production with no error visible in the app.
   */
  it("refuses the right name under the wrong language", () => {
    expect(() =>
      assertApprovedTemplate({ templateName: "annual_return_reengagement", languageCode: "zh_TW" }),
    ).toThrow(/language/i);
    expect(() =>
      assertApprovedTemplate({ templateName: "annual_return_reengagement", languageCode: "en" }),
    ).toThrow(/zh_HK/);
  });

  // The two automated re-engagement templates live in fallback-templates.ts and
  // are chosen by prefix. If the two lists disagree, the sweep sends a name the
  // guard would refuse -- so they are checked against each other rather than
  // maintained in parallel and hoped about.
  it("agrees with the fallback templates the sweeps actually use", () => {
    for (const notificationType of [
      "annual_return_reminder_1_month",
      "service_subscription_reminder_1_month",
    ]) {
      const fallback = fallbackTemplateFor(notificationType);
      expect(fallback).not.toBeNull();
      expect(() => assertApprovedTemplate(fallback!)).not.toThrow();
    }
  });

  it("carries a runbook section for every entry, so approval can be checked", () => {
    for (const entry of APPROVED_TEMPLATES) {
      expect(entry.runbookSection.trim()).not.toBe("");
    }
  });
});
