import "dotenv/config";
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createSimulatedNotificationTransport } from "@/features/notifications/simulated-transport";
import type { AuthenticatedActor } from "@/features/auth/types";
import { createWhatsAppRepository } from "./repository";
import {
  getWhatsAppIntegrationStatusForActor,
  getWhatsAppIntegrationStatusForEnv,
} from "./server-fns";
import { providerEventIdFrom } from "./webhook";
import { classifyWoztellWebhookEvent, sendWoztellMessage, verifyWoztellSignature } from "./woztell";
import { WOZTELL_STATUS_DELIVERED, WOZTELL_STATUS_READ } from "./woztell-fixtures";

const bindings = {
  WOZTELL_API_BASE_URL: "https://bot.api.woztell.com",
  WOZTELL_ACCESS_TOKEN: "test-token",
  WOZTELL_CHANNEL_ID: "test-channel",
  WOZTELL_WEBHOOK_SECRET: "test-secret",
};
const now = "2026-09-27T09:00:00.000Z";
const deploymentRef = "abcdef1234567";

// Official WOZTELL documentation: raw-body HMAC-SHA256/Base64, status event
// messageId and the BotAPI sendResponses envelope. No live call is made here.
describe("T17 WOZTELL provider contract", () => {
  it("t17_scenario_1 rejects invalid signatures and gives replay, out-of-order and unknown receipts explicit outcomes", async () => {
    const raw = JSON.stringify(WOZTELL_STATUS_READ);
    const signature = createHmac("sha256", bindings.WOZTELL_WEBHOOK_SECRET)
      .update(raw)
      .digest("base64");
    expect(
      await verifyWoztellSignature({
        secret: bindings.WOZTELL_WEBHOOK_SECRET,
        rawBody: raw,
        signatureHeader: signature,
      }),
    ).toBe(true);
    expect(
      await verifyWoztellSignature({
        secret: bindings.WOZTELL_WEBHOOK_SECRET,
        rawBody: raw + " ",
        signatureHeader: signature,
      }),
    ).toBe(false);
    const replay = providerEventIdFrom(new Headers(), WOZTELL_STATUS_READ, raw);
    expect(providerEventIdFrom(new Headers(), WOZTELL_STATUS_READ, raw)).toBe(replay);
    expect(
      providerEventIdFrom(
        new Headers(),
        WOZTELL_STATUS_DELIVERED,
        JSON.stringify(WOZTELL_STATUS_DELIVERED),
      ),
    ).not.toBe(replay);
    expect(classifyWoztellWebhookEvent(WOZTELL_STATUS_READ)).toMatchObject({
      kind: "status",
      status: { status: "read", providerMessageId: WOZTELL_STATUS_READ.data.messageId },
    });
    // The existing repository integration test also proves late DELIVERED cannot
    // downgrade READ. This query proves unknown provider IDs stay unmatched.
    if (process.env.TEST_DATABASE_URL) {
      const repository = createWhatsAppRepository(process.env.TEST_DATABASE_URL);
      try {
        expect(
          await repository.recordMessageStatusEvent({
            provider: "woztell",
            providerMessageId: "t17-unknown-" + crypto.randomUUID(),
            status: "read",
            occurredAt: now,
          }),
        ).toEqual({ matched: false, messageId: null, status: null });
      } finally {
        await repository.close();
      }
    }
  });

  it("t17_scenario_2 keeps simulated delivery free of a provider ID and records only genuine send IDs", async () => {
    const simulated = await createSimulatedNotificationTransport().dispatch({} as never);
    expect(simulated).toEqual({ delivery: "simulated" });
    expect("providerMessageId" in simulated).toBe(false);
    let called = 0;
    const live = await sendWoztellMessage(
      {
        provider: "woztell",
        apiBaseUrl: bindings.WOZTELL_API_BASE_URL,
        accessToken: bindings.WOZTELL_ACCESS_TOKEN,
        channelId: bindings.WOZTELL_CHANNEL_ID,
        webhookSecret: bindings.WOZTELL_WEBHOOK_SECRET,
      },
      { toPhone: "+85290000000", mode: { kind: "text", body: "test only" } },
      async () => {
        called++;
        return new Response(
          JSON.stringify({
            ok: 1,
            sendResult: { result: [{ result: { messages: [{ id: "wamid.t17-real" }] } }] },
          }),
          { status: 200 },
        );
      },
    );
    expect(called).toBe(1);
    expect(live).toEqual({ providerMessageId: "wamid.t17-real" });
    const local = getWhatsAppIntegrationStatusForEnv(bindings, "local", {
      now,
      deploymentRef,
    });
    expect(local.deliveryMode).toBe("simulated");
    expect(local.liveSendConfigured).toBe(false);
  });

  it("t17_scenario_3 needs all four binding names and current-deployment success before healthy", () => {
    for (const key of Object.keys(bindings)) {
      const missing = { ...bindings, [key]: "" };
      const status = getWhatsAppIntegrationStatusForEnv(missing, "live", {
        now,
        deploymentRef,
      });
      expect(status.missingBindingNames).toEqual([key]);
      expect(status.capabilityStatus.state).toBe("unconfigured");
    }
    const unverified = getWhatsAppIntegrationStatusForEnv(bindings, "live", {
      now,
      deploymentRef,
    });
    expect(unverified.capabilityStatus.state).toBe("unverified");
    expect(unverified.capabilityStatus.lastSuccessAt).toBeNull();
    expect(JSON.stringify(unverified)).not.toContain(bindings.WOZTELL_ACCESS_TOKEN);
    expect(JSON.stringify(unverified)).not.toContain(bindings.WOZTELL_WEBHOOK_SECRET);
    expect(() =>
      getWhatsAppIntegrationStatusForActor(
        { role: "Client", active: true, userId: "client" } as AuthenticatedActor,
        bindings,
        "live",
        { now, deploymentRef },
      ),
    ).toThrow();
    const proof = {
      reachable: "yes" as const,
      lastSuccessAt: "2026-09-27T08:59:00.000Z",
      checkedAt: now,
      deploymentRef,
      evidenceRef: "woztell-probe:t17",
    };
    expect(
      getWhatsAppIntegrationStatusForEnv(bindings, "live", {
        now,
        deploymentRef,
        probe: { ...proof, deploymentRef: "deadbeef1234567" },
      }).capabilityStatus.state,
    ).toBe("unverified");
    expect(
      getWhatsAppIntegrationStatusForEnv(bindings, "live", {
        now,
        deploymentRef,
        probe: { ...proof, lastSuccessAt: "2026-09-26T08:59:00.000Z" },
      }).capabilityStatus.state,
    ).toBe("unverified");
    expect(
      getWhatsAppIntegrationStatusForEnv(bindings, "live", {
        now,
        deploymentRef,
        probe: { ...proof, lastSuccessAt: "2026-09-27T09:10:00.000Z" },
      }).capabilityStatus.state,
    ).toBe("unverified");
    expect(
      getWhatsAppIntegrationStatusForEnv(bindings, "live", {
        now,
        deploymentRef,
        probe: proof,
      }).capabilityStatus.state,
    ).toBe("healthy");
  });
});
