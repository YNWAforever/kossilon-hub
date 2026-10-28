import type { AnnualReturnRepository, RecordAnnualReturnReminderInput } from "./repository";
import { assertApprovedTemplate } from "@/features/whatsapp/approved-templates";
import { annualReturnManualReminderIdempotencyKey } from "./reminder-idempotency-key";
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
  actorAuthUserId?: string;
  recipientName: string;
  recipientPhone: string;
  commandUuid: string;
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
 * One staff click is one command UUID, stored on the existing outbox unique key.
 *
 * The phone stays a contact check and the message's toPhone. It is not part of
 * the key: spelling differences must not fork a command, and a new normalisation
 * would not match historical `phone:remindersSent` keys, which are left untouched.
 * A deliberate second reminder is a new UUID after the first receipt is visible.
 * The counter is no longer the idempotency input, because a lost response advances
 * it and the next click would otherwise mint a different key.
 */
export function annualReturnReminderIdempotencyKey(input: {
  caseId: string;
  commandUuid: string;
}): string {
  return annualReturnManualReminderIdempotencyKey(input.caseId, input.commandUuid);
}

export function buildAnnualReturnWhatsAppReminderRequest({
  case_,
  actorId,
  actorAuthUserId,
  recipientName,
  recipientPhone,
  commandUuid,
  today,
}: BuildAnnualReturnWhatsAppReminderRequestInput): AnnualReturnWhatsAppReminderRequest {
  const draftBody = buildReminderDraft(case_, recipientName, today);

  // Refused here rather than at WOZTELL. An unapproved name is rejected outside
  // the 24-hour window with ok:0, and by the runbook's own account that failure
  // reaches a console.error and is nulled out after 90 days -- so a permanently
  // unapproved template shows up as an aggregate count and nothing else.
  const approvedTemplate = assertApprovedTemplate({
    templateName: ANNUAL_RETURN_REMINDER_TEMPLATE_NAME,
    languageCode: "en",
  });

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
      ...(actorAuthUserId ? { actorAuthUserId } : {}),
      caseId: case_.id,
      toPhone: recipientPhone,
      contactName: recipientName,
      templateName: approvedTemplate.templateName,
      languageCode: approvedTemplate.languageCode,
      category: "annual_return",
      body: draftBody,
      idempotencyKey: annualReturnReminderIdempotencyKey({
        caseId: case_.id,
        commandUuid,
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
  // The outbox row and the reminder log share the caller's transaction. A replay
  // means that pair already committed, so a second recordReminder would count one
  // message twice. This matches follow-up send.
  if (message.idempotentReplay) {
    return { case: input.case_, message };
  }
  const updatedCase = await annualReturnRepository.recordReminder(request.annualReturnReminder);

  return {
    case: updatedCase,
    message,
  };
}
