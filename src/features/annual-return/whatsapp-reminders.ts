import type { AnnualReturnRepository, RecordAnnualReturnReminderInput } from "./repository";
import type { AnnualReturnCase } from "./types";
import { buildReminderDraft } from "./workflow";
import type {
  QueueOutboundTemplateMessageInput,
  WhatsAppMessageRecord,
  WhatsAppRepository,
} from "@/features/whatsapp/repository";

export type BuildAnnualReturnWhatsAppReminderRequestInput = {
  case_: AnnualReturnCase;
  actorId: string;
  recipientName: string;
  recipientPhone: string;
  today: string;
};

export type AnnualReturnWhatsAppReminderRequest = {
  annualReturnReminder: RecordAnnualReturnReminderInput;
  whatsAppMessage: QueueOutboundTemplateMessageInput;
};

export type QueueAnnualReturnWhatsAppReminderInput =
  BuildAnnualReturnWhatsAppReminderRequestInput & {
    annualReturnRepository: Pick<AnnualReturnRepository, "recordReminder">;
    whatsAppRepository: Pick<WhatsAppRepository, "queueOutboundTemplateMessage">;
  };

export type QueueAnnualReturnWhatsAppReminderResult = {
  case: AnnualReturnCase;
  message: WhatsAppMessageRecord;
};

const ANNUAL_RETURN_REMINDER_TEMPLATE_LABEL = "Annual return WhatsApp reminder";
const ANNUAL_RETURN_REMINDER_TEMPLATE_NAME = "annual_return_manual_reminder";

/**
 * Dedupes a double-submit without blocking a deliberate second reminder.
 *
 * queueOutboundTemplateMessage has taken an idempotencyKey since the follow-up
 * work — an advisory lock plus an outbox replay check — and this path simply never
 * passed one. Two clicks on "send reminder" therefore sent the client two WhatsApp
 * messages and incremented remindersSent twice.
 *
 * remindersSent is part of the key, so concurrent submits share it and collapse to
 * one send, while a reminder sent later (after the counter has advanced) gets a
 * fresh key and goes through as intended.
 */
export function annualReturnReminderIdempotencyKey(input: {
  caseId: string;
  recipientPhone: string;
  remindersSent: number;
}): string {
  return [
    "annual-return-reminder",
    input.caseId,
    input.recipientPhone.replace(/\s+/g, ""),
    input.remindersSent,
  ].join(":");
}

export function buildAnnualReturnWhatsAppReminderRequest({
  case_,
  actorId,
  recipientName,
  recipientPhone,
  today,
}: BuildAnnualReturnWhatsAppReminderRequestInput): AnnualReturnWhatsAppReminderRequest {
  const draftBody = buildReminderDraft(case_, recipientName, today);

  return {
    annualReturnReminder: {
      caseId: case_.id,
      actorId,
      templateLabel: ANNUAL_RETURN_REMINDER_TEMPLATE_LABEL,
      recipientName,
      recipientPhone,
      draftBody,
      note: "Queued as WhatsApp template message.",
    },
    whatsAppMessage: {
      actorId,
      caseId: case_.id,
      toPhone: recipientPhone,
      contactName: recipientName,
      templateName: ANNUAL_RETURN_REMINDER_TEMPLATE_NAME,
      languageCode: "en",
      category: "annual_return",
      body: draftBody,
      idempotencyKey: annualReturnReminderIdempotencyKey({
        caseId: case_.id,
        recipientPhone,
        remindersSent: case_.remindersSent,
      }),
    },
  };
}

export async function queueAnnualReturnWhatsAppReminder({
  annualReturnRepository,
  whatsAppRepository,
  ...input
}: QueueAnnualReturnWhatsAppReminderInput): Promise<QueueAnnualReturnWhatsAppReminderResult> {
  const request = buildAnnualReturnWhatsAppReminderRequest(input);
  const message = await whatsAppRepository.queueOutboundTemplateMessage(request.whatsAppMessage);
  const updatedCase = await annualReturnRepository.recordReminder(request.annualReturnReminder);

  return {
    case: updatedCase,
    message,
  };
}
