import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import {
  buildWhatsAppInboundWebhookResponse,
  getWhatsAppIntegrationStatusForEnv,
  listWhatsAppConversationMessagesForActor,
  listWhatsAppConversationMessagesInputSchema,
  listWhatsAppConversationsForActor,
  listWhatsAppConversationsInputSchema,
  processWhatsAppInboundWebhookWithRepository,
  processWhatsAppInboundWebhookInputSchema,
  queueWhatsAppTemplateMessageForActor,
  queueWhatsAppTemplateMessageInputSchema,
} from "./server-fns";

describe("WhatsApp server function validation", () => {
  it("validates inbound webhook processing payloads", () => {
    const parsed = processWhatsAppInboundWebhookInputSchema.parse({
      providerEventId: "phase2-webhook-event",
      signatureValid: true,
      payload: {
        id: "wamid.phase2",
        from: "85261234567",
        text: "Hello",
      },
    });

    expect(parsed).toEqual({
      providerEventId: "phase2-webhook-event",
      signatureValid: true,
      payload: {
        id: "wamid.phase2",
        from: "85261234567",
        text: "Hello",
      },
    });
    expect(() =>
      processWhatsAppInboundWebhookInputSchema.parse({
        signatureValid: true,
        payload: null,
      }),
    ).toThrow();
  });

  it("validates outbound template queue payloads and defaults language", () => {
    const parsed = queueWhatsAppTemplateMessageInputSchema.parse({
      actorId: "95100000-0000-0000-0000-000000000001",
      caseId: "95300000-0000-0000-0000-000000000001",
      toPhone: "+852 6999 0001",
      templateName: "annual_return_30_day",
      category: "annual_return",
      body: "Please send the missing NAR1 documents.",
    });

    expect(parsed).toMatchObject({
      languageCode: "en",
      category: "annual_return",
    });
    expect(() =>
      queueWhatsAppTemplateMessageInputSchema.parse({
        actorId: "not-a-uuid",
        caseId: "95300000-0000-0000-0000-000000000001",
        toPhone: " ",
        templateName: "",
        category: "annual_return",
        body: "",
      }),
    ).toThrow();
  });

  it("serializes inbound webhook matching metadata", () => {
    const response = buildWhatsAppInboundWebhookResponse({
      signatureValid: true,
      message: {
        id: "96000000-0000-0000-0000-000000000001",
        companyId: "95200000-0000-0000-0000-000000000001",
        caseId: "95300000-0000-0000-0000-000000000001",
        timelineEventCreated: true,
      },
      event: {
        id: "97000000-0000-0000-0000-000000000001",
        processingStatus: "processed",
        errorMessage: null,
      },
    });

    expect(response).toEqual({
      ok: true,
      messageId: "96000000-0000-0000-0000-000000000001",
      eventId: "97000000-0000-0000-0000-000000000001",
      processingStatus: "processed",
      errorMessage: null,
      matchedCompanyId: "95200000-0000-0000-0000-000000000001",
      matchedCaseId: "95300000-0000-0000-0000-000000000001",
      timelineEventCreated: true,
    });
  });

  it("does not record unverified inbound webhook payloads as WhatsApp messages", async () => {
    const recordInboundMessage = vi.fn();
    const recordWebhookEvent = vi.fn(async (input) => ({
      id: "97000000-0000-0000-0000-000000000002",
      provider: "woztell" as const,
      providerEventId: input.providerEventId,
      signatureValid: input.signatureValid,
      payload: input.payload,
      normalizedMessageId: input.normalizedMessageId,
      processingStatus: input.processingStatus,
      errorMessage: input.errorMessage,
      receivedAt: "2026-07-05T12:00:00.000Z",
      processedAt: "2026-07-05T12:00:00.000Z",
    }));

    const response = await processWhatsAppInboundWebhookWithRepository(
      {
        recordInboundMessage,
        recordWebhookEvent,
        recordMessageStatusEvent: vi.fn(),
      },
      {
        providerEventId: "phase2-test-invalid-signature",
        signatureValid: false,
        payload: {
          event: "message",
          message: {
            id: "phase2-test-invalid-inbound",
            type: "text",
            text: { body: "Unverified message" },
          },
        },
      },
    );

    expect(recordInboundMessage).not.toHaveBeenCalled();
    expect(recordWebhookEvent).toHaveBeenCalledWith({
      providerEventId: "phase2-test-invalid-signature",
      signatureValid: false,
      payload: {
        event: "message",
        message: {
          id: "phase2-test-invalid-inbound",
          type: "text",
          text: { body: "Unverified message" },
        },
      },
      normalizedMessageId: null,
      processingStatus: "failed",
      errorMessage: "Webhook signature was not verified.",
    });
    expect(response).toEqual({
      ok: false,
      messageId: null,
      eventId: "97000000-0000-0000-0000-000000000002",
      processingStatus: "failed",
      errorMessage: "Webhook signature was not verified.",
      matchedCompanyId: null,
      matchedCaseId: null,
      timelineEventCreated: false,
    });
  });

  it("reports simulated delivery without requiring WOZTELL secrets", () => {
    expect(getWhatsAppIntegrationStatusForEnv({}, "simulated")).toEqual({
      provider: "simulated",
      deliveryMode: "simulated",
      webhookConfigured: false,
      liveSendConfigured: false,
      missingLiveEnvVars: [
        "WOZTELL_API_BASE_URL",
        "WOZTELL_ACCESS_TOKEN",
        "WOZTELL_CHANNEL_ID",
        "WOZTELL_WEBHOOK_SECRET",
      ],
    });
  });

  it("reports webhook and live-send readiness from env vars", () => {
    expect(
      getWhatsAppIntegrationStatusForEnv({
        WOZTELL_WEBHOOK_SECRET: "webhook-secret",
        WOZTELL_ACCESS_TOKEN: "token",
      }),
    ).toEqual({
      provider: "woztell",
      deliveryMode: "blocked",
      webhookConfigured: true,
      liveSendConfigured: false,
      missingLiveEnvVars: ["WOZTELL_API_BASE_URL", "WOZTELL_CHANNEL_ID"],
    });

    expect(
      getWhatsAppIntegrationStatusForEnv({
        WOZTELL_API_BASE_URL: "https://bot.api.woztell.com",
        WOZTELL_ACCESS_TOKEN: "token",
        WOZTELL_CHANNEL_ID: "channel",
        WOZTELL_WEBHOOK_SECRET: "webhook-secret",
      }),
    ).toEqual({
      provider: "woztell",
      deliveryMode: "live",
      webhookConfigured: true,
      liveSendConfigured: true,
      missingLiveEnvVars: [],
    });
  });
});

describe("WhatsApp inbox reads", () => {
  const conversation = {
    contactId: "11111111-1111-4111-8111-111111111111",
    displayName: "Ada Wong",
    phoneE164: "+85290001111",
    companyId: null,
    companyName: null,
    caseId: null,
    lastMessageBody: "Any update on the annual return?",
    lastMessageDirection: "inbound" as const,
    lastMessageAt: "2026-07-30T02:00:00.000Z",
  };

  function repositoryStub() {
    return {
      listConversations: vi.fn().mockResolvedValue([conversation]),
      listConversationMessages: vi.fn().mockResolvedValue([]),
    };
  }

  function actor(overrides: Partial<AuthenticatedActor> = {}): AuthenticatedActor {
    return {
      authUserId: "auth-user",
      userId: "22222222-2222-4222-8222-222222222222",
      role: "Staff",
      teamId: "33333333-3333-4333-8333-333333333333",
      active: true,
      ...overrides,
    };
  }

  it("returns conversations to an active staff actor", async () => {
    const repository = repositoryStub();

    await expect(
      listWhatsAppConversationsForActor(actor(), { limit: 25 }, { repository }),
    ).resolves.toEqual([conversation]);
    expect(repository.listConversations).toHaveBeenCalledWith({ limit: 25 });
  });

  it("refuses a client actor", async () => {
    // The inbox is an internal surface. whatsapp_contacts.company_id is nullable,
    // so an unmatched inbound message belongs to no company and could not be
    // scoped to a client even if we wanted to expose it.
    const repository = repositoryStub();

    await expect(
      listWhatsAppConversationsForActor(
        actor({ role: "Client", userId: null, teamId: null }),
        {},
        { repository },
      ),
    ).rejects.toThrow(/^Forbidden:/);
    expect(repository.listConversations).not.toHaveBeenCalled();
  });

  it("refuses a deactivated staff actor", async () => {
    const repository = repositoryStub();

    await expect(
      listWhatsAppConversationsForActor(actor({ active: false }), {}, { repository }),
    ).rejects.toThrow(/^Forbidden:/);
    expect(repository.listConversations).not.toHaveBeenCalled();
  });

  it("refuses a client actor reading a thread", async () => {
    const repository = repositoryStub();

    await expect(
      listWhatsAppConversationMessagesForActor(
        actor({ role: "Client", userId: null, teamId: null }),
        { contactId: conversation.contactId },
        { repository },
      ),
    ).rejects.toThrow(/^Forbidden:/);
    expect(repository.listConversationMessages).not.toHaveBeenCalled();
  });

  it("rejects a contact id that is not a uuid before it reaches the repository", () => {
    expect(() =>
      listWhatsAppConversationMessagesInputSchema.parse({ contactId: "not-a-uuid" }),
    ).toThrow();
  });

  it("caps the conversation limit a caller can ask for", () => {
    expect(() => listWhatsAppConversationsInputSchema.parse({ limit: 5000 })).toThrow();
  });
});

describe("queueWhatsAppTemplateMessageForActor", () => {
  const CASE_ID = "44444444-4444-4444-8444-444444444444";
  const OWNER_ID = "22222222-2222-4222-8222-222222222222";
  const TEAM_ID = "33333333-3333-4333-8333-333333333333";

  function actor(overrides: Partial<AuthenticatedActor> = {}): AuthenticatedActor {
    return {
      authUserId: "auth-user",
      userId: OWNER_ID,
      role: "Staff",
      teamId: TEAM_ID,
      active: true,
      ...overrides,
    };
  }

  function repositoryStub(caseOverrides: Record<string, unknown> = {}) {
    return {
      getCaseAuthorizationContext: vi.fn().mockResolvedValue({
        id: CASE_ID,
        companyName: "Harbour Holdings Limited",
        companyTeamId: TEAM_ID,
        ownerId: OWNER_ID,
        reviewerId: null,
        ...caseOverrides,
      }),
      queueOutboundTemplateMessage: vi.fn().mockResolvedValue({
        id: "message-1",
        provider: "woztell",
        direction: "outbound",
        status: "queued",
        companyId: "company-1",
        caseId: CASE_ID,
      }),
    };
  }

  const input = {
    caseId: CASE_ID,
    toPhone: "+85290000001",
    templateName: "annual_return_reminder",
    languageCode: "en",
    category: "annual_return" as const,
    body: "Your annual return is due.",
  };

  // The regression: actorId used to come from the request body, so a caller could
  // attribute a client-facing message to any staff member.
  it("attributes the message to the resolved actor, not to client input", async () => {
    const repository = repositoryStub();

    await queueWhatsAppTemplateMessageForActor(
      actor(),
      { ...input, actorId: "99999999-9999-4999-8999-999999999999" } as never,
      { repository },
    );

    expect(repository.queueOutboundTemplateMessage).toHaveBeenCalledWith(
      expect.objectContaining({ actorId: OWNER_ID }),
    );
  });

  it("refuses a client actor", async () => {
    const repository = repositoryStub();

    await expect(
      queueWhatsAppTemplateMessageForActor(
        actor({ role: "Client", userId: null, teamId: null }),
        input,
        { repository },
      ),
    ).rejects.toThrow(/^Forbidden:/);
    expect(repository.queueOutboundTemplateMessage).not.toHaveBeenCalled();
  });

  it("refuses an inactive staff actor", async () => {
    const repository = repositoryStub();

    await expect(
      queueWhatsAppTemplateMessageForActor(actor({ active: false }), input, { repository }),
    ).rejects.toThrow(/^Forbidden:/);
    expect(repository.queueOutboundTemplateMessage).not.toHaveBeenCalled();
  });

  // Staff-only is not enough on its own: a staff member from another team has no
  // business messaging this case's client.
  it("refuses a staff actor who neither owns, reviews nor manages the case", async () => {
    const repository = repositoryStub({
      companyTeamId: "55555555-5555-4555-8555-555555555555",
      ownerId: "66666666-6666-4666-8666-666666666666",
    });

    await expect(
      queueWhatsAppTemplateMessageForActor(actor(), input, { repository }),
    ).rejects.toThrow(/Only assigned staff/);
    expect(repository.queueOutboundTemplateMessage).not.toHaveBeenCalled();
  });

  it("allows the team manager of the case", async () => {
    const repository = repositoryStub({
      ownerId: "66666666-6666-4666-8666-666666666666",
    });

    await expect(
      queueWhatsAppTemplateMessageForActor(actor({ role: "Manager" }), input, { repository }),
    ).resolves.toEqual(expect.objectContaining({ caseId: CASE_ID }));
  });

  it("refuses a case that does not exist", async () => {
    const repository = repositoryStub();
    repository.getCaseAuthorizationContext.mockResolvedValueOnce(null);

    await expect(
      queueWhatsAppTemplateMessageForActor(actor(), input, { repository }),
    ).rejects.toThrow(/not found/);
    expect(repository.queueOutboundTemplateMessage).not.toHaveBeenCalled();
  });

  it("no longer accepts an actorId in its input schema", () => {
    const parsed = queueWhatsAppTemplateMessageInputSchema.parse({
      ...input,
      actorId: "99999999-9999-4999-8999-999999999999",
    });

    expect(parsed).not.toHaveProperty("actorId");
  });
});
