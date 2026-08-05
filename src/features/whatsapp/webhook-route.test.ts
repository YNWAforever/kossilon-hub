import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { WHATSAPP_WEBHOOK_PATH } from "./webhook";

const serverEntry = readFileSync(new URL("../../server.ts", import.meta.url), "utf8");

describe("WhatsApp webhook route wiring", () => {
  // src/server.ts inlines the path literal so a cold start does not import this
  // module (and, through it, the database client). That duplication is only safe
  // if something notices when the two drift apart.
  it("keeps the path in src/server.ts identical to the exported constant", () => {
    expect(WHATSAPP_WEBHOOK_PATH).toBe("/api/webhooks/whatsapp");
    expect(serverEntry).toContain(`const WHATSAPP_WEBHOOK_PATH = "${WHATSAPP_WEBHOOK_PATH}"`);
  });

  it("routes the webhook before the request reaches the SSR handler", () => {
    const webhookBranch = serverEntry.indexOf("pathname === WHATSAPP_WEBHOOK_PATH");
    const ssrHandoff = serverEntry.indexOf("await getServerEntry()");

    expect(webhookBranch).toBeGreaterThan(-1);
    expect(ssrHandoff).toBeGreaterThan(-1);
    expect(webhookBranch).toBeLessThan(ssrHandoff);
  });

  // The endpoint authenticates with an HMAC, so it must not be reachable as a
  // server function — that is what made the previous version forgeable.
  it("no longer exposes inbound ingestion as a server function", () => {
    const serverFns = readFileSync(new URL("./server-fns.ts", import.meta.url), "utf8");

    expect(serverFns).not.toContain("export const processWhatsAppInboundWebhook =");
  });
});
