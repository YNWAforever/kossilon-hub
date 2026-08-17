# Live email transport for the notification dispatcher — design

**Date:** 16 August 2026
**Status:** approved, ready for an implementation plan
**Roadmap reference:** P0-6 (`01-Kossilon-Hub-Roadmap-P0-P3.md`)
**Scope:** `src/features/notifications/` only. No change to any caller's enqueue payload, no change to `runtime-env.ts`'s `REQUIRED_BINDINGS`/`FirmRuntimeEnv`.

---

## 1. The problem, verified against current code

`createNotificationTransport` (`src/features/notifications/dispatcher.ts:128-139`) has three provider modes:

```typescript
export function createNotificationTransport(input: {
  providerMode: ProviderMode;
  config?: WhatsAppProviderConfig;
  fetchImpl?: typeof fetch;
}): NotificationTransport {
  if (input.providerMode === "local") return createLocalNotificationTransport();
  if (input.providerMode === "simulated") return createSimulatedNotificationTransport();
  if (!input.config) {
    throw new Error("Live notification transport requires a WhatsApp provider configuration.");
  }
  return createWoztellNotificationTransport(input.config, input.fetchImpl);
}
```

In **live** mode, this always returns `createWoztellNotificationTransport`, whose `dispatch` immediately throws for anything but `channel === "whatsapp"`:

```typescript
async dispatch(notification) {
  if (notification.channel !== "whatsapp")
    throw new Error(`Unsupported notification channel: ${notification.channel}.`);
  ...
```

`work-items/repository.ts:599-614` already enqueues real `channel: "email"` notifications for SLA warnings/breaches whenever an escalation recipient has an email address:

```typescript
if (escalationRecipient?.email) {
  await enqueueNotification(tx, {
    companyId: item.companyId,
    workItemId: item.id,
    channel: "email",
    notificationType: `work_item_sla_${threshold}`,
    recipient: escalationRecipient.email,
    payload: {
      caseId: item.caseId,
      workItemId: item.id,
      threshold,
      occurredAt,
      body: `Work item SLA ${threshold} reached for ${item.title}.`,
    },
  });
}
```

In live mode, every one of these throws on first dispatch, exhausts `maxAttempts` via the dispatcher's existing retry loop, and lands `permanentlyFailed` in `notification_outbox`. Nothing in the application reads that table today, so this failure is currently invisible — an SLA escalation that's supposed to email someone silently never does.

The only working email sender in the codebase is Resend, used exclusively for magic-link auth via a bespoke inline path in `src/server.ts` / `src/features/auth/neon-auth-magic-link.ts` — entirely separate from `notification_outbox` and this dispatcher.

---

## 2. Architecture

`createNotificationTransport`'s live branch becomes a small composite that routes on `notification.channel`:

```
                    ┌─ "whatsapp" ─→ createWoztellNotificationTransport (unchanged)
createNotificationTransport ("live")
                    └─ "email"    ─→ createResendNotificationTransport (new)
                    └─ "in_app"   ─→ throws, exactly as every channel does today (no regression)
```

Each sub-transport is constructed independently of the other's configuration. If Resend isn't configured, WhatsApp dispatch is completely unaffected — only an actual `channel: "email"` notification fails, and it fails through the dispatcher's *existing* retry/fail mechanism (no new error-handling path needed there).

### Why Resend config must NOT go through `getFirmRuntimeEnv()`

`runtime-dispatch.ts`'s `getLiveConfig()` already calls `getFirmRuntimeEnv()` — the all-or-nothing function — to build the WOZTELL config for the *existing* WhatsApp path. `getFirmRuntimeEnv()` throws if **any** entry in `REQUIRED_BINDINGS` is missing. `RESEND_API_KEY`/`RESEND_FROM` were deliberately removed from that array in an earlier fix (`src/server/runtime-env.ts`'s own comment explains why: adding them there once broke WhatsApp dispatch and document storage for any firm without Resend configured, since those call sites need `getFirmRuntimeEnv()` for fields that have nothing to do with email).

Reusing that same function here would silently reintroduce exactly that coupling: a firm without Resend configured would fail to build *any* live transport, including WhatsApp. So this design reads Resend's config through a new, independent accessor:

```typescript
// src/server/runtime-env.ts — a sibling to getFirmRuntimeEnv, not part of it.
// Deliberately does NOT throw and is NOT wired into REQUIRED_BINDINGS: a missing
// Resend config must fail only the email channel, never the WhatsApp one.
export type ResendConfig = { apiKey: string; from: string };

export function getResendConfig(env: Record<string, unknown> = defaultRuntimeSource()): ResendConfig | null {
  const apiKey = env.RESEND_API_KEY;
  const from = env.RESEND_FROM;
  if (typeof apiKey !== "string" || apiKey.trim().length === 0) return null;
  if (typeof from !== "string" || from.trim().length === 0) return null;
  return { apiKey: apiKey.trim(), from: from.trim() };
}
```

`createNotificationTransport` gains an optional `resendConfig?: ResendConfig | null` input. The call site in `runtime-dispatch.ts` passes `runtimeEnvModule.getResendConfig()` alongside the existing `getLiveConfig()` call — two independent reads, not one shared throw.

### The composite transport

```typescript
// src/features/notifications/dispatcher.ts
export function createNotificationTransport(input: {
  providerMode: ProviderMode;
  config?: WhatsAppProviderConfig;
  resendConfig?: ResendConfig | null;
  fetchImpl?: typeof fetch;
}): NotificationTransport {
  if (input.providerMode === "local") return createLocalNotificationTransport();
  if (input.providerMode === "simulated") return createSimulatedNotificationTransport();
  if (!input.config) {
    throw new Error("Live notification transport requires a WhatsApp provider configuration.");
  }

  const whatsappTransport = createWoztellNotificationTransport(input.config, input.fetchImpl);
  const emailTransport = input.resendConfig
    ? createResendNotificationTransport(input.resendConfig, input.fetchImpl)
    : null;

  return {
    async dispatch(notification) {
      if (notification.channel === "whatsapp") return whatsappTransport.dispatch(notification);
      if (notification.channel === "email") {
        if (!emailTransport) {
          throw Object.assign(new Error("Email notifications are not configured for this firm."), {
            code: "resend_not_configured",
          });
        }
        return emailTransport.dispatch(notification);
      }
      throw new Error(`Unsupported notification channel: ${notification.channel}.`);
    },
  };
}
```

---

## 3. The email transport

New file, matching the existing `local-transport.ts`/`simulated-transport.ts` pattern of one small file per transport:

`src/features/notifications/resend-transport.ts`

Calls Resend exactly as `sendMagicLinkEmail` already does (`src/features/auth/neon-auth-magic-link.ts:412-427`) — same endpoint, same header shape — but keyed on the notification's own `idempotencyKey`, which is already guaranteed unique per row (`NotificationOutboxRecord.idempotencyKey`), rather than inventing a separate key the way the magic-link sender does with its own `eventId`.

**One assumption not yet verified against this codebase:** the success-response shape (`{"id": "..."}`) is Resend's documented API contract, not something exercised anywhere in this repo today — `sendMagicLinkEmail` only checks `response.ok` and never reads the response body, since magic-link has no need for a provider message ID. The implementation plan should confirm this against Resend's actual API reference (or a real test send) before relying on it, the same way the WOZTELL BotAPI response shape was confirmed by reading the platform's own documentation rather than assumed.

```typescript
export function createResendNotificationTransport(
  config: ResendConfig,
  fetchImpl: typeof fetch = fetch,
): NotificationTransport {
  return {
    async dispatch(notification) {
      if (notification.channel !== "email")
        throw new Error(`Unsupported notification channel: ${notification.channel}.`);
      if (!notification.recipient) throw new Error("Email notification is missing a recipient.");

      const payload = notificationPayload(notification);
      const body = typeof payload.body === "string" ? payload.body : undefined;
      if (!body) throw new Error("Email notification is missing a message body.");
      const subject =
        typeof payload.subject === "string" ? payload.subject : "Kossilon Hub notification";

      const response = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          "content-type": "application/json",
          "idempotency-key": `notification-outbox/${notification.idempotencyKey}`,
        },
        body: JSON.stringify({
          from: config.from,
          to: [notification.recipient],
          subject,
          text: body,
        }),
      });
      const responsePayload = (await response.json().catch(() => ({}))) as Record<string, unknown>;

      if (!response.ok) {
        const message =
          typeof responsePayload.message === "string"
            ? responsePayload.message
            : `Resend rejected the send with HTTP ${response.status}.`;
        throw Object.assign(new Error(message), { code: `resend_${response.status}` });
      }

      const providerMessageId = responsePayload.id;
      if (typeof providerMessageId !== "string" || providerMessageId.length === 0) {
        throw new Error("Resend response is missing a provider message ID.");
      }
      return { providerMessageId };
    },
  };
}
```

Notes on choices made here:

- **No HTML body.** `work-items/repository.ts`'s existing payload is plain text (`payload.body`), and nothing today constructs HTML for a notification. Sending `text` only is correct for what's actually enqueued; a future caller wanting HTML can extend `notificationPayload` to read an optional `payload.html` without touching this transport's error handling.
- **Subject defaults, doesn't require a schema change.** Extending `work-items/repository.ts`'s enqueue call to supply a subject is possible later but out of scope — this transport must work with what's enqueued *today* without requiring every existing and future caller to be rewritten first.
- **Error shaping matches the WOZTELL transport's convention** (`code: "resend_<status>"`), so `notification_outbox.last_error_code` becomes genuinely diagnostic instead of falling back to the dispatcher's generic `"dispatch_failed"`.

---

## 4. Testing

All transport tests are already fully injectable via `fetchImpl`, matching the existing WOZTELL transport test pattern — no live network calls, no new test infrastructure needed.

- `getResendConfig`: returns `null` when either var is missing/blank, trims whitespace, returns `{apiKey, from}` when both present.
- `createResendNotificationTransport`: correct request shape (URL, auth header, idempotency-key derived from `idempotencyKey`, body `{from, to, subject, text}`); default subject when payload lacks one; success path returns `providerMessageId` from the response `id`; non-2xx throws with a `resend_<status>` code; a response missing `id` throws a clear "missing provider message ID" error; rejects a non-email `channel` (matching the WOZTELL transport's own self-check).
- `createNotificationTransport` composite routing: `whatsapp` still dispatches to the WOZTELL transport unchanged; `email` dispatches to the Resend transport when `resendConfig` is present; `email` throws a `resend_not_configured`-coded error (not a generic one) when `resendConfig` is absent, and this must **not** prevent a `whatsapp` notification from dispatching in the same test; `in_app` still throws exactly as before.
- Full suite must still pass unchanged for every existing WOZTELL-transport and dispatcher test — this change adds a branch, it does not alter WhatsApp behavior.

---

## 5. Out of scope

- The `in_app` channel. Nothing enqueues it today; it remains unsupported, unchanged from current behavior.
- Rewriting `work-items/repository.ts`'s enqueue call to add a `subject`/`html` field. The new transport works with the existing payload; improving the payload is a separate, optional follow-up.
- The annual-return automated reminder cadence (P1-2) and its Traditional Chinese content rewrite. That is the next spec, and depends on this one only for its email-fallback path — its WhatsApp path is unaffected by whether this lands.
- Retry/backoff tuning, alerting on `permanentlyFailed` rows (roadmap P3-1/P3-2) — this fix makes email notifications *capable* of succeeding; observability into ongoing failures is separate, already-tracked work.

---

## 6. Acceptance

1. An SLA escalation for a work item whose recipient has an email address is enqueued exactly as today, and — with `RESEND_API_KEY`/`RESEND_FROM` configured — is actually delivered instead of exhausting retries and landing `permanentlyFailed`.
2. A firm with no Resend configuration continues to dispatch WhatsApp notifications without any change in behavior; only email-channel notifications fail, with a `resend_not_configured` error code rather than the prior generic `"Unsupported notification channel: email."`.
3. `npm run test`, `npx tsc --noEmit`, and `npm run lint` all clean, with the full suite's count increased only by this change's own new tests.
