/**
 * Every WhatsApp template name this codebase may put on the wire.
 *
 * There was no such list. `fallback-templates.ts` enumerates the two automated
 * re-engagement templates and the deployment runbook records exactly those two,
 * in `zh_HK`, with unticked checkboxes. Meanwhile the staff-initiated path sent
 * three other names -- and sent them in `en` -- that appear in no runbook, no
 * checklist and no approval step:
 *
 *   annual_return_document_replacement
 *   annual_return_payment_proof_replacement
 *   annual_return_manual_reminder
 *
 * The last is shared: whatsapp-reminders.ts sends it under the constant
 * ANNUAL_RETURN_REMINDER_TEMPLATE_NAME, and follow-up-server-fns.ts sends the
 * same literal for a manual chase.
 *
 * Outside the 24-hour customer-service window WhatsApp forbids free-form text, so
 * an unapproved name is rejected by WOZTELL with ok:0. The runbook already warns
 * what that looks like from here: the send throws, the failure reaches a
 * console.error, and `redactExpired` nulls the error columns after 90 days. A
 * permanently unapproved template surfaces only as an aggregate count.
 *
 * This module does not claim any of them IS approved. Nothing in this repository
 * can verify that -- `verify:firm` is offline by construction, and the
 * whatsapp_templates table has no Meta approval status. What it does is make the
 * set closed: a name nobody has written down here cannot reach the wire, so the
 * next template added to a send path fails at the call site with its own name in
 * the message rather than silently at a provider three months later.
 */

export type ApprovedTemplate = {
  templateName: string;
  /**
   * Meta treats each language as a separate template, so this is part of the
   * identity rather than a formatting detail. The runbook's language warning
   * says the same thing.
   */
  languageCode: string;
  /** Where the approval is tracked, so a reader can go and check. */
  runbookSection: string;
};

export const APPROVED_TEMPLATES: readonly ApprovedTemplate[] = [
  // The automated sweeps, matching fallback-templates.ts exactly.
  {
    templateName: "annual_return_reengagement",
    languageCode: "zh_HK",
    runbookSection: "WhatsApp template approvals",
  },
  {
    templateName: "service_subscription_reengagement",
    languageCode: "zh_HK",
    runbookSection: "WhatsApp template approvals",
  },

  // Staff-initiated. These were reaching the wire with no approval record at
  // all. Listing them does not approve them -- it makes them visible, and adds
  // them to the runbook checklist where a person can.
  //
  // The language is recorded as the `en` the code actually sends, not corrected
  // to zh_HK. Which language the firm submitted these under is a fact about the
  // Meta dashboard that this repository cannot read, and quietly changing it
  // would break a deployment where `en` is what was approved.
  {
    templateName: "annual_return_document_replacement",
    languageCode: "en",
    runbookSection: "Staff-initiated WhatsApp templates",
  },
  {
    templateName: "annual_return_payment_proof_replacement",
    languageCode: "en",
    runbookSection: "Staff-initiated WhatsApp templates",
  },
  {
    templateName: "annual_return_manual_reminder",
    languageCode: "en",
    runbookSection: "Staff-initiated WhatsApp templates",
  },
];

export function findApprovedTemplate(templateName: string): ApprovedTemplate | null {
  return APPROVED_TEMPLATES.find((entry) => entry.templateName === templateName) ?? null;
}

/**
 * Refuses a template nobody has written down, and a language mismatch.
 *
 * The language check is not pedantry. Meta treats `zh_HK`, `zh_TW`, `zh_CN` and
 * bare `zh` as four separate templates, and the runbook records that authoring
 * one under the wrong variant makes the send fail silently in production with no
 * error visible in the app.
 *
 * Thrown rather than returned, and at the call site rather than at the provider:
 * a name that was never approved is a configuration mistake, and the useful place
 * to learn about it is the request that made it, with the name in the message.
 */
export function assertApprovedTemplate(input: {
  templateName: string;
  languageCode: string;
}): ApprovedTemplate {
  const approved = findApprovedTemplate(input.templateName);
  if (!approved) {
    throw new Error(
      `WhatsApp template "${input.templateName}" is not in the approved list. ` +
        "Add it to src/features/whatsapp/approved-templates.ts and to the deployment runbook.",
    );
  }

  if (approved.languageCode !== input.languageCode) {
    throw new Error(
      `WhatsApp template "${input.templateName}" is approved for language ` +
        `"${approved.languageCode}" but was sent as "${input.languageCode}". ` +
        "Meta treats each language as a separate template.",
    );
  }

  return approved;
}
