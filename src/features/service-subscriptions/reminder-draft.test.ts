import { describe, expect, it } from "vitest";
import { buildServiceSubscriptionReminderDraft } from "./reminder-draft";
import type { ServiceSubscription } from "./types";

describe("buildServiceSubscriptionReminderDraft", () => {
  const subscription: ServiceSubscription = {
    id: "sub-1",
    companyId: "company-1",
    serviceType: "designated_representative",
    fee: 2000,
    status: "Active",
    renewalDate: "2026-09-15",
    cancelledAt: null,
  };

  it("names the service, fee, and days remaining when the renewal is upcoming", () => {
    const draft = buildServiceSubscriptionReminderDraft(
      subscription,
      "Harbour Trading Ltd",
      "Amy",
      "2026-08-16",
    );
    expect(draft).toContain("Harbour Trading Ltd");
    expect(draft).toContain("Designated Representative");
    expect(draft).toContain("2026-09-15");
    expect(draft).toContain("HK$2,000");
    expect(draft).toContain("距離現時尚餘 30 天");
  });

  it("reports overdue days when the renewal date has already passed", () => {
    const draft = buildServiceSubscriptionReminderDraft(
      subscription,
      "Harbour Trading Ltd",
      "Amy",
      "2026-09-20",
    );
    expect(draft).toContain("已逾期 5 天");
  });
});
