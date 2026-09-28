import { describe, expect, it } from "vitest";
import type { ProductionFollowUpDraft } from "./follow-ups";
import { buildProductionFollowUpPreview } from "./follow-up-preview";

const draft: ProductionFollowUpDraft = {
  id: "draft-1",
  entityId: "entity-1",
  source: "document-review",
  caseId: "case-1",
  companyId: "company-1",
  companyName: "Test Company",
  ownerName: "Staff",
  recipientName: "Client",
  phone: "+85291234567",
  reasonLabel: "Replacement needed",
  messagePreview: "Please replace the signed form.",
  status: "draft",
};
const contact = {
  id: "contact-1",
  name: "Client",
  phoneE164: "+85291234567",
  languageCode: "en",
  updatedAt: "2026-09-27T08:00:00.000Z",
};
const now = new Date("2026-09-27T09:00:00.000Z");

describe("T18 production follow-up preview", () => {
  it("freezes the exact persisted recipient, text and case identity within the session", async () => {
    const preview = await buildProductionFollowUpPreview({
      draft,
      contact,
      lastInboundAt: "2026-09-27T08:00:00.000Z",
      now,
    });
    expect(preview).toMatchObject({
      identity: { source: "document-review", caseId: "case-1", entityId: "entity-1" },
      recipientE164: "+85291234567",
      renderedText: draft.messagePreview,
      sendMode: "text",
      templateName: null,
      components: [],
    });
    expect(preview.previewHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a changed recipient or outside-window zero-variable template fallback", async () => {
    await expect(
      buildProductionFollowUpPreview({
        draft,
        contact: { ...contact, phoneE164: "+85291234568" },
        lastInboundAt: "2026-09-27T08:00:00.000Z",
        now,
      }),
    ).rejects.toThrow(/verified client contact/i);
    await expect(
      buildProductionFollowUpPreview({
        draft,
        contact,
        lastInboundAt: "2026-09-26T09:00:00.000Z",
        now,
      }),
    ).rejects.toThrow(/approved rendered template/i);
  });
});
