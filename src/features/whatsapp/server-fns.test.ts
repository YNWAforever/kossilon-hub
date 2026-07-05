import { describe, expect, it } from "vitest";
import {
  getWhatsAppIntegrationStatusForEnv,
  processWhatsAppInboundWebhookInputSchema,
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

  it("reports webhook and live-send readiness from env vars", () => {
    expect(
      getWhatsAppIntegrationStatusForEnv({
        WOZTELL_WEBHOOK_SECRET: "webhook-secret",
        WOZTELL_ACCESS_TOKEN: "token",
      }),
    ).toEqual({
      provider: "woztell",
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
      webhookConfigured: true,
      liveSendConfigured: true,
      missingLiveEnvVars: [],
    });
  });
});
