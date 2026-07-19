# Neon Auth Demo Live Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate a dedicated Kossilon demo with real Neon Auth, persistent synthetic data, guarded operator reset, and visibly simulated outbound delivery while leaving production untouched.

**Architecture:** Extend the existing isolated demo seed and validator instead of creating a parallel setup path. Add a demo-only `simulated` provider mode that is allowed in production builds only for `FIRM_ID=kossilon-demo`, plus an operator reset command that truncates only public application tables in the already-verified demo database and then reapplies the deterministic seed. Provision the Neon, Neon Auth, and Vercel resources only after local checks pass and after fresh approval at each external-write boundary.

**Tech Stack:** TypeScript, Bun, Vitest, Postgres.js, TanStack Start, React Query, Neon Postgres, Neon Auth, Vercel.

## Global Constraints

- Production remains at `https://kossilon-hub.vercel.app` and must not be changed by this phase.
- The demo uses a separate Neon project/database, Neon Auth instance, and Vercel project.
- The demo firm identifier is exactly `kossilon-demo`.
- The invited Admin email is exactly `willylai@fimmick.com`.
- `/login` is public; all application routes require Neon Auth.
- Open signup remains disabled.
- Passwords are set or reset only through Neon Auth email and never enter Kossilon code, scripts, logs, screenshots, or Git.
- Demo data persists until the guarded operator reset command runs.
- The reset must preserve or reapply the supplied Admin Auth user ID and must not truncate `schema_migrations` or the `neon_auth` schema.
- `VITE_PROVIDER_MODE=simulated` is valid only when `FIRM_ID=kossilon-demo`; `local` remains forbidden in production builds.
- Simulated WhatsApp and email dispatch must make zero provider network calls and must be visibly identified as demo activity.
- Every cloud resource creation, environment write, account invitation, remote migration, seed, reset, deployment, and live login requires fresh explicit approval immediately before execution.
- Existing untracked `.sdd-artifacts/` files remain unstaged and unchanged.

---

## File Structure

- `scripts/db-reset-neon-auth-demo.ts`: parses the confirmation flag, reuses the existing demo separation checks, truncates only public application tables, reapplies the deterministic seed, and redacts failures.
- `scripts/db-reset-neon-auth-demo.test.ts`: covers confirmation, no-connect failure paths, table boundary, reseeding, cleanup, and redacted CLI output.
- `src/server/provider-mode.ts`: adds the demo-only `simulated` provider mode and runtime firm guard.
- `src/features/notifications/simulated-transport.ts`: returns deterministic simulated provider IDs without calling a provider.
- `src/features/whatsapp/server-fns.ts`: reports `live`, `simulated`, or `blocked` delivery state.
- `src/features/annual-return/components/production-whatsapp-automation.tsx`: displays the demo simulation notice beside durable send controls.
- `src/routes/settings.tsx`: identifies simulated delivery and explains that no external message is sent.
- `scripts/validate-neon-auth-demo.ts`: requires the approved simulated mode and retains database/Auth separation checks.
- `docs/runbooks/neon-auth-demo.md`: records the exact activation, reset, verification, and approval sequence.
- `package.json`: exposes `db:reset:neon-auth-demo`.

---

### Task 1: Guarded Operator Demo Reset

**Files:**
- Create: `scripts/db-reset-neon-auth-demo.ts`
- Create: `scripts/db-reset-neon-auth-demo.test.ts`
- Modify: `package.json`
- Test: `scripts/db-reset-neon-auth-demo.test.ts`

**Interfaces:**
- Consumes: `readDemoSeedConfig(environment): DemoSeedConfig` and `seedAnnualReturn(sql, { adminAuthUserId }): Promise<void>`.
- Produces: `readDemoResetOptions(args): { confirmFirmId: string }`, `runDemoReset(config, dependencies): Promise<void>`, and `runDemoResetCli(args, dependencies): Promise<number>`.
- Produces package command: `npm run db:reset:neon-auth-demo -- --confirm-firm kossilon-demo`.

- [ ] **Step 1: Write failing tests for confirmation and the no-connect boundary**

```ts
import { describe, expect, it, vi } from "vitest";
import { readDemoSeedConfig } from "./db-seed-neon-auth-demo";
import {
  readDemoResetOptions,
  runDemoResetCli,
  DEMO_RESET_CLI_FAILURE_MESSAGE,
} from "./db-reset-neon-auth-demo";

describe("Neon Auth demo reset confirmation", () => {
  it("requires the exact demo firm in --confirm-firm", () => {
    expect(() => readDemoResetOptions([])).toThrow("--confirm-firm requires kossilon-demo.");
    expect(() => readDemoResetOptions(["--confirm-firm", "production"])).toThrow(
      "--confirm-firm requires kossilon-demo.",
    );
    expect(readDemoResetOptions(["--confirm-firm", "kossilon-demo"])).toEqual({
      confirmFirmId: "kossilon-demo",
    });
  });

  it("does not run or connect when confirmation fails", async () => {
    const runReset = vi.fn();
    const writeFailure = vi.fn();

    await expect(
      runDemoResetCli([], {
        loadEnvironment: vi.fn().mockResolvedValue({}),
        readConfig: vi.fn(),
        readOptions: readDemoResetOptions,
        runReset,
        writeFailure,
      }),
    ).resolves.toBe(1);
    expect(runReset).not.toHaveBeenCalled();
    expect(writeFailure).toHaveBeenCalledWith(DEMO_RESET_CLI_FAILURE_MESSAGE);
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the module is missing**

Run: `npx vitest run scripts/db-reset-neon-auth-demo.test.ts`

Expected: FAIL because `scripts/db-reset-neon-auth-demo.ts` does not exist.

- [ ] **Step 3: Implement option parsing and redacted CLI orchestration**

```ts
import { seedAnnualReturn } from "./db-seed-annual-return";
import {
  readDemoSeedConfig,
  type DemoSeedConfig,
} from "./db-seed-neon-auth-demo";
import { createSqlClient, type SqlClient } from "../src/server/db/client";

export const DEMO_RESET_CLI_FAILURE_MESSAGE = "Neon Auth demo reset failed.";

export function readDemoResetOptions(args: string[]): { confirmFirmId: string } {
  const index = args.indexOf("--confirm-firm");
  const confirmFirmId = index >= 0 ? args[index + 1]?.trim() : undefined;
  if (confirmFirmId !== "kossilon-demo") {
    throw new Error("--confirm-firm requires kossilon-demo.");
  }
  return { confirmFirmId };
}

export type DemoResetCliDependencies = {
  loadEnvironment(): Promise<Readonly<Record<string, string | undefined>>>;
  readConfig(environment: Readonly<Record<string, string | undefined>>): DemoSeedConfig;
  readOptions(args: string[]): { confirmFirmId: string };
  runReset(config: DemoSeedConfig): Promise<void>;
  writeFailure(message: string): void;
};

export async function runDemoResetCli(
  args = process.argv.slice(2),
  dependencies: DemoResetCliDependencies = defaultCliDependencies,
): Promise<number> {
  try {
    dependencies.readOptions(args);
    const environment = await dependencies.loadEnvironment();
    const config = dependencies.readConfig(environment);
    if (config.firmId !== "kossilon-demo") throw new Error("Unexpected demo firm.");
    await dependencies.runReset(config);
    return 0;
  } catch {
    dependencies.writeFailure(DEMO_RESET_CLI_FAILURE_MESSAGE);
    return 1;
  }
}
```

The default dependencies must load `dotenv/config`, call `readDemoSeedConfig`, call `runDemoReset`, and write only `DEMO_RESET_CLI_FAILURE_MESSAGE` on failure.

- [ ] **Step 4: Add failing tests for the exact reset boundary and reseed order**

```ts
it("truncates only public application tables, then reapplies the Admin seed", async () => {
  const config = readDemoSeedConfig({
    DEMO_DATABASE_URL: "postgresql://demo.example.test/kossilon_demo",
    DEMO_AUTH_USER_ID: "demo-admin-user",
    DEMO_FIRM_ID: "kossilon-demo",
    PRODUCTION_DATABASE_URL: "postgresql://production.example.test/kossilon_production",
  });
  const unsafe = vi.fn().mockResolvedValue(undefined);
  const begin = vi.fn(async (callback) => callback({ unsafe }));
  const end = vi.fn().mockResolvedValue(undefined);
  const seedAnnualReturn = vi.fn().mockResolvedValue(undefined);
  const writeSuccess = vi.fn();

  await runDemoReset(config, {
    createSqlClient: vi.fn().mockReturnValue({ begin, end }),
    seedAnnualReturn,
    writeSuccess,
  });

  const statement = unsafe.mock.calls[0][0] as string;
  expect(statement).toContain("truncate table");
  expect(statement).toContain("public.notification_outbox");
  expect(statement).toContain("public.whatsapp_messages");
  expect(statement).not.toContain("schema_migrations");
  expect(statement).not.toContain("neon_auth");
  expect(seedAnnualReturn).toHaveBeenCalledWith(
    expect.anything(),
    { adminAuthUserId: config.authUserId },
  );
  expect(unsafe.mock.invocationCallOrder[0]).toBeLessThan(
    seedAnnualReturn.mock.invocationCallOrder[0],
  );
  expect(end).toHaveBeenCalledTimes(1);
  expect(writeSuccess).toHaveBeenCalledWith(
    "Reset Neon Auth demo data for DEMO_FIRM_ID=kossilon-demo.",
  );
});
```

- [ ] **Step 5: Implement the fixed public-table reset list and reseed**

```ts
const DEMO_RESET_TABLES = [
  "assignment_events",
  "escalation_events",
  "notification_outbox",
  "document_upload_intents",
  "whatsapp_webhook_events",
  "whatsapp_messages",
  "whatsapp_templates",
  "whatsapp_contacts",
  "annual_return_audit_events",
  "staff_skills",
  "client_company_memberships",
  "business_calendar_holidays",
  "work_items",
  "sla_policies",
  "business_calendars",
  "staff_profiles",
  "reminder_logs",
  "case_notes",
  "timeline_events",
  "payments",
  "annual_return_checklist_items",
  "annual_return_cases",
  "documents",
  "companies",
  "teams",
  "users",
] as const;

const DEMO_RESET_SQL = `truncate table ${DEMO_RESET_TABLES.map(
  (table) => `public.${table}`,
).join(", ")} restart identity cascade`;

export type DemoResetDependencies = {
  createSqlClient(url: string, options: { max: 1 }): SqlClient;
  seedAnnualReturn(sql: SqlClient, options: { adminAuthUserId: string }): Promise<void>;
  writeSuccess(message: string): void;
};

export async function runDemoReset(
  config: DemoSeedConfig,
  dependencies: DemoResetDependencies = defaultResetDependencies,
): Promise<void> {
  const sql = dependencies.createSqlClient(config.databaseUrl, { max: 1 });
  try {
    await sql.begin(async (tx) => tx.unsafe(DEMO_RESET_SQL));
    await dependencies.seedAnnualReturn(sql, { adminAuthUserId: config.authUserId });
    dependencies.writeSuccess(`Reset Neon Auth demo data for DEMO_FIRM_ID=${config.firmId}.`);
  } finally {
    await sql.end();
  }
}

const defaultResetDependencies: DemoResetDependencies = {
  createSqlClient,
  seedAnnualReturn,
  writeSuccess: (message) => console.log(message),
};

const defaultCliDependencies: DemoResetCliDependencies = {
  loadEnvironment: async () => {
    await import("dotenv/config");
    return process.env;
  },
  readConfig: readDemoSeedConfig,
  readOptions: readDemoResetOptions,
  runReset: runDemoReset,
  writeFailure: (message) => console.error(message),
};

if (import.meta.main) {
  process.exitCode = await runDemoResetCli();
}
```

Keep truncation and seeding as two explicit transactions: the fixed-table truncate is atomic, while the existing seed retains its own tested transaction. A seed failure must return failure and never print reset success; rerunning the same command recovers the dedicated demo database.

- [ ] **Step 6: Add the package command**

```json
{
  "scripts": {
    "db:reset:neon-auth-demo": "bun scripts/db-reset-neon-auth-demo.ts"
  }
}
```

- [ ] **Step 7: Run reset and existing seed tests**

Run: `npx vitest run scripts/db-reset-neon-auth-demo.test.ts scripts/db-seed-neon-auth-demo.test.ts scripts/db-seed-annual-return.test.ts`

Expected: PASS with no network calls and no secret values in output.

- [ ] **Step 8: Commit the reset boundary**

```powershell
git add scripts/db-reset-neon-auth-demo.ts scripts/db-reset-neon-auth-demo.test.ts package.json
git commit -m "feat: add guarded Neon demo reset"
```

---

### Task 2: Demo-Only Simulated Provider Mode

**Files:**
- Modify: `src/server/provider-mode.ts`
- Modify: `src/server/provider-mode.test.ts`
- Create: `src/features/notifications/simulated-transport.ts`
- Create: `src/features/notifications/simulated-transport.test.ts`
- Modify: `src/features/notifications/dispatcher.ts`
- Modify: `src/features/notifications/dispatcher.test.ts`
- Modify: `src/features/notifications/runtime-dispatch.ts`
- Modify: `src/features/notifications/runtime-dispatch.test.ts`
- Modify: `src/features/annual-return/follow-up-server-fns.ts`
- Modify: `src/features/annual-return/follow-up-server-fns.test.ts`

**Interfaces:**
- Produces: `ProviderMode = "local" | "simulated" | "live"`.
- Produces: `resolveProviderMode({ requested, isProductionBuild, firmId }): ProviderMode`.
- Produces: `createSimulatedNotificationTransport(): NotificationTransport`.
- Simulated provider message IDs use `simulated:<channel>:<notification-id>`.
- Produces: `dispatchSimulatedFollowUpIfNeeded(dependencies): Promise<DispatchSummary | null>`; it runs only after the enqueue transaction commits.

- [ ] **Step 1: Write failing provider-mode tests**

```ts
it("allows simulated providers only for the exact demo firm", () => {
  expect(
    resolveProviderMode({
      requested: "simulated",
      isProductionBuild: true,
      firmId: "kossilon-demo",
    }),
  ).toBe("simulated");

  expect(() =>
    resolveProviderMode({
      requested: "simulated",
      isProductionBuild: true,
      firmId: "customer-firm",
    }),
  ).toThrow("Simulated providers are available only for kossilon-demo.");
});

it("continues to reject local providers in production", () => {
  expect(() =>
    resolveProviderMode({ requested: "local", isProductionBuild: true, firmId: "kossilon-demo" }),
  ).toThrow("Local providers are unavailable in production builds.");
});
```

- [ ] **Step 2: Run the provider-mode test and confirm it fails**

Run: `npx vitest run src/server/provider-mode.test.ts`

Expected: FAIL because `simulated` is not a `ProviderMode` and `firmId` is not accepted.

- [ ] **Step 3: Implement the three-state provider resolver**

```ts
export type ProviderMode = "local" | "simulated" | "live";

export function resolveProviderMode(input: {
  requested: ProviderMode;
  isProductionBuild: boolean;
  firmId?: string;
}): ProviderMode {
  if (input.isProductionBuild && input.requested === "local") {
    throw new Error("Local providers are unavailable in production builds.");
  }
  if (input.requested === "simulated" && input.firmId !== "kossilon-demo") {
    throw new Error("Simulated providers are available only for kossilon-demo.");
  }
  return input.requested;
}

export function currentProviderMode(): ProviderMode {
  const configured = import.meta.env.VITE_PROVIDER_MODE;
  const requested: ProviderMode =
    configured === "local" || configured === "simulated" ? configured : "live";
  const firmId = typeof process === "undefined" ? undefined : process.env.FIRM_ID;
  return resolveProviderMode({
    requested,
    isProductionBuild: import.meta.env.PROD,
    firmId,
  });
}
```

- [ ] **Step 4: Write the failing simulated transport test**

```ts
import { vi } from "vitest";
import type { NotificationOutboxRecord } from "./types";

it("returns a deterministic demo provider ID without calling fetch", async () => {
  const fetchImpl = vi.fn();
  vi.stubGlobal("fetch", fetchImpl);
  const notification: NotificationOutboxRecord = {
    id: "11111111-1111-4111-8111-111111111111",
    companyId: "22222222-2222-4222-8222-222222222222",
    workItemId: null,
    channel: "email",
    notificationType: "demo",
    idempotencyKey: "demo:email:1",
    recipient: "demo@example.test",
    payload: { body: "Synthetic demo message" },
    status: "processing",
    attemptCount: 1,
    maxAttempts: 3,
    nextAttemptAt: "2026-07-16T09:00:00.000Z",
    providerMessageId: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    sentAt: null,
    retentionUntil: "2026-10-16T09:00:00.000Z",
  };

  await expect(createSimulatedNotificationTransport().dispatch(notification)).resolves.toEqual({
    providerMessageId: `simulated:email:${notification.id}`,
  });
  expect(fetchImpl).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});
```

- [ ] **Step 5: Implement the simulated transport and dispatcher selection**

```ts
import type { NotificationTransport } from "./types";

export function createSimulatedNotificationTransport(): NotificationTransport {
  return {
    async dispatch(notification) {
      return {
        providerMessageId: `simulated:${notification.channel}:${notification.id}`,
      };
    },
  };
}
```

Update `createNotificationTransport` in `dispatcher.ts`:

```ts
if (input.providerMode === "local") return createLocalNotificationTransport();
if (input.providerMode === "simulated") return createSimulatedNotificationTransport();
if (!input.config) {
  throw new Error("Live notification transport requires a WhatsApp provider configuration.");
}
```

- [ ] **Step 6: Extend dispatcher and runtime tests**

Add assertions that both WhatsApp and email records receive `simulated:<channel>:<id>`, `fetch` is never called, live configuration is not requested in simulated mode, and repository retry/failure behavior remains unchanged when an injected transport throws.

```ts
expect(createTransport).toHaveBeenCalledWith({ providerMode: "simulated", config: undefined });
expect(getLiveConfig).not.toHaveBeenCalled();
expect(fetchImpl).not.toHaveBeenCalled();
```

- [ ] **Step 7: Write failing tests for post-commit simulated Send now dispatch**

```ts
it("dispatches queued follow-ups immediately only in simulated mode", async () => {
  const dispatchDue = vi.fn().mockResolvedValue({
    claimed: 1,
    sent: 1,
    retried: 0,
    permanentlyFailed: 0,
  });
  const now = vi.fn(() => new Date("2026-07-16T09:00:00.000Z"));

  await expect(
    dispatchSimulatedFollowUpIfNeeded({
      currentProviderMode: () => "simulated",
      dispatchDue,
      now,
    }),
  ).resolves.toMatchObject({ sent: 1 });
  expect(dispatchDue).toHaveBeenCalledWith({
    now: "2026-07-16T09:00:00.000Z",
    limit: 50,
  });

  dispatchDue.mockClear();
  await expect(
    dispatchSimulatedFollowUpIfNeeded({
      currentProviderMode: () => "live",
      dispatchDue,
      now,
    }),
  ).resolves.toBeNull();
  expect(dispatchDue).not.toHaveBeenCalled();
});
```

- [ ] **Step 8: Export the server dispatcher and invoke it after commit**

Export the existing server-only function in `runtime-dispatch.ts`:

```ts
export const dispatchDueNotificationsOnServer = createServerOnlyFn(
  async (input: { now: string; limit?: number }) => {
    const [providerModeModule, outboxModule, runtimeEnvModule] = await Promise.all([
      import("@/server/provider-mode"),
      import("./outbox"),
      import("@/server/runtime-env"),
    ]);
    return dispatchDueNotificationsWithDependencies(input, {
      currentProviderMode: providerModeModule.currentProviderMode,
      createRepository: () => outboxModule.createNotificationOutboxRepository(),
      getLiveConfig: () => {
        const env = runtimeEnvModule.getFirmRuntimeEnv();
        return {
          provider: "woztell",
          apiBaseUrl: env.woztellApiBaseUrl,
          accessToken: env.woztellAccessToken,
          channelId: env.woztellChannelId,
          webhookSecret: env.woztellWebhookSecret,
        };
      },
    });
  },
);
```

Add the pure gate to `follow-up-server-fns.ts`:

```ts
import type { DispatchSummary } from "@/features/notifications/types";
import type { ProviderMode } from "@/server/provider-mode";

export type SimulatedFollowUpDispatchDependencies = {
  currentProviderMode(): ProviderMode;
  dispatchDue(input: { now: string; limit: number }): Promise<DispatchSummary>;
  now(): Date;
};

export async function dispatchSimulatedFollowUpIfNeeded(
  dependencies: SimulatedFollowUpDispatchDependencies,
): Promise<DispatchSummary | null> {
  if (dependencies.currentProviderMode() !== "simulated") return null;
  return dependencies.dispatchDue({
    now: dependencies.now().toISOString(),
    limit: 50,
  });
}
```

Restructure the `sendProductionFollowUp` handler so `sql.begin(...)` completes first, then dynamically import `currentProviderMode` and `dispatchDueNotificationsOnServer`, call `dispatchSimulatedFollowUpIfNeeded`, and finally return the enqueue result. Never dispatch from inside the enqueue transaction.

```ts
const result = await sql.begin(async (tx) => {
  const annualReturnRepository = createAnnualReturnRepository({ sql: tx });
  const followUpRepository = createProductionFollowUpRepository({ sql: tx });
  const whatsAppRepository = createWhatsAppRepository({ sql: tx });
  try {
    return await sendProductionFollowUpForActor(actor, data, {
      annualReturnRepository,
      followUpRepository,
      whatsAppRepository,
    });
  } finally {
    await Promise.all([
      annualReturnRepository.close(),
      followUpRepository.close(),
      whatsAppRepository.close(),
    ]);
  }
});
const [{ currentProviderMode }, { dispatchDueNotificationsOnServer }] = await Promise.all([
  import("@/server/provider-mode"),
  import("@/features/notifications/runtime-dispatch"),
]);
await dispatchSimulatedFollowUpIfNeeded({
  currentProviderMode,
  dispatchDue: dispatchDueNotificationsOnServer,
  now: () => new Date(),
});
return result;
```

- [ ] **Step 9: Run notification, provider, and follow-up tests**

Run: `npx vitest run src/server/provider-mode.test.ts src/features/notifications/simulated-transport.test.ts src/features/notifications/dispatcher.test.ts src/features/notifications/runtime-dispatch.test.ts src/features/annual-return/follow-up-server-fns.test.ts`

Expected: PASS; simulated Send now dispatches after commit with zero provider network calls, while live mode only enqueues.

- [ ] **Step 10: Commit simulated delivery**

```powershell
git add src/server/provider-mode.ts src/server/provider-mode.test.ts src/features/notifications/simulated-transport.ts src/features/notifications/simulated-transport.test.ts src/features/notifications/dispatcher.ts src/features/notifications/dispatcher.test.ts src/features/notifications/runtime-dispatch.ts src/features/notifications/runtime-dispatch.test.ts src/features/annual-return/follow-up-server-fns.ts src/features/annual-return/follow-up-server-fns.test.ts
git commit -m "feat: add demo-only simulated delivery"
```

---

### Task 3: Validate And Display Demo Delivery State

**Files:**
- Modify: `scripts/validate-neon-auth-demo.ts`
- Modify: `scripts/validate-neon-auth-demo.test.ts`
- Modify: `src/features/whatsapp/server-fns.ts`
- Modify: `src/features/whatsapp/server-fns.test.ts`
- Modify: `src/features/annual-return/components/production-whatsapp-automation.tsx`
- Modify: `src/features/annual-return/components/production-whatsapp-automation.interaction.test.tsx`
- Modify: `src/routes/settings.tsx`

**Interfaces:**
- Produces validator check `{ name: "VITE_PROVIDER_MODE", status: "pass" | "fail" | "missing" }` requiring `simulated`.
- Produces `WhatsAppDeliveryMode = "live" | "simulated" | "blocked"` in integration status.
- UI copy is exactly `Demo simulation` and `No external WhatsApp or email message is sent.`.

- [ ] **Step 1: Write failing validator tests for the required simulated mode**

```ts
it("requires simulated provider mode for the isolated demo", () => {
  const missing = validEnvironment();
  expect(validateNeonAuthDemoEnvironment(missing).checks).toContainEqual({
    name: "VITE_PROVIDER_MODE",
    status: "missing",
  });

  const live = { ...validEnvironment(), VITE_PROVIDER_MODE: "live" };
  expect(validateNeonAuthDemoEnvironment(live).checks).toContainEqual({
    name: "VITE_PROVIDER_MODE",
    status: "fail",
  });

  const simulated = { ...validEnvironment(), VITE_PROVIDER_MODE: "simulated" };
  expect(validateNeonAuthDemoEnvironment(simulated).checks).toContainEqual({
    name: "VITE_PROVIDER_MODE",
    status: "pass",
  });
});
```

- [ ] **Step 2: Implement the exact validator check**

```ts
function demoProviderModeCheck(environment: Environment): ValidationCheck {
  const value = trimmedValue(environment, "VITE_PROVIDER_MODE")?.toLowerCase();
  if (!value) return { name: "VITE_PROVIDER_MODE", status: "missing" };
  return { name: "VITE_PROVIDER_MODE", status: value === "simulated" ? "pass" : "fail" };
}
```

Replace the old unsafe-value-only provider check with `demoProviderModeCheck(environment)`. Keep `VITE_ENABLE_DEMO_AUTH=true` rejected.

- [ ] **Step 3: Write failing integration-status tests**

```ts
it("reports simulated delivery without requiring WOZTELL secrets", () => {
  expect(getWhatsAppIntegrationStatusForEnv({}, "simulated")).toEqual({
    provider: "simulated",
    deliveryMode: "simulated",
    webhookConfigured: false,
    liveSendConfigured: false,
    missingLiveEnvVars: [...WHATSAPP_LIVE_PROVIDER_ENV_KEYS],
  });
});
```

- [ ] **Step 4: Add delivery mode to the server contract**

```ts
export type WhatsAppDeliveryMode = "live" | "simulated" | "blocked";

export function getWhatsAppIntegrationStatusForEnv(
  env: Env = process.env,
  providerMode: ProviderMode = "live",
) {
  const missingLiveEnvVars = missingWhatsAppEnvVars(env, WHATSAPP_LIVE_PROVIDER_ENV_KEYS);
  const deliveryMode: WhatsAppDeliveryMode =
    providerMode === "simulated"
      ? "simulated"
      : missingLiveEnvVars.length === 0
        ? "live"
        : "blocked";
  return {
    provider: providerMode === "simulated" ? ("simulated" as const) : ("woztell" as const),
    deliveryMode,
    webhookConfigured: providerMode === "live" && !missingLiveEnvVars.includes("WOZTELL_WEBHOOK_SECRET"),
    liveSendConfigured: deliveryMode === "live",
    missingLiveEnvVars,
  };
}
```

Update the server function without importing server-only provider code into the client bundle:

```ts
export const getWhatsAppIntegrationStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { currentProviderMode } = await import("@/server/provider-mode");
  return getWhatsAppIntegrationStatusForEnv(process.env, currentProviderMode());
});
```

- [ ] **Step 5: Write failing UI tests for explicit demo copy**

Mock `getWhatsAppIntegrationStatus` to return `deliveryMode: "simulated"`, render `ProductionWhatsAppAutomation`, and assert:

```ts
expect(await screen.findByText("Demo simulation")).toBeTruthy();
expect(screen.getByText("No external WhatsApp or email message is sent.")).toBeTruthy();
expect(await screen.findAllByRole("button", { name: "Send now" })).toHaveLength(3);
```

- [ ] **Step 6: Render the simulation notice in automation and settings**

In `ProductionWhatsAppAutomation`, import `getWhatsAppIntegrationStatus`, query it beside `draftsQuery`, include `integrationQuery.error` in the displayed error, and render the notice only for `deliveryMode === "simulated"`:

```ts
const integrationQuery = useQuery({
  queryKey: ["whatsapp-integration-status"],
  queryFn: () => getWhatsAppIntegrationStatus(),
});
```

```tsx
<div className="border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-900" role="status">
  <p className="font-medium">Demo simulation</p>
  <p>No external WhatsApp or email message is sent.</p>
</div>
```

In `settings.tsx`, map delivery state to pills:

```tsx
<StatusPill tone={deliveryMode === "live" ? "green" : "yellow"}>
  {deliveryMode === "live"
    ? "Configured"
    : deliveryMode === "simulated"
      ? "Demo simulation"
      : "Blocked"}
</StatusPill>
```

Show missing live bindings only in `blocked` mode. In simulated mode, show `No external WhatsApp or email message is sent.` instead.

- [ ] **Step 7: Run validator, integration, and UI tests**

Run: `npx vitest run scripts/validate-neon-auth-demo.test.ts src/features/whatsapp/server-fns.test.ts src/features/annual-return/components/production-whatsapp-automation.interaction.test.tsx`

Expected: PASS with the simulated banner visible and durable send controls still enabled.

- [ ] **Step 8: Commit validation and visible status**

```powershell
git add scripts/validate-neon-auth-demo.ts scripts/validate-neon-auth-demo.test.ts src/features/whatsapp/server-fns.ts src/features/whatsapp/server-fns.test.ts src/features/annual-return/components/production-whatsapp-automation.tsx src/features/annual-return/components/production-whatsapp-automation.interaction.test.tsx src/routes/settings.tsx
git commit -m "feat: surface Neon demo delivery mode"
```

---

### Task 4: Activation And Reset Runbook

**Files:**
- Modify: `docs/runbooks/neon-auth-demo.md`
- Modify: `scripts/db-seed-neon-auth-demo.test.ts`
- Modify: `scripts/db-reset-neon-auth-demo.test.ts`

**Interfaces:**
- Documents one approved operator environment file used by validation, migration, seed, reset, and deployment configuration.
- Documents `VITE_PROVIDER_MODE=simulated` and the guarded reset command.
- Keeps production identity values operator-local and out of Vercel demo bindings.

- [ ] **Step 1: Write failing runbook contract tests**

```ts
expect(runbook).toContain("VITE_PROVIDER_MODE=simulated");
expect(runbook).toContain(
  'bun --env-file="$demoEnvFile" scripts/db-reset-neon-auth-demo.ts --confirm-firm kossilon-demo',
);
expect(runbook).toContain("Demo changes persist until an operator runs the guarded reset.");
expect(runbook).toContain("No external WhatsApp or email message is sent.");
expect(runbook).not.toContain("VITE_PROVIDER_MODE=local");
```

- [ ] **Step 2: Run the documentation contract tests**

Run: `npx vitest run scripts/db-seed-neon-auth-demo.test.ts scripts/db-reset-neon-auth-demo.test.ts`

Expected: FAIL because the runbook does not yet describe simulated delivery or reset.

- [ ] **Step 3: Update the environment and activation sequence**

Document the approved local environment names without values:

```text
DATABASE_URL
DEMO_DATABASE_URL
PRODUCTION_DATABASE_URL
NEON_AUTH_URL
PRODUCTION_NEON_AUTH_URL
NEON_AUTH_COOKIE_SECRET
FIRM_ID
DEMO_FIRM_ID
DEMO_AUTH_USER_ID
VITE_PROVIDER_MODE
```

State that `DATABASE_URL` and `DEMO_DATABASE_URL` identify the same demo database, `FIRM_ID` and `DEMO_FIRM_ID` are both `kossilon-demo`, and `VITE_PROVIDER_MODE` is `simulated`. Production identity values remain only in the operator-local file.

- [ ] **Step 4: Add the persistent-data and reset procedure**

Use PowerShell variables so paths are entered privately rather than committed:

```powershell
$demoEnvFile = Read-Host "Approved demo environment file path"
npm run validate:neon-auth-demo -- --env-file $demoEnvFile
bun --env-file="$demoEnvFile" scripts/db-reset-neon-auth-demo.ts --confirm-firm kossilon-demo
```

State that reset truncates public application tables, preserves `schema_migrations` and Neon Auth records, reapplies deterministic seed data, and reuses `DEMO_AUTH_USER_ID` for the Admin mapping.

- [ ] **Step 5: Add live acceptance and production non-mutation evidence**

The checklist must record only booleans, counts, deployment IDs, HTTP status codes, and route names. It must not record credentials, reset URLs, connection strings, Auth user IDs, cookies, or request authorization headers.

- [ ] **Step 6: Run documentation tests and secret-oriented searches**

Run: `npx vitest run scripts/db-seed-neon-auth-demo.test.ts scripts/db-reset-neon-auth-demo.test.ts scripts/validate-neon-auth-demo.test.ts`

Run: `rg -n -i "password\s*=|postgres(?:ql)?://|cookie_secret\s*=|authorization:\s*bearer" docs/runbooks/neon-auth-demo.md scripts/db-reset-neon-auth-demo.ts`

Expected: tests PASS; search returns no credential values.

- [ ] **Step 7: Commit the runbook**

```powershell
git add docs/runbooks/neon-auth-demo.md scripts/db-seed-neon-auth-demo.test.ts scripts/db-reset-neon-auth-demo.test.ts
git commit -m "docs: add Neon demo activation runbook"
```

---

### Task 5: Local Release Gates

**Files:**
- Verify only; do not stage `.sdd-artifacts/`, generated output, or local environment files.

**Interfaces:**
- Produces a redacted local readiness report for the exact activation commit.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
npx vitest run scripts/db-seed-annual-return.test.ts scripts/db-seed-neon-auth-demo.test.ts scripts/db-reset-neon-auth-demo.test.ts scripts/validate-neon-auth-demo.test.ts src/server/provider-mode.test.ts src/features/auth/neon-auth-server.test.ts src/features/notifications/simulated-transport.test.ts src/features/notifications/dispatcher.test.ts src/features/notifications/runtime-dispatch.test.ts src/features/whatsapp/server-fns.test.ts src/features/annual-return/components/production-whatsapp-automation.interaction.test.tsx
```

Expected: all focused tests PASS.

- [ ] **Step 2: Run repository checks**

```powershell
npx tsc --noEmit
npm run lint
npm run check:production-imports
npm run verify:firm -- --dry-run
```

Expected: typecheck, lint, import guard, and local verifier exit 0. The verifier continues to mark unprovisioned live providers as blocked.

- [ ] **Step 3: Build the production bundle**

Run: `npm run build`

Expected: exit 0 with `VITE_ENABLE_DEMO_AUTH` disabled. The build contains the guarded simulated mode but does not contain a public demo identity or password.

- [ ] **Step 4: Inspect the final change surface**

```powershell
git diff --check origin/main...HEAD
git status --short
git log --oneline origin/main..HEAD
rg -n -i "password\s*=|postgres(?:ql)?://|cookie_secret\s*=|authorization:\s*bearer" scripts src docs package.json
```

Expected: no whitespace errors; only intended commits appear; `.sdd-artifacts/` remains untracked; secret search finds variable names and test-only safe literals but no live values.

---

### Task 6: Approval-Gated Demo Provisioning And Deployment

**Files:**
- External provider state only. Do not write secrets or provider IDs into the repository.

**Interfaces:**
- Consumes the locally verified activation commit and approved operator environment file.
- Produces a separate Neon database/Auth instance, Vercel project, seeded Admin mapping, and ready deployment.

- [ ] **Step 1: Obtain explicit approval and create the dedicated Neon project/database**

Stop and obtain fresh approval. In Neon Console, create a project dedicated to `kossilon-demo`. Record only the project name and a redacted project identifier in operator notes. Confirm it is not the production project before continuing.

- [ ] **Step 2: Obtain explicit approval and enable the dedicated Neon Auth instance**

Stop and obtain fresh approval. Enable Neon Auth for the demo project/branch, enable email/password authentication, disable open signup, and configure the invite/reset email path. Confirm the Auth URL is not the production Auth URL.

- [ ] **Step 3: Obtain explicit approval and create the separate Vercel project**

Stop and obtain fresh approval. Create `kossilon-hub-demo`, connect it to the verified activation commit, and keep the production project unchanged.

- [ ] **Step 4: Obtain explicit approval and write demo Vercel environment values**

Write only these deployment bindings through Vercel's protected environment interface:

```text
DATABASE_URL
NEON_AUTH_URL
NEON_AUTH_COOKIE_SECRET
FIRM_ID=kossilon-demo
VITE_PROVIDER_MODE=simulated
```

Do not write `PRODUCTION_DATABASE_URL`, `PRODUCTION_NEON_AUTH_URL`, `DEMO_DATABASE_URL`, `DEMO_AUTH_USER_ID`, or `DEMO_FIRM_ID` to Vercel. Those remain operator-local.

- [ ] **Step 5: Validate the approved operator environment**

```powershell
$demoEnvFile = Read-Host "Approved demo environment file path"
npm run validate:neon-auth-demo -- --env-file $demoEnvFile
```

Expected: `Neon Auth demo runtime is ready.` and every named check is `pass`; no value is printed.

- [ ] **Step 6: Obtain explicit approval and run the remote migration**

Stop and obtain fresh approval, then run:

```powershell
bun --env-file="$demoEnvFile" scripts/db-migrate.ts
```

Expected: migrations apply or report already applied; no connection string is printed.

- [ ] **Step 7: Obtain explicit approval and invite the Admin account**

Stop and obtain fresh approval. Invite exactly `willylai@fimmick.com` through demo Neon Auth. The user sets the password privately from the Neon email. Obtain the resulting Auth user ID through the provider UI and store it only in the approved operator environment as `DEMO_AUTH_USER_ID`.

- [ ] **Step 8: Revalidate and obtain explicit approval for the remote seed**

```powershell
npm run validate:neon-auth-demo -- --env-file $demoEnvFile
```

After a passing result and fresh approval, run:

```powershell
bun --env-file="$demoEnvFile" scripts/db-seed-neon-auth-demo.ts
```

Expected: one redacted success line naming `DEMO_FIRM_ID=kossilon-demo`; no Auth ID or database value is printed.

- [ ] **Step 9: Obtain explicit approval and deploy the demo**

Stop and obtain fresh approval. Deploy the verified activation commit to the separate Vercel project. Record the deployment ID, commit SHA, ready state, and demo hostname only.

---

### Task 7: Live Acceptance And Reset Rehearsal

**Files:**
- External verification evidence only; store no secrets, cookies, Auth IDs, or personal password values.

**Interfaces:**
- Produces final redacted evidence that Auth, persistence, simulated delivery, reset, and production isolation work end to end.

- [ ] **Step 1: Obtain explicit approval for external login and browser verification**

Stop and obtain fresh approval. Set the demo URL privately:

```powershell
$demoUrl = Read-Host "Approved demo deployment URL"
```

- [ ] **Step 2: Verify anonymous access boundaries**

Open `$demoUrl/login` and confirm HTTP 200. Open `$demoUrl/work-queue` without a session and confirm redirect to `/login`. Confirm the login page contains no public account identity or password.

- [ ] **Step 3: Verify the private Neon Auth lifecycle**

Sign in with `willylai@fimmick.com` and the password entered privately by the user. Confirm the account resolves as Admin, protected routes load, and logout invalidates the session. Do not record the password, cookie, reset URL, or authorization headers.

- [ ] **Step 4: Verify persistence and simulated delivery**

Perform one reversible Admin workflow mutation, reload, and confirm it persists. Open WhatsApp Automation, confirm `Demo simulation` and `No external WhatsApp or email message is sent.`, invoke one `Send now` action, and confirm the post-commit demo dispatcher stores a provider ID beginning with `simulated:`. Confirm provider logs show no WOZTELL or email request.

- [ ] **Step 5: Capture production non-mutation evidence**

Record the production deployment ID and a read-only count or checksum for the production Admin profile and representative annual-return rows before and after demo verification. Values must match. Do not run migration, seed, reset, or write queries against production.

- [ ] **Step 6: Obtain explicit approval and rehearse the operator reset**

Stop and obtain fresh approval. Run:

```powershell
bun --env-file="$demoEnvFile" scripts/db-reset-neon-auth-demo.ts --confirm-firm kossilon-demo
```

Expected: one redacted reset-success line. Sign in again, confirm deterministic seed state is restored, confirm the prior test mutation is gone, and confirm the same Neon Auth account still resolves as Admin.

- [ ] **Step 7: Run desktop and mobile presentation checks**

Verify `/login`, `/work-queue`, `/annual-returns`, one case detail, `/whatsapp/automation`, and `/settings` at desktop and mobile widths. Expected: no console errors, failed application requests, horizontal overflow, overlapping controls, or clipped labels.

- [ ] **Step 8: Record completion**

The completion report contains only commit SHA, deployment ID, route/status results, role result, seeded entity counts, simulated provider prefix, reset result, production non-mutation result, and any blocked live integrations. It contains no secret or credential values.
