# Dev-Server Import-Boundary Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the 6 `*server-fns.ts` files that statically import server-only code into the
established `createServerOnlyFn` + dynamic-`import()` lazy pattern, and add a regression-gate
script so `npm run dev` can render every route again without tripping TanStack Start's
import-protection plugin.

**Architecture:** Each defective file gets one `createServerOnlyFn`-wrapped loader that resolves
its server-only values (`getRequest`, actor-resolution helpers, repository factories) via a single
`Promise.all([import(...), ...])`, mirroring the already-shipped `documents/server-fns.ts` and
`checklist-templates/server-fns.ts`. Every exported `*ForActor` function keeps its exact signature
and behavior — only the thin `createServerFn` wrapper's plumbing changes to route through the
loader instead of module-top-level statics. A new offline script boots the real dev server as a
child process, requests every route, and fails if `[import-protection]` appears in its output.

**Tech Stack:** TanStack Start 1.x (`createServerOnlyFn`, dynamic `import()`), Vite 8, TypeScript
5.8 strict, Vitest 4, Node's `node:child_process`/`node:net` for the gate script.

---

## Context for every task below

- Design spec: `docs/superpowers/specs/2026-08-19-dev-server-import-boundaries-design.md` — read
  this first if anything below is unclear about *why*.
- **No business logic changes anywhere in Tasks 1–6.** Every `*ForActor` function (the actual,
  already-unit-tested logic) keeps its exact signature, parameters, and behavior. Only changes:
  where a `server-fns.ts` file gets its `getRequest` / actor-resolution / repository-factory
  values from (module-top-level `import` → a `createServerOnlyFn`-wrapped loader using dynamic
  `import()`).
- Existing tests for these 6 files (`server-fns.test.ts`, `server-fns.authorization.test.ts`,
  `client-portal-server-fns.test.ts`, `evidence-server-fns.test.ts`, `follow-up-server-fns.test.ts`)
  only import and call the pure `*ForActor` functions directly — never the `createServerFn`-wrapped
  exports, never the `with...`/`load...` wrapper functions. This was confirmed by reading every one
  of those test files before writing this plan. That means none of them need to change; each
  task's verification step is simply "run the file's test suite and confirm it still passes
  unchanged."
- `clients/server-fns.ts` has no dedicated test file today (confirmed: no
  `clients/server-fns.test.ts` exists). Its task is verified by `tsc` + the full suite + the final
  manual smoke test instead.
- Every edit below is given as an exact "Replace this / with this" pair. Apply with the Edit tool
  (`old_string`/`new_string`) — the `old_string` blocks are copied verbatim from the current file
  so they should match exactly.

---

### Task 1: `annual-return/server-fns.ts` (the file actually breaking `/documents`, `/payments`, `/portal` today) — ✅ DONE (commit `42a76dd`)

**Files:**
- Modify: `src/features/annual-return/server-fns.ts`
- Test (run unchanged): `src/features/annual-return/server-fns.test.ts`,
  `src/features/annual-return/server-fns.authorization.test.ts`

This file statically imports `getRequest`, `getSqlClient`, `createAnnualReturnRepository`,
`createWhatsAppRepository`, and `getCurrentAnnualReturnActor`/`getCurrentAnnualReturnActorId` (from
`./session`, which itself statically imports `requireStaffActor` from
`@/features/auth/neon-auth-server`, which statically imports `getSqlClient` from
`@/server/db/client`) — the actual root-cause chain. It also statically imports
`hongKongBusinessDate` from `./repository`, which merely re-exports a function actually *defined*
in `./workflow.ts` (confirmed: `./workflow.ts` has zero imports of its own — it's a fully pure,
standalone module). Since `./repository.ts`'s own top-level imports reach `@/server/db/client`,
importing anything from it — even a re-exported pure function — pulls the whole module into Vite
dev's conservative reachability graph. Importing `hongKongBusinessDate` from `./workflow` directly
instead sidesteps this with a one-line source change, no relocation needed.

- [ ] **Step 1: Replace the top-of-file imports**

Replace:

```typescript
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { assertStaffAccess } from "@/features/auth/authorization";
import type { AuthenticatedActor } from "@/features/auth/types";
import { getSqlClient } from "@/server/db/client";
import {
  createAnnualReturnRepository,
  hongKongBusinessDate,
  type AnnualReturnRepository,
  type CaseFilters,
} from "./repository";
import {
  assertAnnualReturnCaseVisible,
  caseFiltersForActor,
  isAnnualReturnCaseVisibleToActor,
} from "./permissions";
import { createWhatsAppRepository, type WhatsAppRepository } from "@/features/whatsapp/repository";
import { getCurrentAnnualReturnActor, getCurrentAnnualReturnActorId } from "./session";
import { buildReminderDraft, completionBlockers, isAllowedStatusTransition } from "./workflow";
import { ANNUAL_RETURN_STATUSES, type AnnualReturnCase, type AnnualReturnStatus } from "./types";
import { queueAnnualReturnWhatsAppReminder } from "./whatsapp-reminders";
```

With:

```typescript
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertStaffAccess } from "@/features/auth/authorization";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { AnnualReturnRepository, CaseFilters } from "./repository";
import {
  assertAnnualReturnCaseVisible,
  caseFiltersForActor,
  isAnnualReturnCaseVisibleToActor,
} from "./permissions";
import type { WhatsAppRepository } from "@/features/whatsapp/repository";
import {
  buildReminderDraft,
  completionBlockers,
  hongKongBusinessDate,
  isAllowedStatusTransition,
} from "./workflow";
import { ANNUAL_RETURN_STATUSES, type AnnualReturnCase, type AnnualReturnStatus } from "./types";
import { queueAnnualReturnWhatsAppReminder } from "./whatsapp-reminders";
```

Every other import in the file (`./permissions`, `./workflow`, `./types`, `./whatsapp-reminders`,
`@/features/auth/authorization`) is confirmed pure (no path reaches `@/server/db/client`) and stays
static. `AnnualReturnRepository`/`CaseFilters`/`WhatsAppRepository` are now `import type` only —
fully compiler-erased, so they never appear in the client bundle's module graph regardless of
where they're declared.

- [ ] **Step 2: Replace the two shared repository wrappers and `listAnnualReturnCases`**

Replace:

```typescript
async function withAnnualReturnRepository<T>(
  handler: (repository: AnnualReturnRepository, actorId: string) => Promise<T>,
): Promise<T> {
  const actorId = await getCurrentAnnualReturnActorId(getRequest());
  const repository = createAnnualReturnRepository();

  try {
    return await handler(repository, actorId);
  } finally {
    await repository.close();
  }
}

async function withAnnualReturnActorRepository<T>(
  handler: (repository: AnnualReturnRepository, actor: AuthenticatedActor) => Promise<T>,
): Promise<T> {
  const actor = await getCurrentAnnualReturnActor(getRequest());
  const repository = createAnnualReturnRepository();

  try {
    return await handler(repository, actor);
  } finally {
    await repository.close();
  }
}
export const listAnnualReturnCases = createServerFn({ method: "GET" })
  .validator(listAnnualReturnCasesSchema)
  .handler(async ({ data }) => {
    const actor = await getCurrentAnnualReturnActor(getRequest());
    const repository = createAnnualReturnRepository();

    try {
      return await listAnnualReturnCasesForActor(actor, data, { repository });
    } finally {
      await repository.close();
    }
  });
```

With:

```typescript
const loadAnnualReturnServerDependencies = createServerOnlyFn(async () => {
  const [
    { getRequest },
    { getCurrentAnnualReturnActor, getCurrentAnnualReturnActorId },
    { getSqlClient },
    { createAnnualReturnRepository },
    { createWhatsAppRepository },
  ] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("./session"),
    import("@/server/db/client"),
    import("./repository"),
    import("@/features/whatsapp/repository"),
  ]);
  return {
    getRequest,
    getCurrentAnnualReturnActor,
    getCurrentAnnualReturnActorId,
    getSqlClient,
    createAnnualReturnRepository,
    createWhatsAppRepository,
  };
});

async function withAnnualReturnRepository<T>(
  handler: (repository: AnnualReturnRepository, actorId: string) => Promise<T>,
): Promise<T> {
  const { getRequest, getCurrentAnnualReturnActorId, createAnnualReturnRepository } =
    await loadAnnualReturnServerDependencies();
  const actorId = await getCurrentAnnualReturnActorId(getRequest());
  const repository = createAnnualReturnRepository();

  try {
    return await handler(repository, actorId);
  } finally {
    await repository.close();
  }
}

async function withAnnualReturnActorRepository<T>(
  handler: (repository: AnnualReturnRepository, actor: AuthenticatedActor) => Promise<T>,
): Promise<T> {
  const { getRequest, getCurrentAnnualReturnActor, createAnnualReturnRepository } =
    await loadAnnualReturnServerDependencies();
  const actor = await getCurrentAnnualReturnActor(getRequest());
  const repository = createAnnualReturnRepository();

  try {
    return await handler(repository, actor);
  } finally {
    await repository.close();
  }
}
export const listAnnualReturnCases = createServerFn({ method: "GET" })
  .validator(listAnnualReturnCasesSchema)
  .handler(({ data }) =>
    withAnnualReturnActorRepository((repository, actor) =>
      listAnnualReturnCasesForActor(actor, data, { repository }),
    ),
  );
```

(`listAnnualReturnCases`'s handler previously duplicated `withAnnualReturnActorRepository`'s body
inline. Routing it through the shared wrapper instead of hand-writing the lazy-load boilerplate a
third time is the only shape change in this step — the resulting behavior is identical: resolve
actor, resolve repository, call `listAnnualReturnCasesForActor`, close repository.)

- [ ] **Step 3: Replace `queueAnnualReturnWhatsAppReminderMessage`'s handler**

Replace:

```typescript
export const queueAnnualReturnWhatsAppReminderMessage = createServerFn({ method: "POST" })
  .validator(queueAnnualReturnWhatsAppReminderSchema)
  .handler(async ({ data }) => {
    const actor = await getCurrentAnnualReturnActor(getRequest());
    const sql = getSqlClient();

    return sql.begin(async (tx) => {
      const annualReturnRepository = createAnnualReturnRepository({ sql: tx });
      const whatsAppRepository = createWhatsAppRepository({ sql: tx });

      try {
        return await queueAnnualReturnWhatsAppReminderMessageForActor(actor, data, {
          annualReturnRepository,
          whatsAppRepository,
        });
      } finally {
        await annualReturnRepository.close();
        await whatsAppRepository.close();
      }
    });
  });
```

With:

```typescript
export const queueAnnualReturnWhatsAppReminderMessage = createServerFn({ method: "POST" })
  .validator(queueAnnualReturnWhatsAppReminderSchema)
  .handler(async ({ data }) => {
    const {
      getRequest,
      getCurrentAnnualReturnActor,
      getSqlClient,
      createAnnualReturnRepository,
      createWhatsAppRepository,
    } = await loadAnnualReturnServerDependencies();
    const actor = await getCurrentAnnualReturnActor(getRequest());
    const sql = getSqlClient();

    return sql.begin(async (tx) => {
      const annualReturnRepository = createAnnualReturnRepository({ sql: tx });
      const whatsAppRepository = createWhatsAppRepository({ sql: tx });

      try {
        return await queueAnnualReturnWhatsAppReminderMessageForActor(actor, data, {
          annualReturnRepository,
          whatsAppRepository,
        });
      } finally {
        await annualReturnRepository.close();
        await whatsAppRepository.close();
      }
    });
  });
```

Every other exported `createServerFn` in this file (`getAnnualReturnCase`,
`getAnnualReturnDashboardMetrics`, `assignAnnualReturnCaseOwner`, `listAnnualReturnCaseNotes`,
`addAnnualReturnCaseNote`, `updateAnnualReturnStatus`, `recordAnnualReturnReminder`,
`updateAnnualReturnChecklistItem`, `updateAnnualReturnPayment`, `updateAnnualReturnFilingProof`,
`buildAnnualReturnReminderDraft`) already calls `withAnnualReturnRepository` or
`withAnnualReturnActorRepository` and needs **no changes** — it gets the fix automatically through
the wrapper.

- [ ] **Step 4: Typecheck and run this file's tests**

Run: `npm run typecheck`
Expected: no errors.

Run: `npx vitest run src/features/annual-return/server-fns.test.ts src/features/annual-return/server-fns.authorization.test.ts`
Expected: all tests pass unchanged (these only exercise the pure `*ForActor` functions, which were
not touched).

- [ ] **Step 5: Commit**

```bash
git add src/features/annual-return/server-fns.ts
git commit -m "fix: lazy-load server-only deps in annual-return/server-fns.ts"
```

---

### Task 2: `annual-return/client-portal-server-fns.ts` — ✅ DONE (commit `749ba12`)

**Files:**
- Modify: `src/features/annual-return/client-portal-server-fns.ts`
- Test (run unchanged): `src/features/annual-return/client-portal-server-fns.test.ts`

This file already dynamically imports `listActiveClientCompanyIds` inline (the "equally valid"
inline-dynamic-import variant), but still statically imports `getRequest` and
`createAnnualReturnRepository` at module top. Converting the whole loader to
`createServerOnlyFn` brings it in line with the other 5 files in this plan.

- [ ] **Step 1: Replace the top-of-file imports**

Replace:

```typescript
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { createAnnualReturnRepository, type AnnualReturnRepository } from "./repository";
import type { AnnualReturnCase, AnnualReturnStatus, PaymentStatus } from "./types";
```

With:

```typescript
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";

import type { AnnualReturnRepository } from "./repository";
import type { AnnualReturnCase, AnnualReturnStatus, PaymentStatus } from "./types";
```

- [ ] **Step 2: Replace `withClientPortalDependencies`**

Replace:

```typescript
async function withClientPortalDependencies<T>(
  handler: (dependencies: ClientPortalDependencies) => Promise<T>,
): Promise<T> {
  const [{ listActiveClientCompanyIds }] = await Promise.all([
    import("@/features/auth/neon-auth-server"),
  ]);
  const request = getRequest();
  const repository = createAnnualReturnRepository();

  try {
    return await handler({
      repository,
      listCompanyIds: () => listActiveClientCompanyIds(request),
    });
  } finally {
    await repository.close();
  }
}
```

With:

```typescript
const loadClientPortalDependencies = createServerOnlyFn(async () => {
  const [{ getRequest }, { listActiveClientCompanyIds }, { createAnnualReturnRepository }] =
    await Promise.all([
      import("@tanstack/react-start/server"),
      import("@/features/auth/neon-auth-server"),
      import("./repository"),
    ]);
  const request = getRequest();
  return {
    repository: createAnnualReturnRepository(),
    listCompanyIds: () => listActiveClientCompanyIds(request),
  };
});

async function withClientPortalDependencies<T>(
  handler: (dependencies: ClientPortalDependencies) => Promise<T>,
): Promise<T> {
  const dependencies = await loadClientPortalDependencies();

  try {
    return await handler(dependencies);
  } finally {
    await dependencies.repository.close();
  }
}
```

`listClientPortalCases` and `getClientPortalCase` already call `withClientPortalDependencies` and
need no changes.

- [ ] **Step 3: Typecheck and run this file's tests**

Run: `npm run typecheck`
Expected: no errors.

Run: `npx vitest run src/features/annual-return/client-portal-server-fns.test.ts`
Expected: all tests pass unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/features/annual-return/client-portal-server-fns.ts
git commit -m "fix: lazy-load server-only deps in annual-return/client-portal-server-fns.ts"
```

---

### Task 3: `annual-return/evidence-server-fns.ts` — ✅ DONE (commit `e6b212f`)

**Files:**
- Modify: `src/features/annual-return/evidence-server-fns.ts`
- Test (run unchanged): `src/features/annual-return/evidence-server-fns.test.ts`

This file statically imports `getRequest`, `getCurrentAnnualReturnActor` (from `./session`, which
reaches `@/server/db/client` transitively — see Task 1's note), and
`createAnnualReturnEvidenceService` (from `./evidence-service`, which statically imports
`getSqlClient` and `createAnnualReturnRepository` directly).

- [ ] **Step 1: Replace the top-of-file imports**

Replace:

```typescript
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { assertStaffAccess } from "@/features/auth/authorization";
import type { AuthenticatedActor } from "@/features/auth/types";
import { getCurrentAnnualReturnActor } from "./session";
import {
  createAnnualReturnEvidenceService,
  type AnnualReturnEvidenceService,
} from "./evidence-service";
```

With:

```typescript
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertStaffAccess } from "@/features/auth/authorization";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { AnnualReturnEvidenceService } from "./evidence-service";
```

- [ ] **Step 2: Replace the two `createServerFn` handlers**

Replace:

```typescript
export const reviewAnnualReturnEvidenceAction = createServerFn({ method: "POST" })
  .validator(reviewEvidenceSchema)
  .handler(async ({ data }) => {
    const actor = await getCurrentAnnualReturnActor(getRequest());
    return reviewAnnualReturnEvidenceForActor(actor, data, {
      service: createAnnualReturnEvidenceService(),
    });
  });

export const acceptAnnualReturnFilingReceiptAction = createServerFn({ method: "POST" })
  .validator(acceptFilingReceiptSchema)
  .handler(async ({ data }) => {
    const actor = await getCurrentAnnualReturnActor(getRequest());
    return acceptAnnualReturnFilingReceiptForActor(actor, data, {
      service: createAnnualReturnEvidenceService(),
    });
  });
```

With:

```typescript
const loadDefaultAnnualReturnEvidenceContext = createServerOnlyFn(async () => {
  const [{ getRequest }, { getCurrentAnnualReturnActor }, { createAnnualReturnEvidenceService }] =
    await Promise.all([
      import("@tanstack/react-start/server"),
      import("./session"),
      import("./evidence-service"),
    ]);
  const actor = await getCurrentAnnualReturnActor(getRequest());
  return {
    actor,
    dependencies: {
      service: createAnnualReturnEvidenceService(),
    } satisfies AnnualReturnEvidenceCommandDependencies,
  };
});

export const reviewAnnualReturnEvidenceAction = createServerFn({ method: "POST" })
  .validator(reviewEvidenceSchema)
  .handler(async ({ data }) => {
    const { actor, dependencies } = await loadDefaultAnnualReturnEvidenceContext();
    return reviewAnnualReturnEvidenceForActor(actor, data, dependencies);
  });

export const acceptAnnualReturnFilingReceiptAction = createServerFn({ method: "POST" })
  .validator(acceptFilingReceiptSchema)
  .handler(async ({ data }) => {
    const { actor, dependencies } = await loadDefaultAnnualReturnEvidenceContext();
    return acceptAnnualReturnFilingReceiptForActor(actor, data, dependencies);
  });
```

`AnnualReturnEvidenceService` has no `close()` method (its internal per-call transactions close
their own repositories inside `evidence-service.ts`), so — matching the original code — there is
nothing to close here.

- [ ] **Step 3: Typecheck and run this file's tests**

Run: `npm run typecheck`
Expected: no errors.

Run: `npx vitest run src/features/annual-return/evidence-server-fns.test.ts`
Expected: all tests pass unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/features/annual-return/evidence-server-fns.ts
git commit -m "fix: lazy-load server-only deps in annual-return/evidence-server-fns.ts"
```

---

### Task 4: `annual-return/follow-up-server-fns.ts` — ✅ DONE (commit `355674b`)

**Files:**
- Modify: `src/features/annual-return/follow-up-server-fns.ts`
- Test (run unchanged): `src/features/annual-return/follow-up-server-fns.test.ts`

This file already dynamically imports `currentProviderMode` and `dispatchDueNotificationsOnServer`
inline inside `sendProductionFollowUp` (leave that as-is). It statically imports `getRequest`,
`getSqlClient`, `createWhatsAppRepository`, `createAnnualReturnRepository`,
`createProductionFollowUpRepository`, and `getCurrentAnnualReturnActor` (from `./session`).
`hongKongBusinessDate` is already imported from `./workflow` here — no change needed for that one.

- [ ] **Step 1: Replace the top-of-file imports**

Replace:

```typescript
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { assertStaffAccess } from "@/features/auth/authorization";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { DispatchSummary } from "@/features/notifications/types";
import type { ProviderMode } from "@/server/provider-mode";
import { getSqlClient } from "@/server/db/client";
import { createWhatsAppRepository, type WhatsAppRepository } from "@/features/whatsapp/repository";
import { getAnnualReturnActionPermission } from "./permissions";
import { createAnnualReturnRepository, type AnnualReturnRepository } from "./repository";
import { getCurrentAnnualReturnActor } from "./session";
import { hongKongBusinessDate } from "./workflow";
import {
  deriveProductionFollowUpDrafts,
  PRODUCTION_FOLLOW_UP_SOURCES,
  stableFollowUpIdempotencyKey,
  type ProductionFollowUpDraft,
  type ProductionFollowUpIdentity,
  type ProductionFollowUpSource,
} from "./follow-ups";
import {
  createProductionFollowUpRepository,
  type ProductionFollowUpRepository,
} from "./follow-up-repository";
```

With:

```typescript
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertStaffAccess } from "@/features/auth/authorization";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { DispatchSummary } from "@/features/notifications/types";
import type { ProviderMode } from "@/server/provider-mode";
import type { WhatsAppRepository } from "@/features/whatsapp/repository";
import { getAnnualReturnActionPermission } from "./permissions";
import type { AnnualReturnRepository } from "./repository";
import { hongKongBusinessDate } from "./workflow";
import {
  deriveProductionFollowUpDrafts,
  PRODUCTION_FOLLOW_UP_SOURCES,
  stableFollowUpIdempotencyKey,
  type ProductionFollowUpDraft,
  type ProductionFollowUpIdentity,
  type ProductionFollowUpSource,
} from "./follow-ups";
import type { ProductionFollowUpRepository } from "./follow-up-repository";
```

- [ ] **Step 2: Replace the two `createServerFn` handlers**

Replace:

```typescript
export const listProductionFollowUpDrafts = createServerFn({ method: "GET" }).handler(async () => {
  const actor = await getCurrentAnnualReturnActor(getRequest());
  const annualReturnRepository = createAnnualReturnRepository();
  const followUpRepository = createProductionFollowUpRepository();
  const whatsAppRepository = createWhatsAppRepository();
  try {
    return await listProductionFollowUpDraftsForActor(actor, {
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

export const sendProductionFollowUp = createServerFn({ method: "POST" })
  .validator(productionFollowUpSchema)
  .handler(async ({ data }) => {
    const actor = await getCurrentAnnualReturnActor(getRequest());
    const sql = getSqlClient();
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
  });
```

With:

```typescript
const loadProductionFollowUpDependencies = createServerOnlyFn(async () => {
  const [
    { getRequest },
    { getCurrentAnnualReturnActor },
    { getSqlClient },
    { createAnnualReturnRepository },
    { createProductionFollowUpRepository },
    { createWhatsAppRepository },
  ] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("./session"),
    import("@/server/db/client"),
    import("./repository"),
    import("./follow-up-repository"),
    import("@/features/whatsapp/repository"),
  ]);
  return {
    getRequest,
    getCurrentAnnualReturnActor,
    getSqlClient,
    createAnnualReturnRepository,
    createProductionFollowUpRepository,
    createWhatsAppRepository,
  };
});

export const listProductionFollowUpDrafts = createServerFn({ method: "GET" }).handler(async () => {
  const {
    getRequest,
    getCurrentAnnualReturnActor,
    createAnnualReturnRepository,
    createProductionFollowUpRepository,
    createWhatsAppRepository,
  } = await loadProductionFollowUpDependencies();
  const actor = await getCurrentAnnualReturnActor(getRequest());
  const annualReturnRepository = createAnnualReturnRepository();
  const followUpRepository = createProductionFollowUpRepository();
  const whatsAppRepository = createWhatsAppRepository();
  try {
    return await listProductionFollowUpDraftsForActor(actor, {
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

export const sendProductionFollowUp = createServerFn({ method: "POST" })
  .validator(productionFollowUpSchema)
  .handler(async ({ data }) => {
    const {
      getRequest,
      getCurrentAnnualReturnActor,
      getSqlClient,
      createAnnualReturnRepository,
      createProductionFollowUpRepository,
      createWhatsAppRepository,
    } = await loadProductionFollowUpDependencies();
    const actor = await getCurrentAnnualReturnActor(getRequest());
    const sql = getSqlClient();
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
  });
```

- [ ] **Step 3: Typecheck and run this file's tests**

Run: `npm run typecheck`
Expected: no errors.

Run: `npx vitest run src/features/annual-return/follow-up-server-fns.test.ts`
Expected: all tests pass unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/features/annual-return/follow-up-server-fns.ts
git commit -m "fix: lazy-load server-only deps in annual-return/follow-up-server-fns.ts"
```

---

### Task 5: `whatsapp/server-fns.ts` — ✅ DONE (commit `b6eabad`)

**Files:**
- Modify: `src/features/whatsapp/server-fns.ts`
- Test (run unchanged): `src/features/whatsapp/server-fns.test.ts`

This file statically imports `getRequest`, `requireActor`/`requireStaffActor` (from
`@/features/auth/neon-auth-server`), and `createWhatsAppRepository` (from `./repository`). It
already dynamically imports `currentProviderMode` inline inside `getWhatsAppIntegrationStatus` —
that handler gets the same treatment applied to its remaining static imports, in the same inline
style, rather than routing through the shared inbox loader (it doesn't need a repository).

- [ ] **Step 1: Replace the top-of-file imports**

Replace:

```typescript
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { assertStaffAccess } from "@/features/auth/authorization";
import { requireActor, requireStaffActor } from "@/features/auth/neon-auth-server";
import type { AuthenticatedActor } from "@/features/auth/types";
import {
  assertAnnualReturnActionAllowed,
  type AnnualReturnActorRole,
} from "@/features/annual-return/permissions";
import type { ProviderMode } from "@/server/provider-mode";
import { missingWhatsAppEnvVars, WHATSAPP_LIVE_PROVIDER_ENV_KEYS } from "./config";
import type { WhatsAppConversation, WhatsAppConversationMessage } from "./conversations";
import {
  createWhatsAppRepository,
  type InboundWhatsAppMessageRecord,
  type WhatsAppRepository,
  type WhatsAppTemplateCategory,
  type WhatsAppWebhookEventRecord,
  type WhatsAppWebhookProcessingStatus,
} from "./repository";
import { classifyWoztellWebhookEvent } from "./woztell";
```

With:

```typescript
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import { assertStaffAccess } from "@/features/auth/authorization";
import type { AuthenticatedActor } from "@/features/auth/types";
import {
  assertAnnualReturnActionAllowed,
  type AnnualReturnActorRole,
} from "@/features/annual-return/permissions";
import type { ProviderMode } from "@/server/provider-mode";
import { missingWhatsAppEnvVars, WHATSAPP_LIVE_PROVIDER_ENV_KEYS } from "./config";
import type { WhatsAppConversation, WhatsAppConversationMessage } from "./conversations";
import type {
  InboundWhatsAppMessageRecord,
  WhatsAppRepository,
  WhatsAppTemplateCategory,
  WhatsAppWebhookEventRecord,
  WhatsAppWebhookProcessingStatus,
} from "./repository";
import { classifyWoztellWebhookEvent } from "./woztell";
```

- [ ] **Step 2: Replace `withWhatsAppInboxRepository` and `getWhatsAppIntegrationStatus`**

Replace:

```typescript
async function withWhatsAppInboxRepository<T>(
  handler: (repository: WhatsAppRepository, actor: AuthenticatedActor) => Promise<T>,
): Promise<T> {
  const actor = assertStaffAccess(await requireActor(getRequest()));
  const repository = createWhatsAppRepository();

  try {
    return await handler(repository, actor);
  } finally {
    await repository.close();
  }
}
```

With:

```typescript
const loadDefaultWhatsAppInboxContext = createServerOnlyFn(async () => {
  const [{ getRequest }, { requireActor }, { createWhatsAppRepository }] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("@/features/auth/neon-auth-server"),
    import("./repository"),
  ]);
  const actor = assertStaffAccess(await requireActor(getRequest()));
  return { actor, repository: createWhatsAppRepository() };
});

async function withWhatsAppInboxRepository<T>(
  handler: (repository: WhatsAppRepository, actor: AuthenticatedActor) => Promise<T>,
): Promise<T> {
  const { actor, repository } = await loadDefaultWhatsAppInboxContext();

  try {
    return await handler(repository, actor);
  } finally {
    await repository.close();
  }
}
```

Then replace:

```typescript
export const getWhatsAppIntegrationStatus = createServerFn({ method: "GET" })
  .validator(noInputSchema)
  .handler(async () => {
    await requireStaffActor(getRequest());
    const { currentProviderMode } = await import("@/server/provider-mode");
    return getWhatsAppIntegrationStatusForEnv(process.env, currentProviderMode());
  });
```

With:

```typescript
export const getWhatsAppIntegrationStatus = createServerFn({ method: "GET" })
  .validator(noInputSchema)
  .handler(async () => {
    const [{ getRequest }, { requireStaffActor }, { currentProviderMode }] = await Promise.all([
      import("@tanstack/react-start/server"),
      import("@/features/auth/neon-auth-server"),
      import("@/server/provider-mode"),
    ]);
    await requireStaffActor(getRequest());
    return getWhatsAppIntegrationStatusForEnv(process.env, currentProviderMode());
  });
```

`listWhatsAppConversations`, `listWhatsAppConversationMessages`, and `queueWhatsAppTemplateMessage`
already call `withWhatsAppInboxRepository` and need no changes.

- [ ] **Step 3: Typecheck and run this file's tests**

Run: `npm run typecheck`
Expected: no errors.

Run: `npx vitest run src/features/whatsapp/server-fns.test.ts`
Expected: all tests pass unchanged.

- [ ] **Step 4: Commit**

```bash
git add src/features/whatsapp/server-fns.ts
git commit -m "fix: lazy-load server-only deps in whatsapp/server-fns.ts"
```

---

### Task 6: `clients/server-fns.ts` — ✅ DONE (commits `e7857db`, `624f279`)

**Files:**
- Modify: `src/features/clients/server-fns.ts`
- No dedicated test file exists for this one today — verified by `tsc`, the full suite (Task 9),
  and the manual smoke test (Task 9).

This file has no `*ForActor` split (business logic sits directly in each handler) — that's a
pre-existing shape, not something this task changes. It statically imports `getRequest`,
`requireStaffActor` (+ the `AuthDependencies` type), and `createClientRepository`.

- [ ] **Step 1: Replace the top-of-file imports**

Replace:

```typescript
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireStaffActor, type AuthDependencies } from "@/features/auth/neon-auth-server";
import type { AuthenticatedActor } from "@/features/auth/types";
import { assertClientCompanyCreatable, assertClientCompanyWritable } from "./authorization";
import { createClientRepository } from "./repository";
```

With:

```typescript
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { z } from "zod";
import type { AuthDependencies } from "@/features/auth/neon-auth-server";
import type { AuthenticatedActor } from "@/features/auth/types";
import { assertClientCompanyCreatable, assertClientCompanyWritable } from "./authorization";
import type { ClientRepository } from "./repository";
```

- [ ] **Step 2: Replace `getCurrentClientActor` and add the shared loader**

Replace:

```typescript
async function getCurrentClientActor(
  dependencies: AuthDependencies = {},
): Promise<AuthenticatedActor & { userId: string }> {
  const actor = await requireStaffActor(getRequest(), dependencies);

  if (!actor.userId) {
    throw new Error("Forbidden: a staff database identity is required.");
  }

  return { ...actor, userId: actor.userId };
}
```

With:

```typescript
const loadDefaultClientContext = createServerOnlyFn(async () => {
  const [{ getRequest }, { requireStaffActor }, { createClientRepository }] = await Promise.all([
    import("@tanstack/react-start/server"),
    import("@/features/auth/neon-auth-server"),
    import("./repository"),
  ]);
  return { getRequest, requireStaffActor, createClientRepository };
});

async function getCurrentClientActor(
  dependencies: AuthDependencies = {},
): Promise<AuthenticatedActor & { userId: string }> {
  const { getRequest, requireStaffActor } = await loadDefaultClientContext();
  const actor = await requireStaffActor(getRequest(), dependencies);

  if (!actor.userId) {
    throw new Error("Forbidden: a staff database identity is required.");
  }

  return { ...actor, userId: actor.userId };
}
```

- [ ] **Step 3: Replace `requireWritableCompany`'s repository parameter type**

This function's signature has a multi-line JSDoc comment between the `companyId` and
`targetTeamId` parameters — replace only the two-line fragment below (unique in the file), not the
whole signature, so the match doesn't need to reproduce that comment verbatim.

Replace:

```typescript
  repository: ReturnType<typeof createClientRepository>,
  companyId: string,
```

With:

```typescript
  repository: ClientRepository,
  companyId: string,
```

(`ReturnType<typeof createClientRepository>` no longer resolves — `createClientRepository` is not
a static value anymore. `ClientRepository` is the type it used to return, already exported from
`./repository`, and is now imported as `import type` at the top of the file — see Step 1. Nothing
else in `requireWritableCompany`'s signature or body changes.)

- [ ] **Step 4: Replace `withClientRepository`**

Replace:

```typescript
async function withClientRepository<T>(
  handler: (repository: ReturnType<typeof createClientRepository>) => Promise<T>,
): Promise<T> {
  const repository = createClientRepository();

  try {
    return await handler(repository);
  } finally {
    await repository.close();
  }
}
```

With:

```typescript
async function withClientRepository<T>(
  handler: (repository: ClientRepository) => Promise<T>,
): Promise<T> {
  const { createClientRepository } = await loadDefaultClientContext();
  const repository = createClientRepository();

  try {
    return await handler(repository);
  } finally {
    await repository.close();
  }
}
```

- [ ] **Step 5: Replace the three read-only handlers' auth checks**

Replace:

```typescript
export const listClients = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaffActor(getRequest());
  return withClientRepository((repository) => repository.listClients());
});

export const listClientAssignmentOptions = createServerFn({ method: "GET" }).handler(async () => {
  await requireStaffActor(getRequest());
  return withClientRepository((repository) => repository.listAssignmentOptions());
});

export const getClient = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireStaffActor(getRequest());
    return withClientRepository((repository) => repository.getClient(data.id));
  });
```

With:

```typescript
export const listClients = createServerFn({ method: "GET" }).handler(async () => {
  const { getRequest, requireStaffActor } = await loadDefaultClientContext();
  await requireStaffActor(getRequest());
  return withClientRepository((repository) => repository.listClients());
});

export const listClientAssignmentOptions = createServerFn({ method: "GET" }).handler(async () => {
  const { getRequest, requireStaffActor } = await loadDefaultClientContext();
  await requireStaffActor(getRequest());
  return withClientRepository((repository) => repository.listAssignmentOptions());
});

export const getClient = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    const { getRequest, requireStaffActor } = await loadDefaultClientContext();
    await requireStaffActor(getRequest());
    return withClientRepository((repository) => repository.getClient(data.id));
  });
```

`createClient`, `updateClient`, `addClientContact`, `updateClientContact`, and
`removeClientContact` already call only `withClientRepository`/`getCurrentClientActor`/
`requireWritableCompany` and need no further changes.

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: no errors. (No dedicated test file to run for this one — see Task 9 for full-suite and
manual verification.)

- [ ] **Step 7: Commit**

```bash
git add src/features/clients/server-fns.ts
git commit -m "fix: lazy-load server-only deps in clients/server-fns.ts"
```

---

### Task 7: Regression-gate script — `scripts/verify-dev-server-imports.ts` — ✅ DONE (commits `da28008`, `45d7a9d`, `d572a46`)

**Files:**
- Create: `scripts/verify-dev-server-imports.ts`
- Create: `scripts/verify-dev-server-imports.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test for the pure detection function**

Create `scripts/verify-dev-server-imports.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { findImportProtectionViolation } from "./verify-dev-server-imports";

describe("findImportProtectionViolation", () => {
  it("returns null when the dev server output has no violation", () => {
    expect(findImportProtectionViolation("VITE v8.0.0  ready in 412 ms\n")).toBeNull();
  });

  it("extracts the violation message when present", () => {
    const output =
      "some earlier log line\n" +
      "[import-protection] Import denied in client environment — Denied by file pattern: **/server/**\n" +
      "more log output after it";

    const violation = findImportProtectionViolation(output);

    expect(violation).toContain("[import-protection] Import denied in client environment");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run scripts/verify-dev-server-imports.test.ts`
Expected: FAIL — `scripts/verify-dev-server-imports.ts` does not exist yet.

- [ ] **Step 3: Write the script**

Create `scripts/verify-dev-server-imports.ts`:

```typescript
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

// Placeholder routes and one placeholder id for the one dynamic route
// (annual-returns.$id.tsx) — this gate checks that the module graph loads
// without an import-protection violation, not that the id resolves to real
// data, so any well-formed UUID is fine.
const ROUTE_PATHS = [
  "/",
  "/admin",
  "/annual-returns",
  "/annual-returns/11111111-1111-4111-8111-111111111111",
  "/documents",
  "/login",
  "/payments",
  "/portal",
  "/settings",
  "/whatsapp",
  "/whatsapp/automation",
  "/work-queue",
] as const;

const READY_TIMEOUT_MS = 30_000;
const ROUTE_REQUEST_TIMEOUT_MS = 15_000;
const IMPORT_PROTECTION_MARKER = "[import-protection]";

export function findImportProtectionViolation(output: string): string | null {
  const index = output.indexOf(IMPORT_PROTECTION_MARKER);
  if (index === -1) return null;
  return output.slice(index, index + 400);
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, () => {
      const address = server.address();
      if (address === null || typeof address === "string") {
        server.close();
        reject(new Error("Could not determine a free port."));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

function waitForReady(getOutput: () => string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (getOutput().includes("ready in")) {
        clearInterval(interval);
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(
          new Error(`Dev server did not report ready within ${timeoutMs}ms.\n${getOutput()}`),
        );
      }
    }, 200);
  });
}

async function requestRoute(
  baseUrl: string,
  path: string,
): Promise<{ path: string; ok: boolean; error?: string }> {
  try {
    // Any HTTP status (including a redirect to /login for an unauthenticated
    // route) proves the route module loaded and rendered without the import
    // graph itself throwing — that is the only thing this gate checks.
    const response = await fetch(`${baseUrl}${path}`, {
      signal: AbortSignal.timeout(ROUTE_REQUEST_TIMEOUT_MS),
    });
    await response.text();
    return { path, ok: true };
  } catch (error) {
    return { path, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function main(): Promise<void> {
  const port = await findFreePort();
  let output = "";
  const child: ChildProcessWithoutNullStreams = spawn(
    "npm",
    ["run", "dev", "--", "--port", String(port)],
    {
      env: { ...process.env, VITE_ENABLE_DEMO_AUTH: "true" },
      shell: true,
      // Detaching on POSIX lets teardown kill the whole process group — `npm
      // run dev` runs through a shell that forks vite as a grandchild, and
      // killing only the shell's own pid leaves that grandchild running.
      detached: process.platform !== "win32",
    },
  );
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });

  function killChild(): void {
    if (process.platform === "win32" || !child.pid) {
      child.kill();
      return;
    }
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }

  try {
    await waitForReady(() => output, READY_TIMEOUT_MS);

    const baseUrl = `http://localhost:${port}`;
    const results = [];
    for (const path of ROUTE_PATHS) {
      results.push(await requestRoute(baseUrl, path));
    }

    for (const result of results) {
      console.log(`${result.ok ? "PASS" : "FAIL"} request ${result.path}${result.error ? `: ${result.error}` : ""}`);
    }

    const violation = findImportProtectionViolation(output);
    if (violation) {
      console.log(`FAIL import-protection violation detected in dev server output:\n${violation}`);
    } else {
      console.log("PASS no import-protection violation in dev server output");
    }

    const failedRequests = results.filter((result) => !result.ok).length;
    if (violation || failedRequests > 0) {
      process.exitCode = 1;
    }
  } finally {
    killChild();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run scripts/verify-dev-server-imports.test.ts`
Expected: PASS (2/2).

- [ ] **Step 5: Add the npm script**

In `package.json`, add this line after `"verify:firm": "node --experimental-strip-types scripts/verify-firm-deployment.ts"`:

```json
    "verify:dev-server-imports": "node --experimental-strip-types scripts/verify-dev-server-imports.ts"
```

(Remember to add a trailing comma to the `verify:firm` line above it, since it's no longer the
last entry in `scripts`.)

- [ ] **Step 6: Run the script for real against the now-fixed codebase**

Run: `npm run verify:dev-server-imports`
Expected: every route line prints `PASS request ...`, and the final two lines are
`PASS no import-protection violation in dev server output` — confirming Tasks 1–6 actually fixed
the problem this script exists to catch. If anything prints `FAIL`, stop and re-check the relevant
task above before continuing — do not proceed to Task 8 with a failing gate.

- [ ] **Step 7: Commit**

```bash
git add scripts/verify-dev-server-imports.ts scripts/verify-dev-server-imports.test.ts package.json
git commit -m "test: add dev-server import-boundary regression gate"
```

---

### Task 8: Wire the gate into CI

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add the new step after Build, before the cron-wiring check**

Replace:

```yaml
      # The scheduled handler only reaches the Worker through a nitro plugin, and
      # nothing but a real build proves the hook actually lands in the output.
      - name: Build
        run: npm run build

      - name: Cron trigger has a handler in the built Worker
        run: |
          grep -q 'hooks.hook("cloudflare:scheduled"' .output/server/index.mjs \
            || { echo "cloudflare:scheduled hook missing from the built Worker"; exit 1; }
```

With:

```yaml
      # The scheduled handler only reaches the Worker through a nitro plugin, and
      # nothing but a real build proves the hook actually lands in the output.
      - name: Build
        run: npm run build

      # npm run build passing doesn't prove npm run dev works — dev mode skips
      # Rollup's tree-shaking, so a static import of server-only code that build
      # happily eliminates can still break every page in dev. This boots the real
      # dev server and requests every route to catch that class of regression.
      - name: Dev server import boundaries
        run: npm run verify:dev-server-imports

      - name: Cron trigger has a handler in the built Worker
        run: |
          grep -q 'hooks.hook("cloudflare:scheduled"' .output/server/index.mjs \
            || { echo "cloudflare:scheduled hook missing from the built Worker"; exit 1; }
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: run the dev-server import-boundary gate after Build"
```

---

### Task 9: Final verification sweep — Steps 1-4 ✅ DONE (typecheck/lint/test/scope-check/build/gate all green; two follow-up fixes needed and applied: `e408e53` prettier formatting in the gate script, `468c614` widened a stale source-text regex window in `-production-authorization.test.ts` after Task 5 legitimately changed `whatsapp/server-fns.ts`'s shape — full suite now 756 passed/92 skipped/0 failed)

**Files:** none (verification only)

- [ ] **Step 1: Full typecheck, lint, and test suite**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run lint`
Expected: no errors.

Run: `npm run test`
Expected: same pass count as on `main` before this branch — no regressions, no test changes were
needed anywhere in this plan.

- [ ] **Step 2: Confirm the pre-existing scope table is now accurate**

Run:

```bash
grep -rl "= createServerFn(" src/features/ | xargs grep -L "createServerOnlyFn"
```

Expected output: only `src/features/auth/neon-auth-rpc.ts` (the confirmed-safe inline-dynamic-import
variant — it has no `createServerOnlyFn` by design, and no static value import of anything
server-only either). If any other file appears in this list, one of Tasks 1–6 was missed or
reverted — go back and check it.

- [ ] **Step 3: Build still passes**

Run: `npm run build`
Expected: exit 0 (this already passed before this branch; confirms nothing broke it).

- [ ] **Step 4: Run the regression gate directly one more time**

Run: `npm run verify:dev-server-imports`
Expected: all `PASS` lines, exit 0.

- [ ] **Step 5: Manual browser smoke test**

Start the dev server: `VITE_ENABLE_DEMO_AUTH=true npm run dev -- --port 5173`

Using the browser tool, visit each of the following and confirm the page renders with no
`[import-protection]` error in the dev server's terminal output: `/`, `/annual-returns`,
`/documents`, `/payments`, `/portal`, `/settings`, `/work-queue`. This is the concrete acceptance
check the whole plan exists to make possible — before Task 1, every one of these threw.

- [ ] **Step 6: Update the roadmap memory**

This isn't a code change — update
`C:\Users\laich\.claude\projects\C--Users-laich-Documents-kossilon-hub\memory\project_kossilon_hub_roadmap_status.md`
to note this branch (`codex/dev-server-import-boundaries`) fixed the dev-server import-boundary
bug discovered during P1-12's manual smoke check, so future sessions know `npm run dev` is trusted
again for browser verification.

- [ ] **Step 7: Proceed to `superpowers:finishing-a-development-branch`**

All tasks complete and verified — hand off to that skill to decide how to land this branch (merge
locally / push + PR / keep as-is / discard).
