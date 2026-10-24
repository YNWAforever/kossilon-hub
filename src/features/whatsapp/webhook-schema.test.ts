import { describe, expect, it, vi } from "vitest";
import { createWhatsAppWebhookHandler } from "./webhook";
import type { WhatsAppRepository } from "./repository";
import { schemaCatalogDouble } from "@/test/schema-catalog-double";
const fixture = vi.hoisted(() => ({ sql: undefined as unknown }));
vi.mock("@/server/db/client", () => ({
  getSqlClient: () => fixture.sql,
  createSqlClient: () => {
    throw new Error("Real DB client forbidden in webhook unit");
  },
}));
const secret = "synthetic-uc189-local-hmac-secret";
async function request(valid = true) {
  const body = JSON.stringify({
    from: "85290000001",
    to: "85290000002",
    timestamp: "1785000000",
    type: "TEXT",
    data: { text: "Synthetic UC189" },
    member: "member-ac7d801e",
    channel: "channel-ac7d801e",
    app: "app-ac7d801e",
  });
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
  );
  return new Request("https://local.invalid/api/webhooks/whatsapp", {
    method: "POST",
    body,
    headers: { "x-woztell-signature": valid ? btoa(String.fromCharCode(...bytes)) : "invalid" },
  });
}
describe("UC189 HMAC write admission before repository", () => {
  it("uses the concrete schema gate when production config supplies no override", async () => {
    const { state, sql } = schemaCatalogDouble();
    state.index = false;
    fixture.sql = sql;
    const factory = vi.fn(() => {
      throw new Error("Writer must not be constructed");
    });
    const handler = createWhatsAppWebhookHandler({
      webhookSecret: secret,
      createRepository: factory,
    });
    expect((await handler(await request())).status).toBe(503);
    expect(factory).not.toHaveBeenCalled();
    expect(state.queries.length).toBeGreaterThan(0);
  });
  it("returns retryable 503 without constructing a writer or acknowledging incompatible schema", async () => {
    const admission = vi.fn(async () => {
      throw new Error("private schema details");
    });
    const factory = vi.fn(() => {
      throw new Error("business writer reached");
    });
    const handler = createWhatsAppWebhookHandler({
      webhookSecret: secret,
      createRepository: factory,
      assertSchemaReady: admission,
    });
    for (let n = 0; n < 2; n++) {
      const response = await handler(await request());
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain("private schema details");
    }
    expect(admission).toHaveBeenCalledTimes(2);
    expect(factory).not.toHaveBeenCalled();
  });
  it("rejects bad HMAC before any schema query", async () => {
    const admission = vi.fn(async () => {}),
      factory = vi.fn(() => ({}) as WhatsAppRepository);
    const response = await createWhatsAppWebhookHandler({
      webhookSecret: secret,
      createRepository: factory,
      assertSchemaReady: admission,
    })(await request(false));
    expect(response.status).toBe(401);
    expect(admission).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
  });
});
