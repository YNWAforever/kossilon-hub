import { isWithinSessionWindow } from "@/features/whatsapp/session-window";
import { toPhoneDigits } from "@/features/whatsapp/phone";
import type { ProductionFollowUpDraft, ProductionFollowUpIdentity } from "./follow-ups";

export type VerifiedFollowUpContact = {
  id: string;
  phoneE164: string;
  name: string;
  languageCode: string;
  updatedAt: string;
};
export type ProductionFollowUpPreview = {
  identity: ProductionFollowUpIdentity;
  caseId: string;
  companyId: string;
  companyName: string;
  contactId: string;
  recipientName: string;
  recipientE164: string;
  languageCode: string;
  renderedText: string;
  sendMode: "text";
  templateName: null;
  components: [];
  lastInboundAt: string;
  contactVersion: string;
  previewHash: string;
};

export async function buildProductionFollowUpPreview(input: {
  draft: ProductionFollowUpDraft;
  contact: VerifiedFollowUpContact | null;
  lastInboundAt: string | null;
  now: Date;
}): Promise<ProductionFollowUpPreview> {
  const { draft, contact, lastInboundAt, now } = input;
  if (draft.status !== "draft" || !draft.phone || !draft.recipientName) {
    throw new Error("Follow-up is no longer an actionable draft.");
  }
  if (
    !contact ||
    toPhoneDigits(contact.phoneE164) !== toPhoneDigits(draft.phone) ||
    contact.name !== draft.recipientName
  ) {
    throw new Error("Follow-up recipient needs a current verified client contact.");
  }
  // No provider-verified variable mapping exists for an outside-window template.
  // A zero-variable fallback would not deliver this case-specific draft.
  if (!lastInboundAt || !isWithinSessionWindow(lastInboundAt, now)) {
    throw new Error("The 24-hour session is closed; an approved rendered template is required.");
  }
  const identity: ProductionFollowUpIdentity = {
    source: draft.source,
    caseId: draft.caseId,
    entityId: draft.entityId,
  };
  const body = {
    identity,
    caseId: draft.caseId,
    companyId: draft.companyId,
    companyName: draft.companyName,
    contactId: contact.id,
    recipientName: draft.recipientName,
    recipientE164: contact.phoneE164,
    languageCode: contact.languageCode,
    renderedText: draft.messagePreview,
    sendMode: "text" as const,
    templateName: null,
    components: [] as [],
    lastInboundAt,
    contactVersion: contact.updatedAt,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const previewHash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return { ...body, previewHash };
}
