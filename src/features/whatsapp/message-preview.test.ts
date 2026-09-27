import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import {
  prepareMessageForActor,
  queueApprovedMessageForActor,
  type MessageContext,
  type MessagePreview,
  type MessagePreviewDependencies,
} from "./message-preview";

const actor: AuthenticatedActor = {
  authUserId: "auth-staff",
  userId: "staff-1",
  role: "Staff",
  teamId: "team-1",
  active: true,
};
const now = "2026-09-27T09:00:00.000Z";
const caseId = "case-1";
const contactId = "contact-1";
const context: MessageContext = {
  case: {
    id: caseId,
    companyName: "Firm A",
    companyTeamId: "team-1",
    ownerId: "staff-1",
    reviewerId: null,
    companyId: "company-1",
    status: "Documents pending",
    dataOrigin: "client",
  },
  contact: {
    id: contactId,
    companyId: "company-1",
    name: "Ms Chan",
    role: "Director",
    phoneE164: "+85291234567",
    phoneVerifiedAt: "2026-09-26T10:00:00.000Z",
    languageCode: "zh_HK",
    updatedAt: "2026-09-26T10:00:00.000Z",
  },
  conversationId: "conversation-1",
  lastInboundAt: "2026-09-27T08:00:00.000Z",
  template: null,
};

function setup(initial = context) {
  let current = structuredClone(initial);
  let preview: MessagePreview | null = null;
  const queueOutbound = vi.fn(async () => ({ id: "message-1", idempotentReplay: false }));
  const dependencies: MessagePreviewDependencies = {
    now: () => new Date(now),
    repository: {
      getContext: vi.fn(async () => structuredClone(current)),
      savePreview: vi.fn(async (value) => {
        preview = value;
      }),
      queueIfCurrent: vi.fn(async (_id, callback) => {
        if (!preview) throw new Error("Preview missing.");
        return callback(preview, structuredClone(current), queueOutbound);
      }),
    },
  };
  return {
    dependencies,
    queueOutbound,
    setContext(value: MessageContext) {
      current = value;
    },
  };
}

describe("T18 case-scoped message preview", () => {
  it("t18_scenario_1 rejects expired window, disabled template, changed contact and completed case", async () => {
    const s = setup();
    const preview = await prepareMessageForActor(
      actor,
      {
        caseId,
        contactId,
        conversationId: "conversation-1",
        purpose: "reply",
        draft: "Please send the signed form.",
      },
      s.dependencies,
    );
    const send = () =>
      queueApprovedMessageForActor(
        actor,
        {
          previewId: preview.previewId,
          previewHash: preview.previewHash,
          idempotencyKey: "attempt-1",
        },
        s.dependencies,
      );
    s.setContext({ ...context, lastInboundAt: "2026-09-26T09:00:00.000Z" });
    await expect(send()).rejects.toThrow(/session|window|preview/i);
    s.setContext({ ...context, contact: { ...context.contact!, phoneE164: "+85291234568" } });
    await expect(send()).rejects.toThrow(/contact|preview/i);
    s.setContext({ ...context, case: { ...context.case, status: "Completed" } });
    await expect(send()).rejects.toThrow(/completed|closed|preview/i);
    const templateContext: MessageContext = {
      ...context,
      contact: { ...context.contact!, languageCode: "en" },
      template: {
        name: "annual_return_manual_reminder",
        languageCode: "en",
        body: "Please return the signed NAR1.",
        active: true,
        providerApprovalVerified: true,
      },
    };
    const t = setup(templateContext);
    const templatePreview = await prepareMessageForActor(
      actor,
      {
        caseId,
        contactId,
        purpose: "reminder",
        draft: "Please return the signed NAR1.",
      },
      t.dependencies,
    );
    t.setContext({ ...templateContext, template: { ...templateContext.template!, active: false } });
    await expect(
      queueApprovedMessageForActor(
        actor,
        {
          previewId: templatePreview.previewId,
          previewHash: templatePreview.previewHash,
          idempotencyKey: "attempt-2",
        },
        t.dependencies,
      ),
    ).rejects.toThrow(/template|preview/i);
    expect(s.queueOutbound).not.toHaveBeenCalled();
    expect(t.queueOutbound).not.toHaveBeenCalled();
  });

  it("t18_scenario_2 requires matching conversation and preserves case audit context", async () => {
    const s = setup();
    await expect(
      prepareMessageForActor(
        actor,
        {
          caseId,
          contactId,
          conversationId: "other-company-thread",
          purpose: "reply",
          draft: "Hello",
        },
        s.dependencies,
      ),
    ).rejects.toThrow(/conversation/i);
    // One phone can appear in multiple client companies. The selected contact
    // must still belong to this explicitly selected case's company.
    const otherCompany = setup({
      ...context,
      contact: { ...context.contact!, companyId: "company-2" },
    });
    await expect(
      prepareMessageForActor(
        actor,
        {
          caseId,
          contactId,
          conversationId: "conversation-1",
          purpose: "reply",
          draft: "Hello",
        },
        otherCompany.dependencies,
      ),
    ).rejects.toThrow(/contact/i);
    const preview = await prepareMessageForActor(
      actor,
      {
        caseId,
        contactId,
        conversationId: "conversation-1",
        purpose: "reply",
        draft: "Hello",
      },
      s.dependencies,
    );
    const delivery = await queueApprovedMessageForActor(
      actor,
      {
        previewId: preview.previewId,
        previewHash: preview.previewHash,
        idempotencyKey: "attempt-1",
      },
      s.dependencies,
    );
    expect(delivery.messageId).toBe("message-1");
    expect(s.queueOutbound).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId,
        toPhone: "+85291234567",
        body: "Hello",
        metadata: expect.objectContaining({
          conversationId: "conversation-1",
          previewId: preview.previewId,
        }),
      }),
    );
  });

  it("t18_scenario_3 rejects missing or unverified client contacts instead of typed phone", async () => {
    const missing = setup({ ...context, contact: null });
    await expect(
      prepareMessageForActor(
        actor,
        {
          caseId,
          contactId,
          purpose: "reply",
          draft: "Hello",
        },
        missing.dependencies,
      ),
    ).rejects.toThrow(/contact/i);
    const unverified = setup({
      ...context,
      contact: { ...context.contact!, phoneVerifiedAt: null },
    });
    await expect(
      prepareMessageForActor(
        actor,
        {
          caseId,
          contactId,
          purpose: "reply",
          draft: "Hello",
        },
        unverified.dependencies,
      ),
    ).rejects.toThrow(/verif/i);
    expect(missing.queueOutbound).not.toHaveBeenCalled();
  });
});
