import { describe, expect, it } from "vitest";
import { fallbackTemplateFor } from "./fallback-templates";

describe("fallbackTemplateFor", () => {
  it.each([
    "annual_return_reminder_1_month",
    "annual_return_reminder_2_week",
    "annual_return_reminder_1_week",
  ])("maps the annual-return sweep type %s", (notificationType) => {
    expect(fallbackTemplateFor(notificationType)).toEqual({
      templateName: "annual_return_reengagement",
      languageCode: "zh_HK",
    });
  });

  it.each([
    "service_subscription_reminder_1_month",
    "service_subscription_reminder_2_week",
    "service_subscription_reminder_1_week",
  ])("maps the service-subscription sweep type %s", (notificationType) => {
    expect(fallbackTemplateFor(notificationType)).toEqual({
      templateName: "service_subscription_reengagement",
      languageCode: "zh_HK",
    });
  });

  it("returns null for a type with no mapped fallback", () => {
    expect(fallbackTemplateFor("whatsapp_template")).toBeNull();
    expect(fallbackTemplateFor("test")).toBeNull();
    expect(fallbackTemplateFor("")).toBeNull();
  });
});
