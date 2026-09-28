import { describe, expect, it } from "vitest";
import {
  logicalReminderKey,
  selectLogicalReminders,
  deliveryDisposition,
} from "./reminder-handler";

describe("T23 bulk reminder boundaries", () => {
  it("t23_scenario_1: replay keeps one logical reminder while one phone across two companies keeps separate case context", () => {
    const sharedPhone = "+85261234567";
    const inputs = [
      {
        caseId: "11111111-1111-4111-8111-111111111111",
        companyId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        contactId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        recipientPhone: sharedPhone,
        purpose: "reminder" as const,
        cadenceSlot: "2026-09-28",
      },
      {
        caseId: "22222222-2222-4222-8222-222222222222",
        companyId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        contactId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        recipientPhone: sharedPhone,
        purpose: "reminder" as const,
        cadenceSlot: "2026-09-28",
      },
    ];
    const selected = selectLogicalReminders([...inputs, inputs[0]]);
    expect(selected).toHaveLength(2);
    expect(logicalReminderKey(inputs[0])).not.toBe(logicalReminderKey(inputs[1]));
    expect(selected.map((item) => item.companyId)).toEqual([
      inputs[0].companyId,
      inputs[1].companyId,
    ]);
  });

  it("t23_scenario_2: unknown send is never automatically retried and provider receipt remains traceable", () => {
    expect(
      deliveryDisposition({
        state: "needs_reconciliation",
        messageId: "message-1",
        providerReceiptId: null,
        delivery: null,
      }),
    ).toEqual({
      state: "needs-reconciliation",
      retryable: false,
      messageId: "message-1",
      providerReceiptId: null,
      delivery: null,
    });
    expect(
      deliveryDisposition({
        state: "sent",
        messageId: "message-2",
        providerReceiptId: "provider-22",
        delivery: "provider",
      }),
    ).toEqual({
      state: "succeeded",
      retryable: false,
      messageId: "message-2",
      providerReceiptId: "provider-22",
      delivery: "provider",
    });
  });
});
