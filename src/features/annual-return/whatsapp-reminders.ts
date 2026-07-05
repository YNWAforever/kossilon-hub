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

export function buildAnnualReturnWhatsAppReminderRequest({
  case_,
  actorId,
  recipientName,
  recipientPhone,
}: BuildAnnualReturnWhatsAppReminderRequestInput): AnnualReturnWhatsAppReminderRequest {
  const draftBody = buildReminderDraft(case_);

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
