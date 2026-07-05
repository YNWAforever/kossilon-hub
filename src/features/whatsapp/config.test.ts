import { describe, expect, it } from "vitest";
import { getWhatsAppProviderConfig, getWhatsAppWebhookConfig } from "./config";

describe("WhatsApp integration config", () => {
  it("returns a complete WOZTELL provider config from env vars", () => {
    const config = getWhatsAppProviderConfig({
      WOZTELL_API_BASE_URL: "https://bot.api.woztell.com/",
      WOZTELL_ACCESS_TOKEN: "test-token",
      WOZTELL_CHANNEL_ID: "kossilon-channel",
      WOZTELL_WEBHOOK_SECRET: "webhook-secret",
    });

    expect(config).toEqual({
      provider: "woztell",
      apiBaseUrl: "https://bot.api.woztell.com",
      accessToken: "test-token",
      channelId: "kossilon-channel",
      webhookSecret: "webhook-secret",
    });
  });

  it("reports every missing live provider env var in one error", () => {
    expect(() =>
      getWhatsAppProviderConfig({
        WOZTELL_API_BASE_URL: "",
        WOZTELL_ACCESS_TOKEN: " ",
      }),
    ).toThrow(
      "Missing WhatsApp integration env vars: WOZTELL_API_BASE_URL, WOZTELL_ACCESS_TOKEN, WOZTELL_CHANNEL_ID, WOZTELL_WEBHOOK_SECRET",
    );
  });

  it("allows webhook-only config with just the webhook secret", () => {
    const config = getWhatsAppWebhookConfig({
      WOZTELL_WEBHOOK_SECRET: "webhook-secret",
    });

    expect(config).toEqual({
      provider: "woztell",
      webhookSecret: "webhook-secret",
    });
  });
});
