import { describe, expect, it } from "vitest";
import { normalizeWoztellInboundMessage } from "./woztell";
import { WOZTELL_INBOUND_TEXT, WOZTELL_STATUS_READ } from "./woztell-fixtures";

describe("WOZTELL timestamp handling", () => {
  // WOZTELL sends epoch seconds as a *string*. `new Date("1599536864")` is
  // Invalid Date, which silently fell back to "now" and stamped every inbound
  // message with its processing time instead of when the client sent it.
  it("reads epoch seconds sent as a string", () => {
    expect(normalizeWoztellInboundMessage(WOZTELL_INBOUND_TEXT).receivedAt).toBe(
      "2020-09-08T04:27:44.000Z",
    );
  });

  it("reads epoch milliseconds sent as a number", () => {
    const payload = { ...WOZTELL_INBOUND_TEXT, timestamp: WOZTELL_STATUS_READ.timestamp };
    expect(normalizeWoztellInboundMessage(payload).receivedAt).toBe("2023-12-07T02:08:25.000Z");
  });
});
