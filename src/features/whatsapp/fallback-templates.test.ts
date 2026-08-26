import { describe, expect, it } from "vitest";
import { REMINDER_MILESTONES } from "@/lib/reminder-cadence";
import { fallbackTemplateFor } from "./fallback-templates";

describe("fallbackTemplateFor", () => {
  it.each(REMINDER_MILESTONES)("maps every annual-return milestone (%s)", (milestone) => {
    expect(fallbackTemplateFor(`annual_return_reminder_${milestone}`)).toEqual({
      templateName: "annual_return_reengagement",
      languageCode: "zh_HK",
    });
  });

  it.each(REMINDER_MILESTONES)("maps every service-subscription milestone (%s)", (milestone) => {
    expect(fallbackTemplateFor(`service_subscription_reminder_${milestone}`)).toEqual({
      templateName: "service_subscription_reengagement",
      languageCode: "zh_HK",
    });
  });

  it("returns null for a type with no mapped fallback", () => {
    expect(fallbackTemplateFor("whatsapp_template")).toBeNull();
    expect(fallbackTemplateFor("work_item_sla_1_hour")).toBeNull();
    expect(fallbackTemplateFor("")).toBeNull();
  });

  it("matches on prefix, so timeline event names in the same namespace also map", () => {
    // Not reachable today: these are timeline_events.event_type values, never
    // notification types. Pinned so a future exact-match change is a conscious one.
    expect(fallbackTemplateFor("annual_return_reminder_sent")).not.toBeNull();
  });
});
