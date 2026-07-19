import { generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  createMagicLinkConfirmationHandler,
  createMagicLinkTicket,
  createNeonMagicLinkWebhookHandler,
} from "./neon-auth-magic-link";

const APP_ORIGIN = "https://app.example.test";
const AUTH_URL = "https://auth.example.test/tenant/auth";
const COOKIE_SECRET = "a-secure-cookie-secret-that-is-long-enough";
const NOW = Date.parse("2026-07-19T09:00:00.000Z");
const EXPIRES_AT = new Date(NOW + 5 * 60_000).toISOString();
const MAGIC_LINK = `${AUTH_URL}/magic-link/verify?token=one-time-token&callbackURL=${encodeURIComponent(`${APP_ORIGIN}/login`)}`;

function cookieValue(setCookie: string): string {
  return setCookie.split(";", 1)[0] ?? "";
}

function signedWebhookRequest(payload: object) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const kid = "test-key";
  const timestamp = String(NOW);
  const rawBody = JSON.stringify(payload);
  const protectedHeader = Buffer.from(JSON.stringify({ alg: "EdDSA", kid })).toString("base64url");
  const payloadB64 = Buffer.from(rawBody).toString("base64url");
  const signaturePayload = Buffer.from(`${timestamp}.${payloadB64}`).toString("base64url");
  const signingInput = `${protectedHeader}.${signaturePayload}`;
  const signature = sign(null, Buffer.from(signingInput), privateKey).toString("base64url");
  const jwk = publicKey.export({ format: "jwk" });

  return {
    jwk: { ...jwk, kid, alg: "EdDSA", use: "sig" },
    request: new Request(`${APP_ORIGIN}/api/webhooks/neon-auth`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-neon-delivery-attempt": "1",
        "x-neon-event-id": "event-123",
        "x-neon-event-type": "send.magic_link",
        "x-neon-signature": `${protectedHeader}..${signature}`,
        "x-neon-signature-kid": kid,
        "x-neon-timestamp": timestamp,
      },
      body: rawBody,
    }),
  };
}

describe("Neon magic-link confirmation", () => {
  it("keeps the one-time Neon URL out of GET responses and releases it only after POST", async () => {
    const ticket = createMagicLinkTicket({
      cookieSecret: COOKIE_SECRET,
      linkUrl: MAGIC_LINK,
      expiresAt: EXPIRES_AT,
    });
    const handler = createMagicLinkConfirmationHandler({
      cookieSecret: COOKIE_SECRET,
      neonAuthUrl: AUTH_URL,
      now: () => NOW,
    });

    const captureResponse = await handler(
      new Request(`${APP_ORIGIN}/auth/magic-link/confirm?ticket=${encodeURIComponent(ticket)}`),
    );

    expect(captureResponse.status).toBe(303);
    expect(captureResponse.headers.get("location")).toBe("/auth/magic-link/confirm");
    expect(captureResponse.headers.get("set-cookie")).toContain("HttpOnly");
    expect(captureResponse.headers.get("set-cookie")).toContain("SameSite=Strict");

    const cookie = cookieValue(captureResponse.headers.get("set-cookie") ?? "");
    const pageResponse = await handler(
      new Request(`${APP_ORIGIN}/auth/magic-link/confirm`, { headers: { cookie } }),
    );
    const page = await pageResponse.text();

    expect(pageResponse.status).toBe(200);
    expect(page).toContain("Confirm sign-in");
    expect(page).not.toContain("one-time-token");
    expect(page).not.toContain("auth.example.test");
    expect(page).not.toContain(ticket);

    const submitResponse = await handler(
      new Request(`${APP_ORIGIN}/auth/magic-link/confirm`, {
        method: "POST",
        headers: { cookie },
      }),
    );

    expect(submitResponse.status).toBe(303);
    expect(submitResponse.headers.get("location")).toBe(MAGIC_LINK);
    expect(submitResponse.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("keeps webhook retry tickets stable while ordinary tickets stay randomized", () => {
    const options = {
      cookieSecret: COOKIE_SECRET,
      linkUrl: MAGIC_LINK,
      expiresAt: EXPIRES_AT,
    };

    expect(createMagicLinkTicket({ ...options, idempotencyKey: "event-123" })).toBe(
      createMagicLinkTicket({ ...options, idempotencyKey: "event-123" }),
    );
    expect(createMagicLinkTicket(options)).not.toBe(createMagicLinkTicket(options));
  });

  it("rejects tampered, expired, and wrong-host tickets", async () => {
    const handler = createMagicLinkConfirmationHandler({
      cookieSecret: COOKIE_SECRET,
      neonAuthUrl: AUTH_URL,
      now: () => NOW,
    });
    const expired = createMagicLinkTicket({
      cookieSecret: COOKIE_SECRET,
      linkUrl: MAGIC_LINK,
      expiresAt: new Date(NOW - 1).toISOString(),
    });
    const wrongHost = createMagicLinkTicket({
      cookieSecret: COOKIE_SECRET,
      linkUrl: "https://attacker.example/magic-link/verify?token=stolen",
      expiresAt: EXPIRES_AT,
    });

    for (const ticket of [`${expired}x`, expired, wrongHost]) {
      const response = await handler(
        new Request(`${APP_ORIGIN}/auth/magic-link/confirm`, {
          method: "POST",
          headers: { cookie: `__Host-kossilon.magic_link_ticket=${ticket}` },
        }),
      );

      expect(response.status).toBe(400);
      expect(response.headers.get("location")).toBeNull();
    }
  });
});

describe("Neon magic-link delivery webhook", () => {
  it("verifies Neon, sends an idempotent Resend email, and hides the raw token", async () => {
    const payload = {
      event_id: "event-123",
      event_type: "send.magic_link",
      timestamp: new Date(NOW).toISOString(),
      user: { email: "admin@example.test" },
      event_data: {
        link_type: "sign-in",
        link_url: MAGIC_LINK,
        token: "one-time-token",
        expires_at: EXPIRES_AT,
      },
    };
    const { jwk, request } = signedWebhookRequest(payload);
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (url.endsWith("/.well-known/jwks.json")) {
        return Response.json({ keys: [jwk] });
      }
      if (url === "https://api.resend.com/emails") {
        return Response.json({ id: "email-123" });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });
    const handler = createNeonMagicLinkWebhookHandler({
      cookieSecret: COOKIE_SECRET,
      neonAuthUrl: AUTH_URL,
      resendApiKey: "re_test",
      resendFrom: "Kossilon Hub <auth@example.test>",
      fetcher,
      now: () => NOW,
    });

    const response = await handler(request);

    expect(response.status).toBe(204);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const resendCall = fetcher.mock.calls.find(([input]) =>
      input.toString().includes("resend.com"),
    );
    expect(resendCall).toBeDefined();
    const resendInit = resendCall?.[1] as RequestInit;
    const headers = new Headers(resendInit.headers);
    const email = JSON.parse(String(resendInit.body)) as {
      html: string;
      text: string;
      to: string[];
    };
    expect(headers.get("idempotency-key")).toBe("neon-magic-link/event-123");
    expect(email.to).toEqual(["admin@example.test"]);
    expect(email.html).toContain(`${APP_ORIGIN}/auth/magic-link/confirm?ticket=`);
    expect(email.html).not.toContain("one-time-token");
    expect(email.text).not.toContain("one-time-token");
  });

  it("rejects an invalid signature before sending email", async () => {
    const payload = {
      event_id: "event-123",
      event_type: "send.magic_link",
      user: { email: "admin@example.test" },
      event_data: {
        link_type: "sign-in",
        link_url: MAGIC_LINK,
        expires_at: EXPIRES_AT,
      },
    };
    const { jwk, request } = signedWebhookRequest(payload);
    request.headers.set("x-neon-signature", "invalid..signature");
    const fetcher = vi.fn(async () => Response.json({ keys: [jwk] }));
    const handler = createNeonMagicLinkWebhookHandler({
      cookieSecret: COOKIE_SECRET,
      neonAuthUrl: AUTH_URL,
      resendApiKey: "re_test",
      resendFrom: "Kossilon Hub <auth@example.test>",
      fetcher,
      now: () => NOW,
    });

    const response = await handler(request);

    expect(response.status).toBe(401);
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
