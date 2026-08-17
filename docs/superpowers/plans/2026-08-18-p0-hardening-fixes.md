# P0 Hardening Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close four independent, small security/correctness gaps: unscoped document listing (P0-5), missing admin guards on two production screens (P0-7), an under-authorized outbox-flush escape hatch (P0-8), and a dashboard-scoping regression test that doesn't actually test anything (P0-9).

**Architecture:** Four unrelated tasks, each following an established pattern already proven elsewhere in this codebase — no new architecture, no shared code between tasks.

**Tech Stack:** TypeScript strict, Vitest, TanStack Start server functions, Postgres via `postgres.js`, React Testing Library / `renderToString` for route-level component tests.

---

## Context you need before task 1

**Source of truth:** `docs/superpowers/specs/2026-08-18-p0-hardening-fixes-design.md` — read it for the full reasoning behind each fix's scope. This plan reproduces everything needed to implement it, re-verified against the current repo (branch `main`, 2026-08-18) rather than trusted from the original roadmap review, which predates the live-email-transport and annual-return-reminder-cadence work merged since.

**These four tasks are genuinely independent** — they touch different files with no shared imports or dependencies. They're bundled into one plan purely because each is individually tiny (S-effort), matching how P0-1 through P0-4 and P0-10 were bundled into one plan despite being five separate roadmap lines. Execute them in any order; there is no cross-task dependency.

**The established `*ForActor` convention, used throughout this codebase**, is the backbone of Tasks 1 and 3 below: a server fn resolves an actor and thin-wraps a separately-exported, unit-testable `xForActor(actor, input, dependencies)` function that contains the actual authorization and business logic. `listAnnualReturnCasesForActor` (`annual-return/server-fns.ts`) and its tests (`annual-return/server-fns.authorization.test.ts:134-191`) are the canonical example this plan mirrors twice.

All paths below are relative to the repo root. Work on branch `codex/p0-hardening-fixes` (already created off `main`, already has the design spec committed).

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/features/documents/server-fns.ts` | Modify | New `documentFiltersForActor` + extracted `listDocumentsForActor`, matching the file's existing `*ForActor` convention |
| `src/features/documents/repository.ts` | Modify | `listDocuments`/`documentRows` gain a `teamId` filter |
| `src/features/documents/server-fns.test.ts` | Modify | New tests for `documentFiltersForActor`/`listDocumentsForActor` |
| `src/routes/admin.tsx` | Modify | `ProductionAdminConsole` gates on `isCurrentUserAdmin` |
| `src/routes/settings.tsx` | Modify | `SettingsPage` gates on `isCurrentUserAdmin` |
| `src/routes/-admin-guard.test.tsx` | Create | Route-level test for both admin/non-admin states on `/admin` |
| `src/routes/-settings-admin-guard.test.tsx` | Create | Route-level test for both admin/non-admin states on `/settings` |
| `src/features/notifications/runtime-dispatch.ts` | Modify | New `assertAdminAccess` + extracted `dispatchDueNotificationsForActor`, with logging |
| `src/features/notifications/runtime-dispatch.test.ts` | Modify | New tests for the extracted function |
| `src/features/annual-return/server-fns.authorization.test.ts` | Modify | New behavioral test proving `getAnnualReturnDashboardMetricsForActor` actually scopes |

---

## Task 1: P0-5 — Document listing team scoping

**Files:**
- Modify: `src/features/documents/server-fns.ts`
- Modify: `src/features/documents/repository.ts`
- Modify: `src/features/documents/server-fns.test.ts`

### Step 1: Write the failing tests

Read `src/features/documents/server-fns.test.ts` in full first (it defines an `actor`/`companyId`/`intent`/`document` fixture set and a `dependencies(overrides)` helper — reuse them).

Add near the top of the file, after the existing fixtures:

```typescript
const staffActor: AuthenticatedActor = {
  authUserId: "staff-auth",
  userId: "20000000-0000-0000-0000-000000000002",
  role: "Staff",
  teamId: "10000000-0000-0000-0000-000000000001",
  active: true,
};
const managerActor: AuthenticatedActor = {
  ...staffActor,
  authUserId: "manager-auth",
  userId: "20000000-0000-0000-0000-000000000003",
  role: "Manager",
};
const adminActor: AuthenticatedActor = {
  authUserId: "admin-auth",
  userId: "20000000-0000-0000-0000-000000000004",
  role: "Admin",
  teamId: null,
  active: true,
};
```

Add a new import for `documentFiltersForActor`/`listDocumentsForActor` (which Step 2 will create) alongside the existing imports from `./server-fns`.

Add a new `describe` block:

```typescript
describe("documentFiltersForActor", () => {
  it("does not restrict an admin", () => {
    expect(documentFiltersForActor(adminActor)).toEqual({});
  });

  it("scopes a manager to their team", () => {
    expect(documentFiltersForActor(managerActor)).toEqual({ teamId: managerActor.teamId });
  });

  it("scopes staff to their team", () => {
    expect(documentFiltersForActor(staffActor)).toEqual({ teamId: staffActor.teamId });
  });

  it("refuses an inactive actor", () => {
    expect(() => documentFiltersForActor({ ...staffActor, active: false })).toThrow(
      "Forbidden: inactive users cannot list documents.",
    );
  });

  it("refuses a client", () => {
    expect(() => documentFiltersForActor(actor)).toThrow("Forbidden: staff access is required.");
  });

  it("refuses a staff actor with no assigned team", () => {
    expect(() => documentFiltersForActor({ ...staffActor, teamId: null })).toThrow(
      "Forbidden: staff actor has no assigned team.",
    );
  });
});

describe("listDocumentsForActor", () => {
  it("narrows a staff actor's list to their own team", async () => {
    const deps = dependencies();

    await listDocumentsForActor(staffActor, {}, deps);

    expect(deps.repository.listDocuments).toHaveBeenCalledWith({ teamId: staffActor.teamId });
  });

  it("does not let a client-supplied filter widen a staff actor's scope", async () => {
    const deps = dependencies();

    await listDocumentsForActor(
      staffActor,
      { companyId: "10000000-0000-0000-0000-000000000099" },
      deps,
    );

    expect(deps.repository.listDocuments).toHaveBeenCalledWith({
      companyId: "10000000-0000-0000-0000-000000000099",
      teamId: staffActor.teamId,
    });
  });

  it("does not narrow an admin", async () => {
    const deps = dependencies();

    await listDocumentsForActor(adminActor, {}, deps);

    expect(deps.repository.listDocuments).toHaveBeenCalledWith({});
  });

  it("still requires a company ID and authorization for a client", async () => {
    const deps = dependencies();

    await expect(listDocumentsForActor(actor, {}, deps)).rejects.toThrow(
      "Client document lists require a company ID.",
    );

    await listDocumentsForActor(actor, { companyId }, deps);
    expect(deps.authorizeCompany).toHaveBeenCalledWith(actor, companyId);
    expect(deps.repository.listDocuments).toHaveBeenCalledWith({ companyId });
  });
});
```

(The last test reuses this file's existing top-level `actor` fixture, which is the Client actor, and its existing `companyId` constant.)

Run: `npm run test -- src/features/documents/server-fns.test.ts`
Expected: FAIL — `documentFiltersForActor`/`listDocumentsForActor` don't exist yet.

### Step 2: Implement `documentFiltersForActor` and `listDocumentsForActor`

In `src/features/documents/server-fns.ts`, add after `downloadDocumentForActor` (before the `MAX_UPLOAD_BYTES` constant):

```typescript
export type DocumentScope = { teamId?: string };

export function documentFiltersForActor(actor: AuthenticatedActor): DocumentScope {
  if (!actor.active) {
    throw new Error("Forbidden: inactive users cannot list documents.");
  }
  if (actor.role === "Client") {
    throw new Error("Forbidden: staff access is required.");
  }
  if (actor.role === "Admin") {
    return {};
  }
  if (!actor.teamId) {
    throw new Error("Forbidden: staff actor has no assigned team.");
  }
  return { teamId: actor.teamId };
}

export async function listDocumentsForActor(
  actor: AuthenticatedActor,
  filters: { companyId?: string; caseId?: string },
  dependencies: Pick<DocumentOperationDependencies, "repository" | "authorizeCompany">,
) {
  if (actor.role === "Client") {
    if (!filters.companyId) throw new Error("Client document lists require a company ID.");
    await dependencies.authorizeCompany(actor, filters.companyId);
    return dependencies.repository.listDocuments(filters);
  }

  const scope = documentFiltersForActor(actor);
  return dependencies.repository.listDocuments({ ...filters, ...scope });
}
```

Replace the existing `listDocuments` server fn:

```typescript
export const listDocuments = createServerFn({ method: "GET" })
  .validator(
    z
      .object({ companyId: z.string().uuid().optional(), caseId: z.string().uuid().optional() })
      .strict(),
  )
  .handler(({ data }) =>
    withDefaultDocumentContext((actor, dependencies) =>
      listDocumentsForActor(actor, data, dependencies),
    ),
  );
```

### Step 3: Add `teamId` filtering to the repository

Read `src/features/documents/repository.ts`'s `DocumentRepository` type, `documentRows`, and `listDocuments` in full first.

Update the `DocumentRepository` type's `listDocuments` signature:

```typescript
  listDocuments(filters?: { companyId?: string; caseId?: string; teamId?: string }): Promise<PrivateDocument[]>;
```

Replace `documentRows`:

```typescript
  async function documentRows(
    filters: { id?: string; companyId?: string; caseId?: string; teamId?: string } = {},
  ) {
    return sql<DocumentRow[]>`
      select d.*, i.content_type, i.expected_size_bytes, i.checksum_sha256, i.status upload_status
      from documents d
      join document_upload_intents i on i.document_id = d.id
      join companies c on c.id = d.company_id
      where (${filters.id ?? null}::uuid is null or d.id = ${filters.id ?? null})
        and (${filters.companyId ?? null}::uuid is null or d.company_id = ${filters.companyId ?? null})
        and (${filters.caseId ?? null}::uuid is null or d.case_id = ${filters.caseId ?? null})
        and (${filters.teamId ?? null}::uuid is null or c.assigned_team_id = ${filters.teamId ?? null})
      order by d.uploaded_at desc, d.id`;
  }
```

`documents.company_id` is `not null references companies(id)` (`schema.sql:57`), so the new `join companies c` is lossless — every document row already has a matching company.

`listDocuments`'s implementation (`async listDocuments(filters = {}) { return (await documentRows(filters)).map(mapDocument); }`) needs no change — it already forwards whatever filters object it receives.

### Step 4: Run the tests

Run: `npm run test -- src/features/documents/server-fns.test.ts`
Expected: PASS, all cases including every pre-existing test in the file.

If `TEST_DATABASE_URL` is set, also run any documents repository integration tests to confirm the new join doesn't break existing fixtures: `npm run test -- src/features/documents`.

### Step 5: Verify

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm run lint`
Expected: clean, exit code checked directly.

### Step 6: Commit

```bash
git add src/features/documents/server-fns.ts src/features/documents/repository.ts src/features/documents/server-fns.test.ts
git commit -m "fix(documents): scope document listing to the actor's team"
```

---

## Task 2: P0-7 — Admin route guards (client-side)

**Files:**
- Modify: `src/routes/admin.tsx`
- Modify: `src/routes/settings.tsx`
- Create: `src/routes/-admin-guard.test.tsx`
- Create: `src/routes/-settings-admin-guard.test.tsx`

### Step 1: Write the failing test for `/admin`

Create `src/routes/-admin-guard.test.tsx`, mirroring `-dashboard-modes.test.tsx`'s router-rendering harness exactly:

```typescript
import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../styles.css?url", () => ({ default: "/styles.css" }));

vi.mock("@/features/auth/neon-auth-rpc", () => ({
  getAuthenticatedActor: () => Promise.resolve({ authUserId: "test-user" }),
}));

const mockIsAdmin = vi.hoisted(() => ({ value: true }));

vi.mock("@/features/auth/auth-context-neon", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../features/auth/auth-context-neon")>();
  return {
    ...actual,
    AuthProvider: ({ children }: { children: ReactNode }) => children,
    useAuth: () => ({
      session: {
        id: "test-user",
        name: "Test User",
        email: "user@example.test",
        role: mockIsAdmin.value ? ("Admin" as const) : ("Staff" as const),
        initials: "TU",
        team: "Operations",
        signedInAt: "2026-07-11T00:00:00.000Z",
      },
      isHydrated: true,
      demoUsers: [],
      isCurrentUserAdmin: mockIsAdmin.value,
      login: vi.fn(),
      loginWithMagicLink: vi.fn(),
      loginWithGoogle: vi.fn(),
      loginDemo: vi.fn(),
      loginDemoUser: vi.fn(),
      signOut: vi.fn(),
    }),
  };
});

import { routeTree } from "../routeTree.gen";

afterEach(() => {
  mockIsAdmin.value = true;
});

async function renderAdmin() {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/admin"] }),
    context: { queryClient: new QueryClient(), dataMode: "production" as const, actor: null },
    defaultPreloadStaleTime: 0,
  });

  await router.load();

  return renderToString(createElement(RouterProvider, { router }));
}

describe("/admin production console, gated by role", () => {
  it("shows the console to an admin", async () => {
    mockIsAdmin.value = true;

    const html = await renderAdmin();

    expect(html).toContain("Not available in this deployment");
    expect(html).not.toContain("Admin access required");
  });

  it("shows a denied state to a non-admin", async () => {
    mockIsAdmin.value = false;

    const html = await renderAdmin();

    expect(html).toContain("Admin access required");
    expect(html).not.toContain("Not available in this deployment");
  });
});
```

Run: `npm run test -- src/routes/-admin-guard.test.tsx`
Expected: FAIL — `ProductionAdminConsole` currently renders "Not available in this deployment" regardless of role, so the "denied to a non-admin" case fails.

### Step 2: Gate `ProductionAdminConsole`

Read `src/routes/admin.tsx` in full first — note `DemoAdminConsole`'s existing denied-state JSX (lines 146-174) to match its structure/tone.

Replace:

```typescript
function ProductionAdminConsole() {
  const { session } = useAuth();

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader
        eyebrow="Administration"
        title="Admin"
        subtitle="User and system administration"
      />
      <section className="rounded-xl border border-border bg-card p-6">
        <div className="flex max-w-2xl items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-status-yellow-soft">
            <ShieldCheck className="h-5 w-5 text-status-orange" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold text-foreground">
              Not available in this deployment
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Staff accounts, roles and team membership are managed in Neon Auth and in the
              firm&rsquo;s <code className="font-mono text-xs">staff_profiles</code> table, not from
              this console. The prototype user list this screen used to show was fixture data and
              never reflected the firm&rsquo;s real users.
            </p>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Signed in as {session?.name ?? "an authenticated user"} ({session?.role ?? "User"}).
            </p>
            <Link className="mt-4 inline-flex rounded-md border px-3 py-2 text-sm" to="/">
              Back to dashboard
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
```

with:

```typescript
function ProductionAdminConsole() {
  const { session, isCurrentUserAdmin } = useAuth();

  if (!isCurrentUserAdmin) {
    return (
      <main className="flex-1 space-y-6 p-6">
        <PageHeader eyebrow="Administration" title="Admin" subtitle="Restricted area" />
        <section className="rounded-xl border border-border bg-card p-6">
          <div className="flex max-w-2xl items-start gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-status-yellow-soft">
              <LockKeyhole className="h-5 w-5 text-status-orange" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-lg font-semibold text-foreground">
                Admin access required
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {session?.name ?? "This user"} is signed in as {session?.role ?? "User"}.
                Administration is limited to Admin users.
              </p>
              <Link
                to="/"
                className="mt-4 inline-flex rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
              >
                Back to dashboard
              </Link>
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader
        eyebrow="Administration"
        title="Admin"
        subtitle="User and system administration"
      />
      <section className="rounded-xl border border-border bg-card p-6">
        <div className="flex max-w-2xl items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-status-yellow-soft">
            <ShieldCheck className="h-5 w-5 text-status-orange" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold text-foreground">
              Not available in this deployment
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              Staff accounts, roles and team membership are managed in Neon Auth and in the
              firm&rsquo;s <code className="font-mono text-xs">staff_profiles</code> table, not from
              this console. The prototype user list this screen used to show was fixture data and
              never reflected the firm&rsquo;s real users.
            </p>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Signed in as {session?.name ?? "an authenticated user"} ({session?.role ?? "User"}).
            </p>
            <Link className="mt-4 inline-flex rounded-md border px-3 py-2 text-sm" to="/">
              Back to dashboard
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
```

`LockKeyhole` is already imported at the top of this file (used by `DemoAdminConsole`) — no new import needed.

### Step 3: Run the `/admin` test

Run: `npm run test -- src/routes/-admin-guard.test.tsx`
Expected: PASS, both cases.

### Step 4: Write the failing test for `/settings`

Create `src/routes/-settings-admin-guard.test.tsx`, following the same harness pattern as Step 1 (a fresh file, since `-settings.interaction.test.tsx` only tests the isolated `WhatsAppIntegrationStatus` sub-component, not the full route):

```typescript
import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../styles.css?url", () => ({ default: "/styles.css" }));

vi.mock("@/features/auth/neon-auth-rpc", () => ({
  getAuthenticatedActor: () => Promise.resolve({ authUserId: "test-user" }),
}));

vi.mock("@/features/whatsapp/server-fns", () => ({
  getWhatsAppIntegrationStatus: () =>
    Promise.resolve({ deliveryMode: "simulated" as const, missingLiveEnvVars: [] }),
}));

const mockIsAdmin = vi.hoisted(() => ({ value: true }));

vi.mock("@/features/auth/auth-context-neon", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../features/auth/auth-context-neon")>();
  return {
    ...actual,
    AuthProvider: ({ children }: { children: ReactNode }) => children,
    useAuth: () => ({
      session: {
        id: "test-user",
        name: "Test User",
        email: "user@example.test",
        role: mockIsAdmin.value ? ("Admin" as const) : ("Staff" as const),
        initials: "TU",
        team: "Operations",
        signedInAt: "2026-07-11T00:00:00.000Z",
      },
      isHydrated: true,
      demoUsers: [],
      isCurrentUserAdmin: mockIsAdmin.value,
      login: vi.fn(),
      loginWithMagicLink: vi.fn(),
      loginWithGoogle: vi.fn(),
      loginDemo: vi.fn(),
      loginDemoUser: vi.fn(),
      signOut: vi.fn(),
    }),
  };
});

import { routeTree } from "../routeTree.gen";

afterEach(() => {
  mockIsAdmin.value = true;
});

async function renderSettings() {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/settings"] }),
    context: { queryClient: new QueryClient(), dataMode: "production" as const, actor: null },
    defaultPreloadStaleTime: 0,
  });

  await router.load();

  return renderToString(createElement(RouterProvider, { router }));
}

describe("/settings, gated by role", () => {
  it("shows settings content to an admin", async () => {
    mockIsAdmin.value = true;

    const html = await renderSettings();

    expect(html).not.toContain("Admin access required");
  });

  it("shows a denied state to a non-admin", async () => {
    mockIsAdmin.value = false;

    const html = await renderSettings();

    expect(html).toContain("Admin access required");
  });
});
```

Run: `npm run test -- src/routes/-settings-admin-guard.test.tsx`
Expected: FAIL — `SettingsPage` has no admin gate yet, so the "denied to a non-admin" case fails.

### Step 5: Gate `SettingsPage`

Read `src/routes/settings.tsx` in full first — note every existing hook call in `SettingsPage` (`Route.useRouteContext()`, `useTemplates()`, `useQuery()`, three `useState()` calls, `useMemo()`). All hooks must stay unconditional; the conditional return goes after every hook call, per this codebase's established Rules-of-Hooks discipline.

Add the import:

```typescript
import { useAuth } from "@/features/auth/auth-context-neon";
```

Inside `SettingsPage`, add `const { isCurrentUserAdmin } = useAuth();` alongside the other hook calls at the top of the function (after `const { dataMode } = Route.useRouteContext();`, before or after the other hooks — position among the hook calls doesn't matter as long as it's before any conditional return).

Immediately after all the existing hook calls (after the `filtered` computation, before the `return (...)` that renders the page), add:

```typescript
  if (!isCurrentUserAdmin) {
    return (
      <main className="flex-1 space-y-6 p-6">
        <PageHeader eyebrow="Administration" title="Settings" subtitle="Restricted area" />
        <section className="rounded-xl border border-border bg-card p-6">
          <p className="text-sm leading-6 text-muted-foreground">
            Admin access required. Settings are limited to Admin users.
          </p>
        </section>
      </main>
    );
  }
```

### Step 6: Run both tests

Run: `npm run test -- src/routes/-admin-guard.test.tsx src/routes/-settings-admin-guard.test.tsx`
Expected: PASS, all 4 cases.

Run: `npm run test -- src/routes/-settings.interaction.test.tsx`
Expected: PASS, unchanged — this test only renders the isolated `WhatsAppIntegrationStatus` sub-component directly, not the gated `SettingsPage`, so it's unaffected.

### Step 7: Verify

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm run lint`
Expected: clean, exit code checked directly.

### Step 8: Commit

```bash
git add src/routes/admin.tsx src/routes/settings.tsx src/routes/-admin-guard.test.tsx src/routes/-settings-admin-guard.test.tsx
git commit -m "fix(routes): gate /admin and /settings behind isCurrentUserAdmin"
```

---

## Task 3: P0-8 — Outbox flush requires Admin, and is logged

**Files:**
- Modify: `src/features/notifications/runtime-dispatch.ts`
- Modify: `src/features/notifications/runtime-dispatch.test.ts`

### Step 1: Write the failing tests

Read `src/features/notifications/runtime-dispatch.ts` and `runtime-dispatch.test.ts` in full first.

Add to `runtime-dispatch.test.ts` (add `AuthenticatedActor` to its imports if not already present):

```typescript
const adminActor: AuthenticatedActor = {
  authUserId: "admin-auth",
  userId: "20000000-0000-0000-0000-000000000001",
  role: "Admin",
  teamId: null,
  active: true,
};
const staffActor: AuthenticatedActor = {
  authUserId: "staff-auth",
  userId: "20000000-0000-0000-0000-000000000002",
  role: "Staff",
  teamId: "10000000-0000-0000-0000-000000000001",
  active: true,
};

describe("dispatchDueNotificationsForActor", () => {
  it("rejects a non-admin actor", async () => {
    const dispatch = vi.fn();

    await expect(
      dispatchDueNotificationsForActor(staffActor, {}, { dispatch }),
    ).rejects.toThrow("Forbidden: Admin access is required.");
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("dispatches and logs for an admin actor", async () => {
    const summary = { claimed: 1, sent: 1, retried: 0, permanentlyFailed: 0, superseded: 0 };
    const dispatch = vi.fn(async () => summary);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await dispatchDueNotificationsForActor(adminActor, { limit: 10 }, { dispatch });

    expect(result).toEqual(summary);
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, now: expect.any(String) }),
    );
    expect(logSpy).toHaveBeenCalledWith(
      "Manual outbox dispatch",
      expect.objectContaining({ actorId: adminActor.userId, summary }),
    );

    logSpy.mockRestore();
  });
});
```

Run: `npm run test -- src/features/notifications/runtime-dispatch.test.ts -t "dispatchDueNotificationsForActor"`
Expected: FAIL — `dispatchDueNotificationsForActor` does not exist yet.

### Step 2: Implement `assertAdminAccess` and `dispatchDueNotificationsForActor`

In `src/features/notifications/runtime-dispatch.ts`, add to the imports:

```typescript
import type { AuthenticatedActor } from "@/features/auth/types";
```

Add after `dispatchDueNotificationsOnServer`'s definition, before the existing `/** The manual dispatch escape hatch... */` comment:

```typescript
export function assertAdminAccess(actor: AuthenticatedActor): void {
  if (actor.role !== "Admin") throw new Error("Forbidden: Admin access is required.");
}

export async function dispatchDueNotificationsForActor(
  actor: AuthenticatedActor,
  input: { limit?: number },
  dependencies: {
    dispatch(input: { now: string; limit?: number }): ReturnType<typeof dispatchDueNotificationsOnServer>;
  } = { dispatch: dispatchDueNotificationsOnServer },
) {
  assertAdminAccess(actor);
  const now = new Date().toISOString();
  const summary = await dependencies.dispatch({ ...input, now });
  console.log("Manual outbox dispatch", {
    actorId: actor.userId ?? actor.authUserId,
    now,
    summary,
  });
  return summary;
}
```

Replace the `dispatchDueNotifications` server fn:

```typescript
export const dispatchDueNotifications = createServerFn({ method: "POST" })
  .validator(manualDispatchInputSchema)
  .handler(async ({ data }) => {
    const [{ getRequest }, { requireStaffActor }] = await Promise.all([
      import("@tanstack/react-start/server"),
      import("@/features/auth/neon-auth-server"),
    ]);
    const actor = await requireStaffActor(getRequest());
    return dispatchDueNotificationsForActor(actor, data);
  });
```

`requireStaffActor` already calls `assertStaffAccess` internally (`neon-auth-server.ts:157`, `assertStaffAccess(await requireActor(...))`), so by the time `dispatchDueNotificationsForActor` runs, the actor is already confirmed active and non-Client — `assertAdminAccess` only needs to add the Admin-specific check on top.

### Step 3: Run the tests

Run: `npm run test -- src/features/notifications/runtime-dispatch.test.ts`
Expected: PASS, all cases including every pre-existing test in the file.

### Step 4: Verify

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm run lint`
Expected: clean, exit code checked directly.

### Step 5: Commit

```bash
git add src/features/notifications/runtime-dispatch.ts src/features/notifications/runtime-dispatch.test.ts
git commit -m "fix(notifications): require Admin for manual outbox dispatch, and log it"
```

---

## Task 4: P0-9 — Real behavioral test for dashboard-tile scoping

**Files:**
- Modify: `src/features/annual-return/server-fns.authorization.test.ts`

**No production code changes** — `getAnnualReturnDashboardMetricsForActor` and `caseFiltersForActor` already work correctly (confirmed by reading both in full); only the regression coverage is missing. This test needs no database — it mocks `repository.dashboardMetrics` and asserts the correctly-computed scope is passed through, exactly mirroring how `listAnnualReturnCasesForActor` is already tested in this same file (`server-fns.authorization.test.ts:134-191`).

### Step 1: Write the failing test

Read `src/features/annual-return/server-fns.authorization.test.ts` in full first — reuse its existing `staffActor`/`clientActor` fixtures and its `repositoryFor(...)` helper pattern (e.g. lines 127-132) rather than redefining them.

Add `getAnnualReturnDashboardMetricsForActor` to the existing import from `./server-fns`.

Add a new `describe` block, near the existing `"narrows the list to what the acting staff member may act on"` tests:

```typescript
describe("getAnnualReturnDashboardMetricsForActor", () => {
  function repositoryFor(dashboardMetrics = vi.fn(async () => ({
    dueIn7: 0,
    dueIn30: 0,
    overdue: 0,
    highRisk: 0,
    missingDocuments: 0,
    paymentPending: 0,
    assignedToMe: 0,
  }))) {
    return {
      dashboardMetrics,
      repository: { dashboardMetrics } as unknown as Pick<
        AnnualReturnRepository,
        "dashboardMetrics"
      >,
    };
  }

  it("scopes a staff actor's tiles to their own team", async () => {
    const { dashboardMetrics, repository } = repositoryFor();

    await getAnnualReturnDashboardMetricsForActor(staffActor, { repository });

    expect(dashboardMetrics).toHaveBeenCalledWith(expect.any(String), staffActor.userId, {
      teamId: staffActor.teamId,
      visibleToUserId: staffActor.userId,
    });
  });

  it("does not scope an admin's tiles", async () => {
    const { dashboardMetrics, repository } = repositoryFor();
    const admin: AuthenticatedActor = {
      authUserId: "admin-auth",
      userId: "20000000-0000-0000-0000-000000000005",
      role: "Admin",
      teamId: null,
      active: true,
    };

    await getAnnualReturnDashboardMetricsForActor(admin, { repository });

    expect(dashboardMetrics).toHaveBeenCalledWith(expect.any(String), admin.userId, {});
  });

  it("refuses a client", async () => {
    const { repository } = repositoryFor();

    await expect(
      getAnnualReturnDashboardMetricsForActor(clientActor, { repository }),
    ).rejects.toThrow("Forbidden: staff access is required.");
  });
});
```

Run: `npm run test -- src/features/annual-return/server-fns.authorization.test.ts -t "getAnnualReturnDashboardMetricsForActor"`
Expected: PASS immediately — the underlying function is already correct (confirmed in Task 4's own context above); this step exists to prove the test is meaningful, not to fix a bug. Confirm this by temporarily reverting `boardActorFrom`'s `teamId: actor.teamId` to `teamId: null` (or similar) and re-running — the "scopes a staff actor's tiles" test should fail, proving it actually catches a regression. Revert the temporary break before continuing.

### Step 2: Verify

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm run lint`
Expected: clean, exit code checked directly.

### Step 3: Commit

```bash
git add src/features/annual-return/server-fns.authorization.test.ts
git commit -m "test(annual-return): add real behavioral coverage for dashboard tile scoping"
```

---

## Task 5: Full verification sweep

**Files:** none modified.

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: clean. Confirm the exit code directly (run it unpiped, or check `$?` immediately after) — a piped `tail`/`head` summary reports the pipe's own exit code, not lint's.

- [ ] **Step 3: Full suite**

Run: `npm run test`
Expected: PASS, with a total no lower than this branch's baseline before Task 1.

- [ ] **Step 4: Confirm no other unscoped `listDocuments` call site was missed**

Run: `grep -rn "listDocuments(" src/ --include=*.tsx --include=*.ts | grep -v ".test."`
Expected: every production call site (`routes/payments.tsx`, `routes/documents.tsx`, `documents/server-fns.ts`) is either the new `listDocumentsForActor`-wrapped server fn definition itself, or a caller passing whatever filters it already did — no caller needs its own changes, since scoping is enforced server-side.

- [ ] **Step 5: Commit and open the PR**

```bash
git push -u origin codex/p0-hardening-fixes
```

---

## Acceptance: what "done" means

1. A Staff or Manager actor calling `listDocumentsForActor` with no filters sees only their own team's documents; an Admin actor sees the whole firm; a Client actor is unaffected (still company-scoped via `authorizeCompany`, as before).
2. A non-Admin session sees a denied state on `/admin`'s production console and on `/settings`; an Admin session sees the existing content on both, unchanged.
3. A non-Admin actor calling `dispatchDueNotificationsForActor` is rejected with a `Forbidden:` error and nothing is dispatched; an Admin actor's call still dispatches and is logged via `console.log`.
4. `getAnnualReturnDashboardMetricsForActor` has a real test that would fail if `caseFiltersForActor`'s scope were ever silently dropped — proven in Task 4 Step 1 by temporarily breaking it and watching the new test fail before restoring it.

## Out of scope

Per the design spec: a new firm-level audit table for P0-8 (deferred to P3-1), a server-side/route-level Admin guard mechanism for P0-7 (client-side gating judged proportionate), any UI affordance that calls `dispatchDueNotifications` (none exists today, none is being added), and every other roadmap item not named in this plan (P0-6, P0-11, P1-1, P1-3, etc.).
