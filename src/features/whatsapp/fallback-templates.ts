export type FallbackTemplate = { templateName: string; languageCode: string };

type FallbackRule = { prefix: string; template: FallbackTemplate };

/**
 * Approved, no-variable re-engagement templates — one per sweep family. Sent when a
 * reminder is due but the contact is outside the 24-hour window, where WhatsApp
 * forbids free-form text. They ask the client to reply, which reopens the window.
 *
 * Deliberately code constants rather than rows in whatsapp_templates: that table
 * has no Meta approval status, no variable schema, is never SELECTed by any
 * application code, and its upsertTemplate resurrects paused/archived rows. Reading
 * it would launder the same guess through a table and add false authority. Template
 * names are already constants elsewhere (whatsapp-reminders.ts,
 * follow-up-server-fns.ts).
 *
 * Matched by prefix because each sweep emits one type per milestone. The full set
 * of six literals is enumerated in the tests.
 *
 * SETUP DEPENDENCY: both template names must be approved in the WOZTELL/Meta
 * dashboard, in zh_HK. Nothing in this repo can verify that — verify:firm is
 * offline by construction. See docs/runbooks/firm-deployment.md.
 */
const FALLBACK_TEMPLATES = [
  {
    prefix: "annual_return_reminder_",
    template: {
      templateName: "annual_return_reengagement",
      languageCode: "zh_HK",
    },
  },
  {
    prefix: "service_subscription_reminder_",
    template: {
      templateName: "service_subscription_reengagement",
      languageCode: "zh_HK",
    },
  },
] as const satisfies readonly FallbackRule[];

/**
 * Note these notification types do NOT identify a channel — both sweeps write the
 * same type for an email-channel row when the contact has no phone. This table is
 * consulted only from the WhatsApp send path.
 */
export function fallbackTemplateFor(notificationType: string): FallbackTemplate | null {
  const match = FALLBACK_TEMPLATES.find((entry) => notificationType.startsWith(entry.prefix));
  return match?.template ?? null;
}
