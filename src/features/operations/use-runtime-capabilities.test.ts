import { describe, expect, it } from "vitest";

import {
  hiddenNavPaths,
  isWhatsAppCapabilityUnavailable,
  WHATSAPP_NAV_PATHS,
} from "./use-runtime-capabilities";

describe("capability-aware navigation and WhatsApp gate", () => {
  it("never hides anything in the fixture demo", () => {
    expect(hiddenNavPaths({ dataMode: "demo", configured: {} })).toEqual(new Set());
    expect(
      isWhatsAppCapabilityUnavailable({ dataMode: "demo", loaded: false, configured: {} }),
    ).toBe(false);
  });

  it("hides WhatsApp in production until its bindings are configured", () => {
    const hidden = hiddenNavPaths({ dataMode: "production", configured: {} });
    expect([...hidden]).toEqual([...WHATSAPP_NAV_PATHS]);
    expect(
      hiddenNavPaths({
        dataMode: "production",
        configured: { whatsapp: false },
      }),
    ).toEqual(new Set(WHATSAPP_NAV_PATHS));
  });

  it("shows WhatsApp again once the capability is configured", () => {
    expect(hiddenNavPaths({ dataMode: "production", configured: { whatsapp: true } })).toEqual(
      new Set(),
    );
  });

  it("gates the route only after the capability report has loaded", () => {
    expect(
      isWhatsAppCapabilityUnavailable({ dataMode: "production", loaded: false, configured: {} }),
    ).toBe(false);
    expect(
      isWhatsAppCapabilityUnavailable({ dataMode: "production", loaded: true, configured: {} }),
    ).toBe(true);
    expect(
      isWhatsAppCapabilityUnavailable({
        dataMode: "production",
        loaded: true,
        configured: { whatsapp: true },
      }),
    ).toBe(false);
  });
});
