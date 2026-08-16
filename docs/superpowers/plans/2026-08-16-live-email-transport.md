# Live Email Transport for the Notification Dispatcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `channel: "email"` notifications actually send in live mode, via Resend, without coupling Resend's configuration to `getFirmRuntimeEnv()`'s all-or-nothing gate.

**Architecture:** `createNotificationTransport`'s live branch becomes a small composite that routes on `notification.channel` — `"whatsapp"` to the existing, unchanged WOZTELL transport, `"email"` to a new Resend-backed transport. Each sub-transport is built from independently-sourced config, so a firm with no Resend configuration keeps dispatching WhatsApp exactly as today; only an actual email notification fails, through the dispatcher's existing retry/fail path.

**Tech Stack:** TypeScript strict, Vitest, Resend HTTP API (`POST https://api.resend.com/emails`), the existing `NotificationTransport`/`NotificationOutboxRecord` types.

---

## Context you need before task 1

**Source of truth:** `docs/superpowers/specs/2026-08-16-live-email-transport-design.md` — read it if you want the full reasoning; this plan pulls in everything actually needed to implement it, verified against the current repo rather than assumed.

**The prior incident this plan must not repeat.** An earlier attempt added `RESEND_API_KEY`/`RESEND_FROM` to `src/server/runtime-env.ts`'s `REQUIRED_BINDINGS` — the array `getFirmRuntimeEnv()` checks before returning anything, all-or-nothing. That broke WhatsApp dispatch and document storage for any firm without Resend configured, because those call sites use `getFirmRuntimeEnv()` too, for fields that have nothing to do with email. It was reverted; the comment above `REQUIRED_BINDINGS` in that file explains why. **Do not add RESEND_API_KEY/RESEND_FROM to that array in this plan.** Read a Resend config through the new `getResendConfig()` accessor this plan adds instead — a sibling function, not a REQUIRED_BINDINGS entry.

**One assumption not yet verified against this codebase, carried over from the design spec:** Resend's documented success response is `{"id": "..."}`. Nothing in this repo has read that field before — the existing magic-link sender (`src/features/auth/neon-auth-magic-link.ts`) only checks `response.ok` and never parses the body. Task 2's tests assert against that documented shape; if a live Resend sandbox test during acceptance shows a different shape, fix the transport's response parsing, not the tests' understanding of what a "correct" test looks like.

**A relocation folded into Task 2.** `notificationPayload()` currently lives only in `dispatcher.ts`, with no other importer anywhere in the codebase (confirmed by grep). The new Resend transport needs the same tiny payload-extraction guard `dispatcher.ts` already uses for the WOZTELL transport. Importing it from `dispatcher.ts` into a new `resend-transport.ts` would create dispatcher.ts → resend-transport.ts → dispatcher.ts, a circular import. Task 2 moves `notificationPayload` to `src/features/notifications/types.ts` (which already defines the `NotificationOutboxRecord` type it operates on) and updates `dispatcher.ts` to import it from there instead of defining its own copy. This is a small, mechanical, behavior-preserving move — no test changes needed for it beyond confirming the existing dispatcher tests still pass.

All paths below are relative to the repo root. Work on branch `codex/live-email-transport` (already created, already has the design spec committed).

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/server/runtime-env.ts` | Modify | Add `ResendConfig` type + `getResendConfig()`, independent of `REQUIRED_BINDINGS` |
| `src/server/runtime-env.test.ts` | Modify | Test `getResendConfig` |
| `src/features/notifications/types.ts` | Modify | Gains `notificationPayload()`, relocated from `dispatcher.ts` |
| `src/features/notifications/resend-transport.ts` | **Create** | The new email transport, matching `local-transport.ts`/`simulated-transport.ts`'s one-file-per-transport pattern |
| `src/features/notifications/resend-transport.test.ts` | **Create** | Tests for the transport in isolation |
| `src/features/notifications/dispatcher.ts` | Modify | `notificationPayload` now imported from `./types`; `createNotificationTransport`'s live branch becomes a channel-routing composite |
| `src/features/notifications/dispatcher.test.ts` | Modify | New tests for the composite routing |
| `src/features/notifications/runtime-dispatch.ts` | Modify | Wires `getResendConfig()` through to `createNotificationTransport`, live-mode-only, mirroring how `getLiveConfig()` already works |
| `src/features/notifications/runtime-dispatch.test.ts` | Modify | Fix one existing exact-match assertion that breaks the moment `resendConfig` is added to the call; add coverage for the new wiring |

---

## Task 1: `getResendConfig` — an independent config accessor

**Files:**
- Modify: `src/server/runtime-env.ts`
- Modify: `src/server/runtime-env.test.ts`

### Step 1: Write the failing tests

Add to `src/server/runtime-env.test.ts`, as a new `describe` block (the file already imports `getFirmRuntimeEnv, getRuntimeReadiness` from `"./runtime-env"` — extend that import to add `getResendConfig`):

```typescript
describe("getResendConfig", () => {
  it("returns null when either RESEND_API_KEY or RESEND_FROM is missing", () => {
    expect(getResendConfig({})).toBeNull();
    expect(getResendConfig({ RESEND_API_KEY: "re_test_key" })).toBeNull();
    expect(getResendConfig({ RESEND_FROM: "auth@example.test" })).toBeNull();
  });

  it("returns null when either value is blank", () => {
    expect(getResendConfig({ RESEND_API_KEY: "   ", RESEND_FROM: "auth@example.test" })).toBeNull();
    expect(getResendConfig({ RESEND_API_KEY: "re_test_key", RESEND_FROM: "   " })).toBeNull();
  });

  it("returns a trimmed config when both are present", () => {
    expect(
      getResendConfig({
        RESEND_API_KEY: "  re_test_key  ",
        RESEND_FROM: "  Kossilon Hub <auth@example.test>  ",
      }),
    ).toEqual({ apiKey: "re_test_key", from: "Kossilon Hub <auth@example.test>" });
  });

  it("is independent of every other runtime binding", () => {
    // A firm with no WOZTELL/Neon Auth config at all can still have a valid
    // Resend config — this must never route through getRuntimeReadiness/
    // getFirmRuntimeEnv's REQUIRED_BINDINGS check.
    expect(
      getResendConfig({ RESEND_API_KEY: "re_test_key", RESEND_FROM: "auth@example.test" }),
    ).toEqual({ apiKey: "re_test_key", from: "auth@example.test" });
  });
});
```

Run: `npm run test -- src/server/runtime-env.test.ts -t "getResendConfig"`
Expected: FAIL — `getResendConfig is not a function`.

### Step 2: Implement it

In `src/server/runtime-env.ts`, add after `getFirmRuntimeEnv`'s closing brace (the function currently ends at line 179 in this file):

```typescript
export type ResendConfig = { apiKey: string; from: string };

/**
 * A deliberate sibling to getFirmRuntimeEnv, not part of it. RESEND_API_KEY/
 * RESEND_FROM must never join REQUIRED_BINDINGS — see the comment above that
 * array. Returns null (never throws) so a caller can build a WhatsApp transport
 * regardless of whether Resend is configured; only the email channel should
 * fail when this is null.
 */
export function getResendConfig(
  env: Record<string, unknown> = defaultRuntimeSource(),
): ResendConfig | null {
  const apiKey = env.RESEND_API_KEY;
  const from = env.RESEND_FROM;
  if (!hasText(apiKey) || !hasText(from)) return null;
  return { apiKey: apiKey.trim(), from: from.trim() };
}
```

`hasText` is already defined earlier in this file (`function hasText(value: unknown): value is string`) — reuse it, don't redefine it.

### Step 3: Run the tests

Run: `npm run test -- src/server/runtime-env.test.ts`
Expected: PASS, all cases including every pre-existing test in the file.

### Step 4: Verify

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm run lint`
Expected: clean. Check the actual exit code directly — do not pipe through `tail` or anything else that could mask a non-zero exit.

### Step 5: Commit

```bash
git add src/server/runtime-env.ts src/server/runtime-env.test.ts
git commit -m "feat(notifications): add an independent Resend config accessor"
```

---

## Task 2: The Resend notification transport

**Files:**
- Modify: `src/features/notifications/types.ts`
- Modify: `src/features/notifications/dispatcher.ts`
- Create: `src/features/notifications/resend-transport.ts`
- Create: `src/features/notifications/resend-transport.test.ts`

### Step 1: Relocate `notificationPayload` to `types.ts`

Read `src/features/notifications/dispatcher.ts` and `src/features/notifications/types.ts` in full first.

In `src/features/notifications/types.ts`, add at the end of the file:

```typescript
export function notificationPayload(
  notification: NotificationOutboxRecord,
): Record<string, unknown> {
  if (
    !notification.payload ||
    typeof notification.payload !== "object" ||
    Array.isArray(notification.payload)
  ) {
    return {};
  }
  return notification.payload as Record<string, unknown>;
}
```

In `src/features/notifications/dispatcher.ts`:
- Remove the `notificationPayload` function definition entirely — currently the last thing in the file (lines 141-152):
  ```typescript
  export function notificationPayload(
    notification: NotificationOutboxRecord,
  ): Record<string, unknown> {
    if (
      !notification.payload ||
      typeof notification.payload !== "object" ||
      Array.isArray(notification.payload)
    ) {
      return {};
    }
    return notification.payload as Record<string, unknown>;
  }
  ```
- Replace the current `./types` import (lines 7-13):
  ```typescript
  import type {
    DispatchSummary,
    NotificationDispatcher,
    NotificationOutboxRecord,
    NotificationOutboxRepository,
    NotificationTransport,
  } from "./types";
  ```
  with a single combined import — `notificationPayload` is a value now, not a type, but it must stay in the same import statement as the rest (a second `from "./types"` line trips this repo's `import/no-duplicates` lint rule):
  ```typescript
  import {
    notificationPayload,
    type DispatchSummary,
    type NotificationDispatcher,
    type NotificationOutboxRecord,
    type NotificationOutboxRepository,
    type NotificationTransport,
  } from "./types";
  ```

Run: `npm run test -- src/features/notifications/dispatcher.test.ts`
Expected: PASS, unchanged — this step is a pure relocation with no behavior change. If anything fails, you have moved something incorrectly; do not proceed until this is genuinely green.

Commit this step on its own before continuing:

```bash
git add src/features/notifications/types.ts src/features/notifications/dispatcher.ts
git commit -m "refactor(notifications): move notificationPayload to types.ts"
```

### Step 2: Write the failing tests for the new transport

Create `src/features/notifications/resend-transport.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { createResendNotificationTransport } from "./resend-transport";
import type { NotificationOutboxRecord } from "./types";

const config = { apiKey: "re_test_key", from: "Kossilon Hub <auth@example.test>" };

function notification(overrides: Partial<NotificationOutboxRecord> = {}): NotificationOutboxRecord {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    companyId: "00000000-0000-0000-0000-000000000002",
    workItemId: null,
    channel: "email",
    notificationType: "test",
    idempotencyKey: "test-key",
    recipient: "client@example.test",
    payload: { body: "Reminder body" },
    status: "processing",
    attemptCount: 1,
    maxAttempts: 3,
    nextAttemptAt: "2026-07-12T00:00:00.000Z",
    providerMessageId: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    sentAt: null,
    retentionUntil: "2026-10-12T00:00:00.000Z",
    ...overrides,
  };
}

function successResponse(id: string) {
  return new Response(JSON.stringify({ id }), { status: 200 });
}

describe("createResendNotificationTransport", () => {
  it("posts the documented Resend request shape", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      seenUrl = String(input);
      seenInit = init;
      return successResponse("resend-msg-1");
    });

    await expect(
      createResendNotificationTransport(config, fetchImpl).dispatch(notification()),
    ).resolves.toEqual({ providerMessageId: "resend-msg-1" });

    expect(seenUrl).toBe("https://api.resend.com/emails");
    expect(seenInit?.method).toBe("POST");
    const headers = seenInit?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer re_test_key");
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["idempotency-key"]).toBe("notification-outbox/test-key");
    expect(JSON.parse(String(seenInit?.body))).toEqual({
      from: "Kossilon Hub <auth@example.test>",
      to: ["client@example.test"],
      subject: "Kossilon Hub notification",
      text: "Reminder body",
    });
  });

  it("uses a supplied subject instead of the default", async () => {
    const fetchImpl = vi.fn(async () => successResponse("resend-msg-2"));

    await createResendNotificationTransport(config, fetchImpl).dispatch(
      notification({ payload: { body: "Reminder body", subject: "Annual return reminder" } }),
    );

    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(body.subject).toBe("Annual return reminder");
  });

  it("rejects a non-email channel", async () => {
    await expect(
      createResendNotificationTransport(config, vi.fn()).dispatch(
        notification({ channel: "whatsapp" }),
      ),
    ).rejects.toThrow("Unsupported notification channel: whatsapp.");
  });

  it("rejects a notification with no recipient", async () => {
    await expect(
      createResendNotificationTransport(config, vi.fn()).dispatch(
        notification({ recipient: null }),
      ),
    ).rejects.toThrow("Email notification is missing a recipient.");
  });

  it("rejects a notification with no message body", async () => {
    await expect(
      createResendNotificationTransport(config, vi.fn()).dispatch(notification({ payload: {} })),
    ).rejects.toThrow("Email notification is missing a message body.");
  });

  it("throws a resend_<status>-coded error on a non-2xx response", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "Invalid `from` address." }), { status: 422 }),
    );

    await expect(
      createResendNotificationTransport(config, fetchImpl).dispatch(notification()),
    ).rejects.toMatchObject({
      message: "Invalid `from` address.",
      code: "resend_422",
    });
  });

  it("falls back to a generic message when the error response has no message field", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 500 }));

    await expect(
      createResendNotificationTransport(config, fetchImpl).dispatch(notification()),
    ).rejects.toMatchObject({
      message: "Resend rejected the send with HTTP 500.",
      code: "resend_500",
    });
  });

  it("throws when a successful response is missing a provider message id", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));

    await expect(
      createResendNotificationTransport(config, fetchImpl).dispatch(notification()),
    ).rejects.toThrow("Resend response is missing a provider message ID.");
  });
});
```

Run: `npm run test -- src/features/notifications/resend-transport.test.ts`
Expected: FAIL — the module does not exist yet.

### Step 3: Implement the transport

Create `src/features/notifications/resend-transport.ts`:

```typescript
import type { ResendConfig } from "@/server/runtime-env";
import { notificationPayload, type NotificationTransport } from "./types";

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

### Step 4: Run the tests

Run: `npm run test -- src/features/notifications/resend-transport.test.ts`
Expected: PASS, all cases.

### Step 5: Verify

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm run lint`
Expected: clean, exit code checked directly.

### Step 6: Commit

```bash
git add src/features/notifications/resend-transport.ts src/features/notifications/resend-transport.test.ts
git commit -m "feat(notifications): add the Resend email transport"
```

---

## Task 3: Composite routing in `createNotificationTransport`

**Files:**
- Modify: `src/features/notifications/dispatcher.ts`
- Modify: `src/features/notifications/dispatcher.test.ts`

### Step 1: Write the failing tests

Read `src/features/notifications/dispatcher.test.ts` in full first — it already defines a `notification(overrides)` helper at the top; reuse it, do not redefine it.

Append to `src/features/notifications/dispatcher.test.ts`:

```typescript
describe("createNotificationTransport (live mode composite routing)", () => {
  const whatsappConfig = {
    provider: "woztell" as const,
    apiBaseUrl: "https://api.example.test",
    accessToken: "test-token",
    channelId: "channel-1",
    webhookSecret: "test-secret-value",
  };
  const resendConfig = { apiKey: "re_test_key", from: "Kossilon Hub <auth@example.test>" };

  it("routes a whatsapp notification to the WOZTELL transport, unchanged", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: 1,
            sendResult: { ok: 1, result: [{ result: { messages: [{ id: "wamid.1" }] } }] },
          }),
          { status: 200 },
        ),
    );

    await expect(
      createNotificationTransport({
        providerMode: "live",
        config: whatsappConfig,
        resendConfig,
        fetchImpl,
      }).dispatch(
        notification({ channel: "whatsapp", recipient: "+85290000000", payload: { body: "hi" } }),
      ),
    ).resolves.toEqual({ providerMessageId: "wamid.1" });
  });

  it("routes an email notification to the Resend transport when configured", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ id: "resend-msg-1" }), { status: 200 }),
    );

    await expect(
      createNotificationTransport({
        providerMode: "live",
        config: whatsappConfig,
        resendConfig,
        fetchImpl,
      }).dispatch(
        notification({
          channel: "email",
          recipient: "client@example.test",
          payload: { body: "hi" },
        }),
      ),
    ).resolves.toEqual({ providerMessageId: "resend-msg-1" });
  });

  it("fails only the email channel, with a diagnostic code, when Resend is not configured", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: 1,
            sendResult: { ok: 1, result: [{ result: { messages: [{ id: "wamid.2" }] } }] },
          }),
          { status: 200 },
        ),
    );
    const transport = createNotificationTransport({
      providerMode: "live",
      config: whatsappConfig,
      resendConfig: null,
      fetchImpl,
    });

    await expect(
      transport.dispatch(
        notification({
          channel: "email",
          recipient: "client@example.test",
          payload: { body: "hi" },
        }),
      ),
    ).rejects.toMatchObject({ code: "resend_not_configured" });

    // Same transport instance — WhatsApp must be completely unaffected.
    await expect(
      transport.dispatch(
        notification({ channel: "whatsapp", recipient: "+85290000000", payload: { body: "hi" } }),
      ),
    ).resolves.toEqual({ providerMessageId: "wamid.2" });
  });

  it("still rejects an in_app notification, unchanged from today", async () => {
    await expect(
      createNotificationTransport({
        providerMode: "live",
        config: whatsappConfig,
        resendConfig,
      }).dispatch(notification({ channel: "in_app" })),
    ).rejects.toThrow("Unsupported notification channel: in_app.");
  });
});
```

Run: `npm run test -- src/features/notifications/dispatcher.test.ts -t "composite routing"`
Expected: FAIL — `createNotificationTransport` does not yet accept `resendConfig`, and the live branch still returns the WOZTELL-only transport unconditionally (so the email tests fail, and the in_app test currently passes coincidentally since WOZTELL's own transport already rejects non-whatsapp channels — that's fine, it will keep passing after the change too).

### Step 2: Implement the composite routing

In `src/features/notifications/dispatcher.ts`, add to the imports:

```typescript
import type { ResendConfig } from "@/server/runtime-env";
import { createResendNotificationTransport } from "./resend-transport";
```

Replace `createNotificationTransport` (the last function in the file, after your Task 2 Step 1 relocation of `notificationPayload`):

```typescript
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

### Step 3: Run the tests

Run: `npm run test -- src/features/notifications/dispatcher.test.ts`
Expected: PASS, all cases including every pre-existing test in the file (the "selects the simulated transport" and "selects the local transport" tests return before reaching any of this new logic, so they are unaffected).

### Step 4: Verify

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm run lint`
Expected: clean, exit code checked directly.

### Step 5: Commit

```bash
git add src/features/notifications/dispatcher.ts src/features/notifications/dispatcher.test.ts
git commit -m "feat(notifications): route email notifications to Resend in live mode"
```

---

## Task 4: Wire `getResendConfig` through the runtime dispatch path

**Files:**
- Modify: `src/features/notifications/runtime-dispatch.ts`
- Modify: `src/features/notifications/runtime-dispatch.test.ts`

### Step 1: Fix the one existing test this change will break

Read `src/features/notifications/runtime-dispatch.test.ts` in full first.

The test `"selects simulated mode without requesting live configuration"` (currently asserting `expect(createTransport).toHaveBeenCalledWith({ providerMode: "simulated", config: undefined });`) uses an exact-match assertion. Once `resendConfig` is added to every call `dispatchDueNotificationsWithDependencies` makes to `createTransport`, this exact object will gain an extra key and the assertion will fail — not because anything is wrong, but because the assertion was written before `resendConfig` existed. Update it now, in this same step, before writing any new test:

```typescript
    expect(createTransport).toHaveBeenCalledWith({
      providerMode: "simulated",
      config: undefined,
      resendConfig: undefined,
    });
```

The other existing assertion in this file, `expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ providerMode: "live", config: expect.any(Object) }));`, uses `objectContaining` and does **not** need to change — `objectContaining` ignores extra keys.

Run: `npm run test -- src/features/notifications/runtime-dispatch.test.ts`
Expected: still PASS at this point — you have only corrected an assertion to match behavior that has not changed yet. If this fails, you have not yet made the code change from Task 3 available here, or you mis-copied the fix; resolve before continuing.

### Step 2: Write the new failing tests

Append to the same file:

```typescript
  it("passes the resend config through only in live mode", async () => {
    const repo = repository([row]);
    const createTransport = vi.fn(() => ({
      dispatch: vi.fn(async () => ({ providerMessageId: "test-id" })),
    }));
    const getResendConfig = vi.fn(() => ({ apiKey: "re_test_key", from: "auth@example.test" }));

    await dispatchDueNotificationsWithDependencies(
      { now: "2026-07-14T09:00:00.000Z" },
      {
        currentProviderMode: () => "live",
        createRepository: () => repo,
        createTransport,
        getLiveConfig: () => ({
          provider: "woztell",
          apiBaseUrl: "https://example.test",
          accessToken: "test-token",
          channelId: "channel-1",
          webhookSecret: "test-secret-value",
        }),
        getResendConfig,
      },
    );

    expect(getResendConfig).toHaveBeenCalledTimes(1);
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        resendConfig: { apiKey: "re_test_key", from: "auth@example.test" },
      }),
    );
  });

  it("does not request the resend config outside live mode", async () => {
    const repo = repository([row]);
    const getResendConfig = vi.fn(() => ({ apiKey: "re_test_key", from: "auth@example.test" }));

    await dispatchDueNotificationsWithDependencies(
      { now: "2026-07-14T09:00:00.000Z" },
      { currentProviderMode: () => "local", createRepository: () => repo, getResendConfig },
    );

    expect(getResendConfig).not.toHaveBeenCalled();
  });
```

Run: `npm run test -- src/features/notifications/runtime-dispatch.test.ts -t "resend config"`
Expected: FAIL — `getResendConfig` is not yet part of `RuntimeDispatchDependencies`, and nothing calls it.

### Step 3: Implement the wiring

In `src/features/notifications/runtime-dispatch.ts`, add to the imports:

```typescript
import type { ResendConfig } from "@/server/runtime-env";
```

Replace `RuntimeDispatchDependencies`:

```typescript
export type RuntimeDispatchDependencies = {
  currentProviderMode(): ProviderMode;
  createRepository(): NotificationOutboxRepository;
  createTransport?(input: {
    providerMode: ProviderMode;
    config?: WhatsAppProviderConfig;
    resendConfig?: ResendConfig | null;
  }): NotificationTransport;
  getLiveConfig?(): WhatsAppProviderConfig;
  getResendConfig?(): ResendConfig | null;
  createWhatsAppRepository?(): WhatsAppRepository;
};
```

In `dispatchDueNotificationsWithDependencies`, replace the body of the `try` block up to the `createNotificationDispatcher` call:

```typescript
  try {
    const providerMode = dependencies.currentProviderMode();
    const config = providerMode === "live" ? dependencies.getLiveConfig?.() : undefined;
    const resendConfig = providerMode === "live" ? dependencies.getResendConfig?.() : undefined;
    const transport = (dependencies.createTransport ?? createNotificationTransport)({
      providerMode,
      config,
      resendConfig,
    });
    return await createNotificationDispatcher(repository, transport, {
      whatsAppRepository,
    }).dispatchDue(data.now, data.limit);
  } finally {
```

In `dispatchDueNotificationsOnServer`, add `getResendConfig` to the dependencies object passed to `dispatchDueNotificationsWithDependencies`, immediately after the existing `getLiveConfig` entry:

```typescript
      getResendConfig: () => runtimeEnvModule.getResendConfig(),
```

### Step 4: Run the tests

Run: `npm run test -- src/features/notifications/runtime-dispatch.test.ts`
Expected: PASS, all cases including every pre-existing test in the file.

### Step 5: Verify

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm run lint`
Expected: clean, exit code checked directly.

### Step 6: Commit

```bash
git add src/features/notifications/runtime-dispatch.ts src/features/notifications/runtime-dispatch.test.ts
git commit -m "feat(notifications): wire the Resend config through runtime dispatch"
```

---

## Task 5: Full verification sweep

**Files:** none modified.

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean. Confirm the exit code directly (e.g. run it unpiped, or check `$?` immediately after) — do not trust a piped `tail`/`head` summary, since that reports the pipe's own exit code, not lint's.

- [ ] **Step 3: Full suite**

Run: `npm run test`
Expected: PASS, with a total no lower than this branch's baseline before Task 1.

- [ ] **Step 4: Confirm the prior incident cannot recur**

Run: `grep -n "RESEND_API_KEY\|RESEND_FROM" src/server/runtime-env.ts`
Expected: both names appear only inside `getResendConfig` (and its doc comment) — neither appears inside `REQUIRED_BINDINGS` or `FirmRuntimeEnv`. If either does, something went wrong; do not proceed to commit anything further until this is fixed.

- [ ] **Step 5: Commit and open the PR**

```bash
git push -u origin codex/live-email-transport
```

---

## Acceptance: what "done" means

The suite proves the composite routing and the Resend transport's request/response handling are correct in isolation. It cannot prove Resend actually delivers an email in production — that needs a real `RESEND_API_KEY`/`RESEND_FROM` and a live send, the same class of gap the WOZTELL wire-contract work flagged for its own sandbox verification. Before trusting this in production:

1. With `RESEND_API_KEY`/`RESEND_FROM` configured, trigger a real SLA escalation (or call `dispatchDueNotifications` manually against a test row) and confirm an actual email arrives, and that `notification_outbox`'s row lands `sent` with a real `provider_message_id`.
2. With `RESEND_API_KEY`/`RESEND_FROM` deliberately unset, confirm a WhatsApp notification in the same dispatch batch still sends successfully — proving the per-channel independence this whole design exists for.
3. Confirm Resend's actual success-response shape (`{"id": "..."}`) against a real send, per the caveat above — if it differs, fix `resend-transport.ts`'s parsing, not the test's assumption.

## Out of scope

Everything the design spec places out of scope remains out of scope here: the `in_app` channel, rewriting `work-items/repository.ts`'s enqueue call to add a `subject`/`html` field, the annual-return automated reminder cadence (the next, separate spec), and outbox observability/alerting (roadmap P3-1/P3-2).
