import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  type JsonWebKey as NodeJsonWebKey,
  verify,
} from "node:crypto";

const CONFIRM_PATH = "/auth/magic-link/confirm";
const TICKET_COOKIE = "__Host-kossilon.magic_link_ticket";
const TICKET_AAD = Buffer.from("kossilon-magic-link-ticket-v1");
const MAX_WEBHOOK_AGE_MS = 5 * 60_000;

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

type TicketPayload = {
  expiresAt: string;
  linkUrl: string;
};

type TicketOptions = TicketPayload & {
  cookieSecret: string;
  idempotencyKey?: string;
};

type BaseHandlerOptions = {
  cookieSecret: string;
  neonAuthUrl: string;
  now?: () => number;
};

type WebhookHandlerOptions = BaseHandlerOptions & {
  resendApiKey: string;
  resendFrom: string;
  fetcher?: Fetcher;
};

type MagicLinkWebhookPayload = {
  eventId: string;
  email: string;
  expiresAt: string;
  linkUrl: string;
};

class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function encryptionKey(secret: string): Buffer {
  if (secret.trim().length < 32) {
    throw new Error("NEON_AUTH_COOKIE_SECRET must be at least 32 characters.");
  }
  return createHash("sha256").update(secret).digest();
}

function encode(value: Buffer): string {
  return value.toString("base64url");
}

function parseTicket(cookieSecret: string, ticket: string): TicketPayload {
  try {
    const [version, ivValue, tagValue, encryptedValue, extra] = ticket.split(".");
    if (version !== "v1" || !ivValue || !tagValue || !encryptedValue || extra) {
      throw new Error("Malformed ticket.");
    }

    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(cookieSecret),
      Buffer.from(ivValue, "base64url"),
    );
    decipher.setAAD(TICKET_AAD);
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    const payload = Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(payload) as Partial<TicketPayload>;
    if (typeof parsed.linkUrl !== "string" || typeof parsed.expiresAt !== "string") {
      throw new Error("Malformed ticket payload.");
    }
    return { linkUrl: parsed.linkUrl, expiresAt: parsed.expiresAt };
  } catch {
    throw new RequestError(400, "This sign-in confirmation is invalid.");
  }
}

function expectedMagicLinkPath(neonAuthUrl: string): { origin: string; pathname: string } {
  const baseUrl = new URL(neonAuthUrl);
  const basePath = baseUrl.pathname.replace(/\/$/, "");
  return {
    origin: baseUrl.origin,
    pathname: `${basePath}/magic-link/verify`,
  };
}

function validateTicket(options: BaseHandlerOptions, ticket: string): TicketPayload {
  const payload = parseTicket(options.cookieSecret, ticket);
  const expiresAt = Date.parse(payload.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= (options.now ?? Date.now)()) {
    throw new RequestError(400, "This sign-in confirmation has expired.");
  }

  let linkUrl: URL;
  try {
    linkUrl = new URL(payload.linkUrl);
  } catch {
    throw new RequestError(400, "This sign-in confirmation is invalid.");
  }

  const expected = expectedMagicLinkPath(options.neonAuthUrl);
  if (
    linkUrl.protocol !== "https:" ||
    linkUrl.origin !== expected.origin ||
    linkUrl.pathname !== expected.pathname ||
    !linkUrl.searchParams.get("token")
  ) {
    throw new RequestError(400, "This sign-in confirmation is invalid.");
  }

  return payload;
}

function parseCookies(request: Request): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    cookies.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
  }
  return cookies;
}

function ticketCookie(ticket: string, maxAge: number): string {
  return `${TICKET_COOKIE}=${ticket}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Strict`;
}

function clearTicketCookie(): string {
  return `${TICKET_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

function pageHeaders(): HeadersInit {
  return {
    "cache-control": "no-store",
    "content-security-policy":
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    "content-type": "text/html; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
}

function renderConfirmationPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Confirm sign-in - Kossilon Hub</title>
</head>
<body style="margin:0;background:#f6f7f8;color:#17191c;font-family:Arial,Helvetica,sans-serif">
  <main style="min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box">
    <section style="width:100%;max-width:420px;background:#fff;border:1px solid #dfe2e6;border-radius:8px;padding:32px;box-sizing:border-box">
      <div style="font-size:14px;font-weight:700;color:#245b46">Kossilon Hub</div>
      <h1 style="margin:24px 0 8px;font-size:26px;line-height:1.25">Confirm sign-in</h1>
      <p style="margin:0 0 24px;color:#5d646d;font-size:15px;line-height:1.6">Continue to securely sign in to Compliance Core.</p>
      <form method="post" action="${CONFIRM_PATH}">
        <button type="submit" style="width:100%;border:0;border-radius:6px;background:#1f5b46;color:#fff;padding:12px 16px;font-size:15px;font-weight:700;cursor:pointer">Continue</button>
      </form>
    </section>
  </main>
</body>
</html>`;
}

function renderInvalidPage(message: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign-in link unavailable - Kossilon Hub</title>
</head>
<body style="margin:0;background:#f6f7f8;color:#17191c;font-family:Arial,Helvetica,sans-serif">
  <main style="min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box">
    <section style="width:100%;max-width:420px;background:#fff;border:1px solid #dfe2e6;border-radius:8px;padding:32px;box-sizing:border-box">
      <div style="font-size:14px;font-weight:700;color:#245b46">Kossilon Hub</div>
      <h1 style="margin:24px 0 8px;font-size:26px;line-height:1.25">Sign-in link unavailable</h1>
      <p style="margin:0 0 24px;color:#5d646d;font-size:15px;line-height:1.6">${message}</p>
      <a href="/login" style="display:block;border-radius:6px;background:#1f5b46;color:#fff;padding:12px 16px;text-align:center;text-decoration:none;font-size:15px;font-weight:700">Request a new link</a>
    </section>
  </main>
</body>
</html>`;
}

export function createMagicLinkTicket(options: TicketOptions): string {
  const iv = options.idempotencyKey
    ? createHmac("sha256", encryptionKey(options.cookieSecret))
        .update(`magic-link:${options.idempotencyKey}`)
        .digest()
        .subarray(0, 12)
    : randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(options.cookieSecret), iv);
  cipher.setAAD(TICKET_AAD);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify({ linkUrl: options.linkUrl, expiresAt: options.expiresAt })),
    cipher.final(),
  ]);
  return ["v1", encode(iv), encode(cipher.getAuthTag()), encode(encrypted)].join(".");
}

export function createMagicLinkConfirmationHandler(options: BaseHandlerOptions) {
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      if (url.pathname !== CONFIRM_PATH) throw new RequestError(404, "Not found.");

      if (request.method === "GET") {
        const incomingTicket = url.searchParams.get("ticket");
        if (incomingTicket) {
          const payload = validateTicket(options, incomingTicket);
          const maxAge = Math.max(
            1,
            Math.min(
              600,
              Math.ceil((Date.parse(payload.expiresAt) - (options.now ?? Date.now)()) / 1000),
            ),
          );
          return new Response(null, {
            status: 303,
            headers: {
              "cache-control": "no-store",
              location: CONFIRM_PATH,
              "referrer-policy": "no-referrer",
              "set-cookie": ticketCookie(incomingTicket, maxAge),
            },
          });
        }

        const ticket = parseCookies(request).get(TICKET_COOKIE);
        if (!ticket) throw new RequestError(400, "Request a new magic link to continue.");
        validateTicket(options, ticket);
        return new Response(renderConfirmationPage(), { status: 200, headers: pageHeaders() });
      }

      if (request.method === "POST") {
        const ticket = parseCookies(request).get(TICKET_COOKIE);
        if (!ticket) throw new RequestError(400, "Request a new magic link to continue.");
        const payload = validateTicket(options, ticket);
        return new Response(null, {
          status: 303,
          headers: {
            "cache-control": "no-store",
            location: payload.linkUrl,
            "referrer-policy": "no-referrer",
            "set-cookie": clearTicketCookie(),
          },
        });
      }

      return new Response(null, { status: 405, headers: { allow: "GET, POST" } });
    } catch (error) {
      const requestError =
        error instanceof RequestError ? error : new RequestError(500, "Unable to confirm sign-in.");
      return new Response(renderInvalidPage(requestError.message), {
        status: requestError.status,
        headers: { ...pageHeaders(), "set-cookie": clearTicketCookie() },
      });
    }
  };
}

function requiredHeader(request: Request, name: string): string {
  const value = request.headers.get(name);
  if (!value) throw new RequestError(401, "Invalid webhook signature.");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function verifyWebhook(
  request: Request,
  options: WebhookHandlerOptions,
): Promise<MagicLinkWebhookPayload | null> {
  const rawBody = await request.text();
  const signature = requiredHeader(request, "x-neon-signature");
  const kid = requiredHeader(request, "x-neon-signature-kid");
  const timestamp = requiredHeader(request, "x-neon-timestamp");
  const eventType = requiredHeader(request, "x-neon-event-type");
  const eventId = requiredHeader(request, "x-neon-event-id");
  const timestampNumber = Number(timestamp);
  const age = Math.abs((options.now ?? Date.now)() - timestampNumber);
  if (!Number.isFinite(timestampNumber) || age > MAX_WEBHOOK_AGE_MS) {
    throw new RequestError(401, "Invalid webhook signature.");
  }

  const jwksResponse = await (options.fetcher ?? fetch)(
    `${options.neonAuthUrl.replace(/\/$/, "")}/.well-known/jwks.json`,
  );
  if (!jwksResponse.ok) throw new RequestError(503, "Unable to verify webhook.");
  const jwks = (await jwksResponse.json()) as { keys?: Array<Record<string, unknown>> };
  const jwk = jwks.keys?.find((key) => key.kid === kid);
  if (!jwk) throw new RequestError(401, "Invalid webhook signature.");

  try {
    const [protectedHeader, emptyPayload, signatureValue, extra] = signature.split(".");
    if (!protectedHeader || emptyPayload !== "" || !signatureValue || extra) throw new Error();
    const header = JSON.parse(Buffer.from(protectedHeader, "base64url").toString("utf8")) as {
      alg?: unknown;
      kid?: unknown;
    };
    if (header.alg !== "EdDSA" || header.kid !== kid) throw new Error();

    const payloadB64 = Buffer.from(rawBody).toString("base64url");
    const signaturePayload = Buffer.from(`${timestamp}.${payloadB64}`).toString("base64url");
    const signingInput = `${protectedHeader}.${signaturePayload}`;
    const publicKey = createPublicKey({ key: jwk as NodeJsonWebKey, format: "jwk" });
    if (
      !verify(null, Buffer.from(signingInput), publicKey, Buffer.from(signatureValue, "base64url"))
    ) {
      throw new Error();
    }
  } catch {
    throw new RequestError(401, "Invalid webhook signature.");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new RequestError(400, "Invalid webhook payload.");
  }
  if (!isRecord(payload)) throw new RequestError(400, "Invalid webhook payload.");
  if (payload.event_id !== eventId || payload.event_type !== eventType) {
    throw new RequestError(400, "Invalid webhook payload.");
  }
  if (eventType !== "send.magic_link") return null;
  if (!isRecord(payload.user) || !isRecord(payload.event_data)) {
    throw new RequestError(400, "Invalid webhook payload.");
  }

  const email = payload.user.email;
  const linkType = payload.event_data.link_type;
  const linkUrl = payload.event_data.link_url;
  const expiresAt = payload.event_data.expires_at;
  if (
    typeof email !== "string" ||
    !email.includes("@") ||
    linkType !== "sign-in" ||
    typeof linkUrl !== "string" ||
    typeof expiresAt !== "string"
  ) {
    throw new RequestError(400, "Invalid webhook payload.");
  }

  validateTicket(
    options,
    createMagicLinkTicket({ cookieSecret: options.cookieSecret, linkUrl, expiresAt }),
  );
  return { eventId, email, linkUrl, expiresAt };
}

function emailHtml(confirmationUrl: string): string {
  const safeUrl = confirmationUrl.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background-color:#f6f7f8;font-family:Arial,Helvetica,sans-serif;color:#17191c">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background-color:#f6f7f8">
    <tr><td align="center" style="padding-top:32px;padding-right:16px;padding-bottom:32px;padding-left:16px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background-color:#ffffff;border:1px solid #dfe2e6">
        <tr><td style="padding-top:32px;padding-right:32px;padding-bottom:8px;padding-left:32px;font-size:14px;line-height:20px;color:#245b46;font-weight:700">Kossilon Hub</td></tr>
        <tr><td style="padding-top:16px;padding-right:32px;padding-bottom:8px;padding-left:32px;font-size:24px;line-height:32px;color:#17191c;font-weight:700">Sign in to Compliance Core</td></tr>
        <tr><td style="padding-top:0;padding-right:32px;padding-bottom:24px;padding-left:32px;font-size:15px;line-height:24px;color:#5d646d">Confirm this request to continue securely. This link expires shortly and can be used once.</td></tr>
        <tr><td style="padding-top:0;padding-right:32px;padding-bottom:32px;padding-left:32px">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#1f5b46" style="background-color:#1f5b46;border-radius:6px">
            <a href="${safeUrl}" style="display:inline-block;padding-top:12px;padding-right:20px;padding-bottom:12px;padding-left:20px;color:#ffffff;text-decoration:none;font-size:15px;line-height:20px;font-weight:700">Review sign-in</a>
          </td></tr></table>
        </td></tr>
        <tr><td style="padding-top:20px;padding-right:32px;padding-bottom:24px;padding-left:32px;border-top:1px solid #eceef0;font-size:12px;line-height:19px;color:#777e87">If you did not request this email, you can ignore it.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendMagicLinkEmail(
  payload: MagicLinkWebhookPayload,
  request: Request,
  options: WebhookHandlerOptions,
): Promise<void> {
  const ticket = createMagicLinkTicket({
    cookieSecret: options.cookieSecret,
    linkUrl: payload.linkUrl,
    expiresAt: payload.expiresAt,
    idempotencyKey: payload.eventId,
  });
  const confirmationUrl = new URL(CONFIRM_PATH, new URL(request.url).origin);
  confirmationUrl.searchParams.set("ticket", ticket);
  const response = await (options.fetcher ?? fetch)("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${options.resendApiKey}`,
      "content-type": "application/json",
      "idempotency-key": `neon-magic-link/${payload.eventId}`,
    },
    body: JSON.stringify({
      from: options.resendFrom,
      to: [payload.email],
      subject: "Sign in to Kossilon Hub",
      html: emailHtml(confirmationUrl.toString()),
      text: `Review and confirm your Kossilon Hub sign-in request:\n\n${confirmationUrl.toString()}\n\nIf you did not request this email, you can ignore it.`,
    }),
  });
  if (!response.ok) throw new RequestError(502, "Magic-link delivery failed.");
}

export function createNeonMagicLinkWebhookHandler(options: WebhookHandlerOptions) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: { allow: "POST" } });
    }

    try {
      const payload = await verifyWebhook(request, options);
      if (payload) await sendMagicLinkEmail(payload, request, options);
      return new Response(null, { status: 204 });
    } catch (error) {
      const requestError =
        error instanceof RequestError ? error : new RequestError(500, "Webhook failed.");
      return Response.json({ error: requestError.message }, { status: requestError.status });
    }
  };
}
