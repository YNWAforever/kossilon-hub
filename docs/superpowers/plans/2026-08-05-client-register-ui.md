# Client Register UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `/clients` and `/clients/$id` back as production screens reading the Postgres client register, with role-gated writes and a Clients entry in navigation.

**Architecture:** Thin route files that hoist an `<Outlet />` guard above their hooks; the real screens live in `src/features/clients/components/production-*.tsx` and fetch through `useQuery` against existing server functions. Two new pure modules — role permissions and a URL filter sanitiser — carry the logic worth unit-testing. Permission enforcement is added to the server functions; the UI hides what the server would reject.

**Tech Stack:** TanStack Start/Router, TanStack Query 5, React 19, TypeScript, Vitest, `@testing-library/react`, Tailwind v4, shadcn/ui, `postgres` (postgres.js).

**Spec:** `docs/superpowers/specs/2026-08-05-client-register-ui-design.md`

**Depends on:** the client register data layer (branch `claude/client-register-data-layer`, PR #32). This plan assumes `src/features/clients/{types,errors,repository,server-fns}.ts` and `src/components/clients/{client-form-dialog,contact-form-dialog}.tsx` exist. Branch from that branch, not from `main`, until it merges.

---

## Environment rules (apply to every task)

- Do **NOT** run `npm install` or `bun install`. Dependencies resolve from the parent repo at `/Users/willylai/Documents/kossilon-hub/node_modules`. `npx tsc`, `npx vitest`, `npx eslint`, `npx prettier` all work as-is.
- Do **NOT** run `npm run lint` across the repo. Lint only the files you touch: `npx eslint <paths>`.
- Run `npx prettier --write` on files you change before committing.
- Stage files explicitly by name. Never `git add -A`.
- The database is the user's real development database. Integration tests clean up after themselves; do not add fixtures outside the existing UUID prefixes.

## File Structure

**Created:**

- `src/features/clients/permissions.ts` — pure role rules. No I/O.
- `src/features/clients/permissions.test.ts` — every role against every action.
- `src/features/clients/board-filters.ts` — URL search sanitiser. Pure.
- `src/features/clients/board-filters.test.ts`
- `src/features/clients/components/production-client-directory.tsx`
- `src/features/clients/components/production-client-directory.interaction.test.tsx`
- `src/features/clients/components/production-client-profile.tsx`
- `src/features/clients/components/production-client-profile.interaction.test.tsx`
- `src/routes/clients.tsx` — thin brancher + outlet guard.
- `src/routes/clients.$id.tsx` — thin brancher.

**Modified:**

- `src/features/clients/server-fns.ts` — resolve the full actor, assert the action.
- `src/components/clients/client-form-dialog.tsx` — `queryClient.invalidateQueries`, permission-aware controls.
- `src/components/clients/contact-form-dialog.tsx` — `queryClient.invalidateQueries`.
- `src/components/navigation.ts` — add the Clients entry.

The two pure modules are separate files because a route file cannot export a non-component without tripping react-refresh, and because they carry the only logic in this phase worth testing in isolation.

---

### Task 1: Client Permissions

**Files:**
- Create: `src/features/clients/permissions.test.ts`
- Create: `src/features/clients/permissions.ts`

Read `src/features/annual-return/permissions.ts` first — this mirrors its shape, especially the ordering of the inactive check relative to the Admin shortcut.

> **Correction found during execution.** Earlier drafts of Tasks 5 and 7 imported `useAuth`
> from `@/features/auth/auth-context`. That module is a demo-only stub with no provider
> mounted anywhere, so it throws "useAuth must be used within AuthProvider" at runtime.
> `__root.tsx` mounts `AuthProvider` from `@/features/auth/auth-context-neon`, and
> `work-queue.tsx` imports `useAuth` from there. Both route snippets now use
> `auth-context-neon`.

- [ ] **Step 1: Write the failing test**

Create `src/features/clients/permissions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { assertClientActionAllowed, canPerformClientAction, type ClientActor } from "./permissions";

function actor(overrides: Partial<ClientActor> = {}): ClientActor {
  return { userId: "20000000-0000-0000-0000-000000000001", role: "Staff", active: true, ...overrides };
}

describe("canPerformClientAction", () => {
  it("lets active staff view the register and edit details", () => {
    expect(canPerformClientAction(actor(), "view_register")).toBe(true);
    expect(canPerformClientAction(actor(), "edit_details")).toBe(true);
  });

  it("refuses staff the managed actions", () => {
    expect(canPerformClientAction(actor(), "create_client")).toBe(false);
    expect(canPerformClientAction(actor(), "deactivate_client")).toBe(false);
    expect(canPerformClientAction(actor(), "reassign_client")).toBe(false);
  });

  it("lets managers and admins perform the managed actions", () => {
    for (const role of ["Manager", "Admin"] as const) {
      expect(canPerformClientAction(actor({ role }), "create_client")).toBe(true);
      expect(canPerformClientAction(actor({ role }), "deactivate_client")).toBe(true);
      expect(canPerformClientAction(actor({ role }), "reassign_client")).toBe(true);
    }
  });

  it("refuses an inactive actor every action, including an admin", () => {
    for (const role of ["Staff", "Manager", "Admin"] as const) {
      expect(canPerformClientAction(actor({ role, active: false }), "view_register")).toBe(false);
      expect(canPerformClientAction(actor({ role, active: false }), "create_client")).toBe(false);
    }
  });

  it("refuses the Client role even when active", () => {
    expect(canPerformClientAction(actor({ role: "Client" }), "view_register")).toBe(false);
    expect(canPerformClientAction(actor({ role: "Client" }), "edit_details")).toBe(false);
  });

  it("refuses a staff role with no database identity", () => {
    expect(canPerformClientAction(actor({ userId: null }), "view_register")).toBe(false);
  });
});

describe("assertClientActionAllowed", () => {
  it("returns the actor when the action is allowed", () => {
    const allowed = actor({ role: "Manager" });
    expect(assertClientActionAllowed(allowed, "create_client")).toBe(allowed);
  });

  it("throws a Forbidden error naming the reason for an inactive actor", () => {
    expect(() => assertClientActionAllowed(actor({ active: false }), "view_register")).toThrow(
      "Forbidden: inactive users cannot access the client register.",
    );
  });

  it("throws a Forbidden error for a Client role", () => {
    expect(() => assertClientActionAllowed(actor({ role: "Client" }), "view_register")).toThrow(
      "Forbidden: staff access is required.",
    );
  });

  it("throws a Forbidden error naming the action a staff member may not perform", () => {
    expect(() => assertClientActionAllowed(actor(), "reassign_client")).toThrow(
      "Forbidden: reassign_client requires a Manager or an Admin.",
    );
  });

  it("throws when a staff actor has no database identity", () => {
    expect(() => assertClientActionAllowed(actor({ userId: null }), "edit_details")).toThrow(
      "Forbidden: a staff database identity is required.",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/clients/permissions.test.ts`
Expected: FAIL — cannot resolve `./permissions`.

- [ ] **Step 3: Write the implementation**

Create `src/features/clients/permissions.ts`:

```ts
import type { AuthRole } from "@/features/auth/types";

export type ClientAction =
  | "view_register"
  | "edit_details"
  | "create_client"
  | "deactivate_client"
  | "reassign_client";

export type ClientActor = {
  userId: string | null;
  role: AuthRole;
  active: boolean;
};

/** Actions that change assignment or lifecycle rather than servicing an account. */
const MANAGED_ACTIONS = new Set<ClientAction>([
  "create_client",
  "deactivate_client",
  "reassign_client",
]);

/**
 * The register is readable firm-wide by any active staff member — it is reference
 * data, and a system of record that hides most of the record cannot do its job.
 * Deliberately unlike caseFiltersForActor, which narrows reads by team and owner.
 * See docs/superpowers/specs/2026-08-05-client-register-ui-design.md.
 */
export function canPerformClientAction(actor: ClientActor, action: ClientAction): boolean {
  // Checked before the Admin shortcut, matching caseFiltersForActor: an inactive
  // admin is refused for being inactive, not admitted for being an admin.
  if (!actor.active) return false;
  if (actor.role !== "Admin" && actor.role !== "Manager" && actor.role !== "Staff") return false;
  if (!actor.userId) return false;
  if (MANAGED_ACTIONS.has(action)) return actor.role === "Admin" || actor.role === "Manager";

  return true;
}

export function assertClientActionAllowed(actor: ClientActor, action: ClientAction): ClientActor {
  if (!actor.active) {
    throw new Error("Forbidden: inactive users cannot access the client register.");
  }

  if (actor.role !== "Admin" && actor.role !== "Manager" && actor.role !== "Staff") {
    throw new Error("Forbidden: staff access is required.");
  }

  if (!actor.userId) {
    throw new Error("Forbidden: a staff database identity is required.");
  }

  if (MANAGED_ACTIONS.has(action) && actor.role === "Staff") {
    throw new Error(`Forbidden: ${action} requires a Manager or an Admin.`);
  }

  return actor;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/clients/permissions.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Verify and commit**

```bash
npx prettier --write src/features/clients/permissions.ts src/features/clients/permissions.test.ts
npx tsc --noEmit
npx eslint src/features/clients/permissions.ts src/features/clients/permissions.test.ts
git add src/features/clients/permissions.ts src/features/clients/permissions.test.ts
git commit -m "feat: add client register permissions"
```

`npx tsc --noEmit` reports pre-existing errors elsewhere in the repo (missing `@testing-library/react` and `@cloudflare/workers-types` types when `node_modules` is stale). Confirm none of them name a file you touched; that is the bar for every task in this plan.

---

### Task 2: Directory URL Filters

**Files:**
- Create: `src/features/clients/board-filters.test.ts`
- Create: `src/features/clients/board-filters.ts`

Read `src/features/annual-return/board-filters.ts` first. This follows it: an optional-everything search type, and a sanitiser that degrades bad input to defaults rather than throwing, because the input is a URL a user can type.

- [ ] **Step 1: Write the failing test**

Create `src/features/clients/board-filters.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { clientSearchFromUrl, type ClientRegisterSearch } from "./board-filters";

describe("clientSearchFromUrl", () => {
  it("defaults status to active when absent", () => {
    expect(clientSearchFromUrl({})).toEqual<ClientRegisterSearch>({
      q: undefined,
      packageName: undefined,
      teamName: undefined,
      status: "active",
    });
  });

  it("keeps recognised values", () => {
    expect(clientSearchFromUrl({ q: "harbour", packageName: "Standard", teamName: "Filing", status: "inactive" }))
      .toEqual<ClientRegisterSearch>({
        q: "harbour",
        packageName: "Standard",
        teamName: "Filing",
        status: "inactive",
      });
  });

  it("accepts the all status", () => {
    expect(clientSearchFromUrl({ status: "all" }).status).toBe("all");
  });

  it("degrades an unrecognised status to active rather than throwing", () => {
    expect(clientSearchFromUrl({ status: "banana" }).status).toBe("active");
  });

  it("drops empty and non-string filter values", () => {
    const search = clientSearchFromUrl({ q: "", packageName: 42, teamName: null });

    expect(search.q).toBeUndefined();
    expect(search.packageName).toBeUndefined();
    expect(search.teamName).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/clients/board-filters.test.ts`
Expected: FAIL — cannot resolve `./board-filters`.

- [ ] **Step 3: Write the implementation**

Create `src/features/clients/board-filters.ts`:

```ts
export type ClientStatusFilter = "active" | "inactive" | "all";

/**
 * The register's URL state. Filter fields are optional so an absent param and a
 * cleared filter are the same thing; status always resolves because the register
 * hides deactivated companies by default.
 */
export type ClientRegisterSearch = {
  q?: string;
  packageName?: string;
  teamName?: string;
  status: ClientStatusFilter;
};

const STATUS_FILTERS: readonly ClientStatusFilter[] = ["active", "inactive", "all"];

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Sanitises a user-editable URL. Anything unrecognised degrades to the default
 * rather than throwing — a typo in the address bar must not break the screen.
 */
export function clientSearchFromUrl(search: Record<string, unknown>): ClientRegisterSearch {
  const status = search.status as ClientStatusFilter;

  return {
    q: text(search.q),
    packageName: text(search.packageName),
    teamName: text(search.teamName),
    status: STATUS_FILTERS.includes(status) ? status : "active",
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/clients/board-filters.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
npx prettier --write src/features/clients/board-filters.ts src/features/clients/board-filters.test.ts
npx eslint src/features/clients/board-filters.ts src/features/clients/board-filters.test.ts
git add src/features/clients/board-filters.ts src/features/clients/board-filters.test.ts
git commit -m "feat: add client register url filters"
```

---

### Task 3: Enforce Permissions in the Server Functions

**Files:**
- Modify: `src/features/clients/server-fns.ts`

The server functions currently resolve only a `userId` and assert nothing about role. This task makes them resolve the full actor and assert the action.

- [ ] **Step 1: Replace the actor helper**

In `src/features/clients/server-fns.ts`, replace the import block and the `getCurrentClientActorId` helper with:

```ts
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireStaffActor, type AuthDependencies } from "@/features/auth/neon-auth-server";
import { assertClientActionAllowed, type ClientAction } from "./permissions";
import { createClientRepository } from "./repository";

/**
 * Resolves the acting staff member and asserts they may perform `action`, then
 * hands back the user id the repository attributes the write to. The repository
 * still runs its own active-user check — it must not trust its caller, and that
 * check also catches a user deactivated mid-session.
 */
async function actorIdFor(
  action: ClientAction,
  dependencies: AuthDependencies = {},
): Promise<string> {
  const actor = await requireStaffActor(getRequest(), dependencies);
  assertClientActionAllowed(
    { userId: actor.userId, role: actor.role, active: actor.active },
    action,
  );

  // assertClientActionAllowed throws when userId is null, so this is narrowing only.
  return actor.userId as string;
}
```

- [ ] **Step 2: Gate the reads**

Replace the three read server functions with:

```ts
export const listClients = createServerFn({ method: "GET" }).handler(async () => {
  await actorIdFor("view_register");
  return createClientRepository().listClients();
});

export const listClientAssignmentOptions = createServerFn({ method: "GET" }).handler(async () => {
  await actorIdFor("view_register");
  return createClientRepository().listAssignmentOptions();
});

export const getClient = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => {
    await actorIdFor("view_register");
    return createClientRepository().getClient(data.id);
  });
```

- [ ] **Step 3: Gate the writes**

Replace the five write server functions with:

```ts
export const createClient = createServerFn({ method: "POST" })
  .validator(createClientSchema)
  .handler(async ({ data }) =>
    createClientRepository().createClient({ ...data, actorId: await actorIdFor("create_client") }),
  );

export const updateClient = createServerFn({ method: "POST" })
  .validator(updateClientSchema)
  .handler(async ({ data }) => {
    // Reassignment and deactivation are managed actions; editing the rest is not.
    const current = await createClientRepository().getClient(data.id);

    if (!current) {
      throw new Error("Client not found.");
    }

    const reassigns = data.ownerId !== current.ownerId || data.teamId !== current.teamId;
    const deactivates = data.status !== current.status;
    const action: ClientAction = reassigns
      ? "reassign_client"
      : deactivates
        ? "deactivate_client"
        : "edit_details";

    return createClientRepository().updateClient({ ...data, actorId: await actorIdFor(action) });
  });

export const addClientContact = createServerFn({ method: "POST" })
  .validator(addContactSchema)
  .handler(async ({ data }) =>
    createClientRepository().addContact({ ...data, actorId: await actorIdFor("edit_details") }),
  );

export const updateClientContact = createServerFn({ method: "POST" })
  .validator(updateContactSchema)
  .handler(async ({ data }) =>
    createClientRepository().updateContact({ ...data, actorId: await actorIdFor("edit_details") }),
  );

export const removeClientContact = createServerFn({ method: "POST" })
  .validator(removeContactSchema)
  .handler(async ({ data }) =>
    createClientRepository().removeContact({ ...data, actorId: await actorIdFor("edit_details") }),
  );
```

`updateClient` reads the current row first so it can tell an ordinary detail edit from a reassignment or a deactivation. Without that read, a Staff member could reassign a company through the same endpoint they legitimately use to correct an address.

- [ ] **Step 4: Verify**

```bash
npx prettier --write src/features/clients/server-fns.ts
npx tsc --noEmit
npx eslint src/features/clients/server-fns.ts
npx vitest run src/features/clients
```

Expected: `tsc` reports nothing naming `server-fns.ts`; eslint clean; the existing repository suite still passes at 31/31.

- [ ] **Step 5: Commit**

```bash
git add src/features/clients/server-fns.ts
git commit -m "feat: enforce client register permissions in the server functions"
```

---

### Task 4: Production Client Directory

**Files:**
- Create: `src/features/clients/components/production-client-directory.tsx`

The interaction test comes in Task 5, once the component exists and can be rendered.

- [ ] **Step 1: Write the component**

Create `src/features/clients/components/production-client-directory.tsx`:

```tsx
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { listClients } from "../server-fns";
import type { ClientRegisterSearch } from "../board-filters";
import type { ClientSummary } from "../types";

export const CLIENT_REGISTER_QUERY_KEY = ["clients", "register"] as const;

type Props = {
  search: ClientRegisterSearch;
  onSearchChange: (next: ClientRegisterSearch) => void;
  canManage: boolean;
  onAddClient: () => void;
};

function paymentLabel(client: ClientSummary): string {
  return client.paymentStatus ?? "Not invoiced";
}

function paymentToneClass(client: ClientSummary): string {
  if (client.paymentStatus === "Payment received") return "text-status-green";
  if (client.paymentStatus === "Overdue") return "text-status-red";
  if (client.paymentStatus === "Payment pending") return "text-status-yellow";
  return "text-muted-foreground";
}

export function ProductionClientDirectory({
  search,
  onSearchChange,
  canManage,
  onAddClient,
}: Props) {
  const clientsQuery = useQuery({
    queryKey: CLIENT_REGISTER_QUERY_KEY,
    queryFn: () => listClients(),
  });

  const clients = useMemo(() => clientsQuery.data ?? [], [clientsQuery.data]);

  const packageNames = useMemo(
    () =>
      Array.from(
        new Set(clients.map((c) => c.packageName).filter((n): n is string => Boolean(n))),
      ).sort(),
    [clients],
  );

  const teamNames = useMemo(
    () => Array.from(new Set(clients.map((c) => c.teamName))).sort(),
    [clients],
  );

  const visible = useMemo(() => {
    const query = search.q?.trim().toLowerCase() ?? "";

    return clients.filter((client) => {
      if (search.status !== "all" && client.status !== search.status) return false;
      if (search.packageName && client.packageName !== search.packageName) return false;
      if (search.teamName && client.teamName !== search.teamName) return false;
      if (!query) return true;

      return (
        client.companyName.toLowerCase().includes(query) ||
        client.crNumber.toLowerCase().includes(query) ||
        client.brNumber.toLowerCase().includes(query) ||
        client.ownerName.toLowerCase().includes(query)
      );
    });
  }, [clients, search]);

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title="Clients"
        subtitle={
          clientsQuery.isError
            ? "Register unavailable"
            : `${visible.length} of ${clients.length} companies under management`
        }
        actions={
          canManage ? (
            <button
              onClick={onAddClient}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" /> Add client
            </button>
          ) : undefined
        }
      />

      <main className="flex-1 p-6">
        {clientsQuery.isError ? (
          <div className="rounded-xl border bg-card p-10 text-center">
            <p className="text-sm font-medium">The client register is temporarily unavailable.</p>
            <p className="mt-1 text-xs text-muted-foreground">
              No clients were changed. Retry when the connection recovers.
            </p>
            <button
              onClick={() => void clientsQuery.refetch()}
              className="mt-4 rounded-md border px-3 py-2 text-sm font-medium"
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="rounded-xl border bg-card">
            <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
              <input
                aria-label="Search clients"
                placeholder="Search clients…"
                value={search.q ?? ""}
                onChange={(event) => onSearchChange({ ...search, q: event.target.value || undefined })}
                className="min-w-40 flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none"
              />
              <select
                aria-label="Filter by package"
                value={search.packageName ?? "all"}
                onChange={(event) =>
                  onSearchChange({
                    ...search,
                    packageName: event.target.value === "all" ? undefined : event.target.value,
                  })
                }
                className="rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="all">All packages</option>
                {packageNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter by team"
                value={search.teamName ?? "all"}
                onChange={(event) =>
                  onSearchChange({
                    ...search,
                    teamName: event.target.value === "all" ? undefined : event.target.value,
                  })
                }
                className="rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="all">All teams</option>
                {teamNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
              <select
                aria-label="Filter by status"
                value={search.status}
                onChange={(event) =>
                  onSearchChange({
                    ...search,
                    status: event.target.value as ClientRegisterSearch["status"],
                  })
                }
                className="rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
                <option value="all">All statuses</option>
              </select>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 font-medium">Company</th>
                    <th className="px-5 py-3 font-medium">BR / CR</th>
                    <th className="px-5 py-3 font-medium">Package</th>
                    <th className="px-5 py-3 font-medium">AR deadline</th>
                    <th className="px-5 py-3 font-medium">Payment</th>
                    <th className="px-5 py-3 font-medium">Owner</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {visible.map((client) => (
                    <tr key={client.id} className="hover:bg-muted/30">
                      <td className="px-5 py-3">
                        <Link
                          to="/clients/$id"
                          params={{ id: client.id }}
                          className="font-medium hover:text-primary"
                        >
                          {client.companyName}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          {client.teamName}
                          {client.status === "inactive" ? " · Inactive" : ""}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-xs tabular-nums text-muted-foreground">
                        BR {client.brNumber}
                        <br />
                        CR {client.crNumber}
                      </td>
                      <td className="px-5 py-3">{client.packageName ?? "—"}</td>
                      <td className="px-5 py-3">
                        {client.arDueDate ?? (
                          <span className="text-muted-foreground">No case</span>
                        )}
                      </td>
                      <td className={`px-5 py-3 ${paymentToneClass(client)}`}>
                        {paymentLabel(client)}
                      </td>
                      <td className="px-5 py-3">{client.ownerName}</td>
                    </tr>
                  ))}
                  {visible.length === 0 && !clientsQuery.isPending && (
                    <tr>
                      <td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">
                        No clients match the current filters.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
    </>
  );
}
```

The "No case" cell is the point of this screen: those companies appear on no board and in no queue, so the cell must read as a real state rather than missing data.

- [ ] **Step 2: Verify and commit**

```bash
npx prettier --write src/features/clients/components/production-client-directory.tsx
npx tsc --noEmit
npx eslint src/features/clients/components/production-client-directory.tsx
git add src/features/clients/components/production-client-directory.tsx
git commit -m "feat: add the production client directory"
```

---

### Task 5: Client Directory Route and Interaction Test

**Files:**
- Create: `src/routes/clients.tsx`
- Create: `src/features/clients/components/production-client-directory.interaction.test.tsx`

- [ ] **Step 1: Write the route**

Create `src/routes/clients.tsx`:

```tsx
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";

import { useAuth } from "@/features/auth/auth-context-neon";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { ProductionClientDirectory } from "@/features/clients/components/production-client-directory";
import { clientSearchFromUrl } from "@/features/clients/board-filters";

export const Route = createFileRoute("/clients")({
  // Filters live in the URL so they survive a reload and a return from a profile.
  // The sanitiser is in board-filters.ts so it can be unit-tested; a route file
  // cannot export a non-component without tripping react-refresh.
  validateSearch: clientSearchFromUrl,
  component: ClientsRoute,
});

function ClientsRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);

  // Hoisted above the branch. /clients/$id is a child route and renders only
  // through this outlet, so anything placed before it would silently stop the
  // profile rendering — which is exactly what happened on the first attempt.
  if (pathname !== "/clients") {
    return <Outlet />;
  }

  const canManage = session?.role === "Admin" || session?.role === "Manager";

  return (
    <>
      <ProductionClientDirectory
        search={search}
        onSearchChange={(next) => void navigate({ search: next, replace: true })}
        canManage={canManage}
        onAddClient={() => setAddOpen(true)}
      />
      <ClientFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        canManage={canManage}
        onSaved={() => void queryClient.invalidateQueries({ queryKey: ["clients"] })}
      />
    </>
  );
}
```

`ClientFormDialog`'s `options` prop is removed in Task 8; it fetches its own assignment options.

- [ ] **Step 2: Write the interaction test**

Create `src/features/clients/components/production-client-directory.interaction.test.tsx`:

```tsx
// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const serverFns = vi.hoisted(() => ({ listClients: vi.fn() }));

vi.mock("../server-fns", () => ({ listClients: serverFns.listClients }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));

import { ProductionClientDirectory } from "./production-client-directory";
import type { ClientRegisterSearch } from "../board-filters";
import type { ClientSummary } from "../types";

function client(overrides: Partial<ClientSummary> = {}): ClientSummary {
  return {
    id: "97000000-0000-0000-0000-000000000001",
    companyName: "Harbour Trading Ltd",
    crNumber: "1200001",
    brNumber: "60000001",
    status: "active",
    packageId: "30000000-0000-0000-0000-000000000002",
    packageName: "Standard",
    ownerId: "20000000-0000-0000-0000-000000000001",
    ownerName: "Amy Chan",
    ownerInitials: "AC",
    teamId: "10000000-0000-0000-0000-000000000001",
    teamName: "Annual Return Control",
    arDueDate: "2026-08-12",
    paymentStatus: "Payment pending",
    invoiceAmount: 3800,
    ...overrides,
  };
}

const defaultSearch: ClientRegisterSearch = { status: "active" };

function renderDirectory(props: Partial<Parameters<typeof ProductionClientDirectory>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={queryClient}>
      <ProductionClientDirectory
        search={defaultSearch}
        onSearchChange={() => {}}
        canManage={false}
        onAddClient={() => {}}
        {...props}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProductionClientDirectory", () => {
  it("renders a company with no annual return case as 'No case'", async () => {
    serverFns.listClients.mockResolvedValue([
      client({ companyName: "Dormant Holdings Ltd", arDueDate: null, paymentStatus: null, invoiceAmount: null }),
    ]);

    renderDirectory();

    expect(await screen.findByText("Dormant Holdings Ltd")).toBeTruthy();
    expect(screen.getByText("No case")).toBeTruthy();
    expect(screen.getByText("Not invoiced")).toBeTruthy();
  });

  it("narrows the list by the status filter", async () => {
    serverFns.listClients.mockResolvedValue([
      client(),
      client({ id: "97000000-0000-0000-0000-000000000002", companyName: "Retired Ltd", status: "inactive" }),
    ]);

    renderDirectory();

    expect(await screen.findByText("Harbour Trading Ltd")).toBeTruthy();
    expect(screen.queryByText("Retired Ltd")).toBeNull();
  });

  it("narrows the list by the search term", async () => {
    serverFns.listClients.mockResolvedValue([
      client(),
      client({ id: "97000000-0000-0000-0000-000000000003", companyName: "Kowloon Textiles Ltd" }),
    ]);

    renderDirectory({ search: { status: "active", q: "kowloon" } });

    expect(await screen.findByText("Kowloon Textiles Ltd")).toBeTruthy();
    expect(screen.queryByText("Harbour Trading Ltd")).toBeNull();
  });

  it("offers a retry instead of an empty table when the query fails", async () => {
    serverFns.listClients.mockRejectedValue(new Error("connection lost"));

    renderDirectory();

    expect(await screen.findByText("The client register is temporarily unavailable.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText("No clients match the current filters.")).toBeNull();
  });

  it("hides Add client from a staff member and shows it to a manager", async () => {
    serverFns.listClients.mockResolvedValue([client()]);

    const { unmount } = renderDirectory({ canManage: false });
    await waitFor(() => expect(screen.getByText("Harbour Trading Ltd")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Add client/ })).toBeNull();
    unmount();

    renderDirectory({ canManage: true });
    await waitFor(() => expect(screen.getByText("Harbour Trading Ltd")).toBeTruthy());
    expect(screen.getByRole("button", { name: /Add client/ })).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/features/clients/components/production-client-directory.interaction.test.tsx`
Expected: PASS, 5 tests.

If `@testing-library/react` cannot be resolved, the shared `node_modules` is stale relative to `main`'s `package.json`. Report that rather than running an install — several other suites in the repo depend on it and an install here would change the shared environment.

- [ ] **Step 4: Commit**

```bash
npx prettier --write src/routes/clients.tsx src/features/clients/components/production-client-directory.interaction.test.tsx
npx tsc --noEmit
npx eslint src/routes/clients.tsx src/features/clients/components/production-client-directory.interaction.test.tsx
git add src/routes/clients.tsx src/features/clients/components/production-client-directory.interaction.test.tsx
git commit -m "feat: add the client directory route"
```

`src/routeTree.gen.ts` regenerates when the dev server or build runs. If it changes, commit it separately with `chore: regenerate the route tree`; never hand-edit it.

---

### Task 6: Production Client Profile

**Files:**
- Create: `src/features/clients/components/production-client-profile.tsx`

- [ ] **Step 1: Write the component**

Create `src/features/clients/components/production-client-profile.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { getClient } from "../server-fns";
import type { ClientDetail, CompanyContact } from "../types";

type Props = {
  clientId: string;
  onEditClient: (client: ClientDetail) => void;
  onAddContact: () => void;
  onEditContact: (contact: CompanyContact) => void;
  onRemoveContact: (contact: CompanyContact) => void;
  removingContactId: string | null;
};

export function clientProfileQueryKey(clientId: string) {
  return ["clients", "profile", clientId] as const;
}

export function ProductionClientProfile({
  clientId,
  onEditClient,
  onAddContact,
  onEditContact,
  onRemoveContact,
  removingContactId,
}: Props) {
  const clientQuery = useQuery({
    queryKey: clientProfileQueryKey(clientId),
    queryFn: () => getClient({ data: { id: clientId } }),
  });

  if (clientQuery.isError) {
    return (
      <>
        <PageHeader eyebrow="Operations" title="Client" subtitle="Unavailable" />
        <main className="flex-1 p-6">
          <div className="rounded-xl border bg-card p-10 text-center">
            <p className="text-sm font-medium">This client is temporarily unavailable.</p>
            <button
              onClick={() => void clientQuery.refetch()}
              className="mt-4 rounded-md border px-3 py-2 text-sm font-medium"
            >
              Retry
            </button>
          </div>
        </main>
      </>
    );
  }

  const client = clientQuery.data;

  if (!clientQuery.isPending && !client) {
    return (
      <>
        <PageHeader eyebrow="Operations" title="Client not found" />
        <main className="flex-1 p-6">
          <p className="text-sm text-muted-foreground">
            No client exists with that id.{" "}
            <Link to="/clients" className="text-primary underline">
              Back to the register
            </Link>
          </p>
        </main>
      </>
    );
  }

  if (!client) {
    return (
      <>
        <PageHeader eyebrow="Operations" title="Client" />
        <main className="flex-1 p-6 text-sm text-muted-foreground">Loading…</main>
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="Operations"
        title={client.companyName}
        subtitle={`BR ${client.brNumber} · CR ${client.crNumber} · ${client.packageName ?? "No package"} · ${client.teamName}${client.status === "inactive" ? " · Inactive" : ""}`}
        actions={
          <button
            onClick={() => onEditClient(client)}
            className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted/50"
          >
            Edit client
          </button>
        }
      />

      <main className="grid flex-1 grid-cols-1 gap-6 p-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-xl border bg-card p-5">
            <dl className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
              <Field label="AR deadline" value={client.arDueDate ?? "No case"} />
              <Field label="Owner" value={client.ownerName} />
              <Field
                label="Invoice"
                value={
                  client.invoiceAmount === null
                    ? "—"
                    : `HKD ${client.invoiceAmount.toLocaleString()}`
                }
              />
              <Field label="Payment" value={client.paymentStatus ?? "Not invoiced"} />
              <Field label="Registered office" value={client.registeredOffice} />
              <Field label="Company secretary" value={client.companySecretary} />
              <Field label="Incorporated" value={client.incorporationDate} />
              <Field label="AR basis date" value={client.annualReturnBasisDate} />
            </dl>
          </section>

          <section className="rounded-xl border bg-card">
            <div className="flex items-center justify-between border-b px-5 py-3">
              <h2 className="font-semibold">Contacts</h2>
              <button
                onClick={onAddContact}
                className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted/50"
              >
                <Plus className="h-3 w-3" /> Add contact
              </button>
            </div>
            <ul className="divide-y">
              {client.contacts.map((contact) => (
                <li key={contact.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <div>
                    <p className="font-medium">
                      {contact.name}
                      {contact.isPrimary && (
                        <span className="ml-2 text-[10px] uppercase tracking-wider text-primary">
                          Primary
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{contact.role}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                    {contact.email && <span>{contact.email}</span>}
                    {contact.phone && <span>{contact.phone}</span>}
                    <button onClick={() => onEditContact(contact)} className="text-primary hover:underline">
                      Edit
                    </button>
                    <button
                      onClick={() => onRemoveContact(contact)}
                      disabled={removingContactId === contact.id}
                      className="text-destructive hover:underline disabled:opacity-60"
                    >
                      {removingContactId === contact.id ? "Removing…" : "Remove"}
                    </button>
                  </div>
                </li>
              ))}
              {client.contacts.length === 0 && (
                <li className="px-5 py-6 text-center text-sm text-muted-foreground">
                  No contacts recorded for this company.
                </li>
              )}
            </ul>
          </section>

          <section className="rounded-xl border bg-card">
            <div className="border-b px-5 py-3">
              <h2 className="font-semibold">Annual return history</h2>
            </div>
            <ul className="divide-y">
              {client.annualReturnHistory.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <div>
                    <p className="font-medium">{entry.filingDueDate}</p>
                    <p className="text-xs text-muted-foreground">
                      {entry.returnYear} · made up {entry.madeUpDate} · {entry.currentStatus}
                    </p>
                  </div>
                  <Link
                    to="/annual-returns/$id"
                    params={{ id: entry.id }}
                    className="text-xs text-primary hover:underline"
                  >
                    Open case
                  </Link>
                </li>
              ))}
              {client.annualReturnHistory.length === 0 && (
                <li className="px-5 py-6 text-center text-sm text-muted-foreground">
                  No annual return cases yet.
                </li>
              )}
            </ul>
          </section>

          <section className="rounded-xl border bg-card">
            <div className="border-b px-5 py-3">
              <h2 className="font-semibold">Documents</h2>
            </div>
            <ul className="divide-y">
              {client.documents.slice(0, 8).map((document) => (
                <li key={document.id} className="flex items-center justify-between px-5 py-3 text-sm">
                  <span className="truncate">{document.fileName}</span>
                  <span className="text-xs text-muted-foreground">{document.verificationStatus}</span>
                </li>
              ))}
              {client.documents.length === 0 && (
                <li className="px-5 py-6 text-center text-sm text-muted-foreground">
                  No documents uploaded.
                </li>
              )}
            </ul>
          </section>
        </div>

        <section className="rounded-xl border bg-card">
          <div className="border-b px-5 py-3">
            <h2 className="font-semibold">Company timeline</h2>
          </div>
          <ul className="divide-y">
            {client.timeline.map((entry) => (
              <li key={entry.id} className="px-5 py-3">
                <p className="text-sm">{entry.description}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  {entry.createdAt} · {entry.actorName ?? (entry.actorType === "system" ? "System" : "Unknown")}
                </p>
              </li>
            ))}
            {client.timeline.length === 0 && (
              <li className="px-5 py-6 text-center text-sm text-muted-foreground">
                No activity recorded yet.
              </li>
            )}
          </ul>
        </section>
      </main>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-medium">{value}</dd>
    </div>
  );
}
```

The profile takes no `canManage` prop: it shows the same panels to everyone, matching the firm-wide read decision, and the route owns the dialogs that do need the role. Adding an unused prop would fail the unused-vars rule `main` turned on in `20d1ee0`.

- [ ] **Step 2: Verify and commit**

```bash
npx prettier --write src/features/clients/components/production-client-profile.tsx
npx tsc --noEmit
npx eslint src/features/clients/components/production-client-profile.tsx
git add src/features/clients/components/production-client-profile.tsx
git commit -m "feat: add the production client profile"
```

---

### Task 7: Client Profile Route and Interaction Test

**Files:**
- Create: `src/routes/clients.$id.tsx`
- Create: `src/features/clients/components/production-client-profile.interaction.test.tsx`

Note the `$` in the route filename — quote the path in every shell command.

- [ ] **Step 1: Write the route**

Create `src/routes/clients.$id.tsx`:

```tsx
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";

import { useAuth } from "@/features/auth/auth-context-neon";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { ContactFormDialog } from "@/components/clients/contact-form-dialog";
import { ProductionClientProfile } from "@/features/clients/components/production-client-profile";
import { removeClientContact } from "@/features/clients/server-fns";
import type { ClientDetail, CompanyContact } from "@/features/clients/types";

export const Route = createFileRoute("/clients/$id")({
  component: ClientProfileRoute,
});

function ClientProfileRoute() {
  const { id } = Route.useParams();
  const { session } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<ClientDetail | null>(null);
  const [contactOpen, setContactOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<CompanyContact | undefined>(undefined);
  const [removingContactId, setRemovingContactId] = useState<string | null>(null);

  const canManage = session?.role === "Admin" || session?.role === "Manager";
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["clients"] });

  async function handleRemoveContact(contact: CompanyContact) {
    setRemovingContactId(contact.id);

    try {
      await removeClientContact({ data: { companyId: id, contactId: contact.id } });
      toast.success("Contact removed.");
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to remove the contact.");
    } finally {
      setRemovingContactId(null);
    }
  }

  return (
    <>
      <ProductionClientProfile
        clientId={id}
        onEditClient={setEditing}
        onAddContact={() => {
          setEditingContact(undefined);
          setContactOpen(true);
        }}
        onEditContact={(contact) => {
          setEditingContact(contact);
          setContactOpen(true);
        }}
        onRemoveContact={(contact) => void handleRemoveContact(contact)}
        removingContactId={removingContactId}
      />

      <ClientFormDialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        client={editing ?? undefined}
        canManage={canManage}
        onSaved={refresh}
      />

      <ContactFormDialog
        open={contactOpen}
        onOpenChange={setContactOpen}
        companyId={id}
        contact={editingContact}
        onSaved={refresh}
      />
    </>
  );
}
```

- [ ] **Step 2: Write the interaction test**

Create `src/features/clients/components/production-client-profile.interaction.test.tsx`:

```tsx
// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const serverFns = vi.hoisted(() => ({ getClient: vi.fn() }));

vi.mock("../server-fns", () => ({ getClient: serverFns.getClient }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));

import { ProductionClientProfile } from "./production-client-profile";
import type { ClientDetail } from "../types";

function detail(overrides: Partial<ClientDetail> = {}): ClientDetail {
  return {
    id: "97000000-0000-0000-0000-000000000001",
    companyName: "Harbour Trading Ltd",
    crNumber: "1200001",
    brNumber: "60000001",
    status: "active",
    packageId: "30000000-0000-0000-0000-000000000002",
    packageName: "Standard",
    ownerId: "20000000-0000-0000-0000-000000000001",
    ownerName: "Amy Chan",
    ownerInitials: "AC",
    teamId: "10000000-0000-0000-0000-000000000001",
    teamName: "Annual Return Control",
    arDueDate: "2026-08-12",
    paymentStatus: "Payment pending",
    invoiceAmount: 3800,
    incorporationDate: "2021-07-01",
    annualReturnBasisDate: "2026-07-01",
    registeredOffice: "Room 1201, Central Plaza",
    companySecretary: "Kossilon Corporate Services Limited",
    contacts: [
      {
        id: "97300000-0000-0000-0000-000000000002",
        companyId: "97000000-0000-0000-0000-000000000001",
        name: "Zoe Ng",
        role: "Accountant",
        email: "zoe@example.hk",
        phone: null,
        isPrimary: false,
      },
      {
        id: "97300000-0000-0000-0000-000000000001",
        companyId: "97000000-0000-0000-0000-000000000001",
        name: "Alan Ho",
        role: "Director",
        email: null,
        phone: "+85290000001",
        isPrimary: true,
      },
    ],
    timeline: [],
    annualReturnHistory: [],
    documents: [],
    ...overrides,
  };
}

function renderProfile(props: Partial<Parameters<typeof ProductionClientProfile>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={queryClient}>
      <ProductionClientProfile
        clientId="97000000-0000-0000-0000-000000000001"
        onEditClient={() => {}}
        onAddContact={() => {}}
        onEditContact={() => {}}
        onRemoveContact={() => {}}
        removingContactId={null}
        {...props}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProductionClientProfile", () => {
  it("marks the primary contact", async () => {
    serverFns.getClient.mockResolvedValue(detail());

    renderProfile();

    expect(await screen.findByText("Alan Ho")).toBeTruthy();
    expect(screen.getByText("Primary")).toBeTruthy();
  });

  it("shows a company with no case and no contacts without looking broken", async () => {
    serverFns.getClient.mockResolvedValue(
      detail({ arDueDate: null, paymentStatus: null, invoiceAmount: null, contacts: [] }),
    );

    renderProfile();

    expect(await screen.findByText("No contacts recorded for this company.")).toBeTruthy();
    expect(screen.getByText("No case")).toBeTruthy();
    expect(screen.getByText("Not invoiced")).toBeTruthy();
  });

  it("renders a not-found state for an unknown id", async () => {
    serverFns.getClient.mockResolvedValue(null);

    renderProfile();

    expect(await screen.findByText("Client not found")).toBeTruthy();
  });

  it("offers a retry when the query fails", async () => {
    serverFns.getClient.mockRejectedValue(new Error("connection lost"));

    renderProfile();

    expect(await screen.findByText("This client is temporarily unavailable.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("shows contact controls to any staff member", async () => {
    serverFns.getClient.mockResolvedValue(detail());

    renderProfile();

    expect(await screen.findByRole("button", { name: /Add contact/ })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Remove" }).length).toBe(2);
  });
});
```

- [ ] **Step 3: Run the tests**

Run: `npx vitest run src/features/clients/components/production-client-profile.interaction.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 4: Commit**

```bash
npx prettier --write 'src/routes/clients.$id.tsx' src/features/clients/components/production-client-profile.interaction.test.tsx
npx tsc --noEmit
npx eslint 'src/routes/clients.$id.tsx' src/features/clients/components/production-client-profile.interaction.test.tsx
git add 'src/routes/clients.$id.tsx' src/features/clients/components/production-client-profile.interaction.test.tsx
git commit -m "feat: add the client profile route"
```

---

### Task 8: Adapt the Dialogs

**Files:**
- Modify: `src/components/clients/client-form-dialog.tsx`
- Modify: `src/components/clients/contact-form-dialog.tsx`

Both dialogs exist but are unused: they were written against a loader-based route and a props-supplied `options`. Three changes.

- [ ] **Step 1: Replace the ClientFormDialog props and options source**

In `src/components/clients/client-form-dialog.tsx`:

Replace the `Props` type with:

```tsx
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Omit to create a new client; supply to edit an existing one. */
  client?: ClientDetail;
  /** Admin or Manager. Gates the owner, team, and status controls. */
  canManage: boolean;
  onSaved: (clientId: string) => void;
};
```

Remove `options` from the destructured parameters and add, immediately inside the component:

```tsx
  const optionsQuery = useQuery({
    queryKey: ["clients", "assignment-options"],
    queryFn: () => listClientAssignmentOptions(),
    enabled: open,
  });
  const options = optionsQuery.data ?? { owners: [], teams: [], packages: [] };
```

Add to the imports:

```tsx
import { useQuery } from "@tanstack/react-query";
import { listClientAssignmentOptions } from "@/features/clients/server-fns";
```

Remove `ClientAssignmentOptions` from the type imports if it becomes unused — `npx eslint` will name it.

- [ ] **Step 2: Gate the managed controls**

In the same file, wrap the owner and team `<div>` blocks and the status `<div>` block so they render only for a manager. The owner and team selects sit inside the three-column grid; wrap that grid's owner and team children:

```tsx
{canManage && (
  <div>
    <label className={labelClass} htmlFor="client-owner">
      Owner
    </label>
    <select
      id="client-owner"
      className={inputClass}
      value={form.ownerId}
      onChange={(event) => set("ownerId", event.target.value)}
    >
      {ownerOptions.map((owner) => (
        <option key={owner.id} value={owner.id}>
          {owner.name}
        </option>
      ))}
    </select>
  </div>
)}
```

Apply the same `{canManage && ( … )}` wrapper to the team block and to the `isEdit` status block. Leave the package select ungated — `edit_details` covers it.

- [ ] **Step 3: Verify both dialogs no longer call router.invalidate**

Run: `grep -n "router.invalidate\|useRouter" src/components/clients/*.tsx`
Expected: no output. Both dialogs report success through their `onSaved` callback, and the routes from Tasks 5 and 7 call `queryClient.invalidateQueries`. If either dialog still imports `useRouter`, remove the import and the call — the route owns refreshing now.

- [ ] **Step 4: Verify and commit**

```bash
npx prettier --write src/components/clients/client-form-dialog.tsx src/components/clients/contact-form-dialog.tsx
npx tsc --noEmit
npx eslint src/components/clients
git add src/components/clients/client-form-dialog.tsx src/components/clients/contact-form-dialog.tsx
git commit -m "refactor: adapt the client dialogs to query invalidation and roles"
```

---

### Task 9: Navigation Entry

**Files:**
- Modify: `src/components/navigation.ts`

- [ ] **Step 1: Add the entry**

In `src/components/navigation.ts`, add `Building2` to the `lucide-react` import list, and add this item to the `Operations` group immediately after the Dashboard entry:

```ts
      { to: "/clients", label: "Clients", icon: Building2 },
```

- [ ] **Step 2: Update the policy comment**

The comment above `navGroups` lists `/clients` and `/clients/$id` among the deleted screens. That is now wrong. Replace the sentence:

```
// /clients, /clients/$id, /enquiries, /teams and /tasks were deleted, not
// parked. Each was either superseded by a screen already reading Postgres
// (/work-queue, /annual-returns) or had no table behind it. Adding an entry
// here means the screen reads live data — there is no fixture-backed tier.
```

with:

```
// /enquiries, /teams and /tasks were deleted, not parked. Each was either
// superseded by a screen already reading Postgres (/work-queue,
// /annual-returns) or had no table behind it. Adding an entry here means the
// screen reads live data — there is no fixture-backed tier.
//
// /clients and /clients/$id were deleted alongside them and returned once the
// register read Postgres, which is the bar this comment sets.
```

Leaving the old text would tell the next reader that a screen in the navigation does not exist.

- [ ] **Step 3: Verify and commit**

```bash
npx prettier --write src/components/navigation.ts
npx tsc --noEmit
npx eslint src/components/navigation.ts
npx vitest run src/components src/features/clients
git add src/components/navigation.ts
git commit -m "feat: add the clients destination to navigation"
```

Expected: the navigation and page-header convention suites still pass, and the client suites pass.

---

### Task 10: Full Verification

**Files:** none.

- [ ] **Step 1: Run the whole suite**

Run: `npm run test`
Expected: all suites pass. Record the counts.

If any suite fails, determine whether it is caused by this work before fixing. Suites unrelated to the client register that fail identically on `main` are out of scope; say so rather than fixing them here.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Confirm the demo-mode behaviour**

`/clients` has no demo branch, following `/work-queue`. Before checking the list below,
open `/work-queue` with `VITE_ENABLE_DEMO_AUTH=true` and observe what it actually does —
whether it renders its unavailable state, redirects, or something else. Then confirm
`/clients` behaves the same way. Match `/work-queue` exactly rather than inventing a third
pattern, and report what you found if it differs from the spec's expectation.

- [ ] **Step 4: Manual verification**

Start the dev server through the preview tooling rather than a raw shell command, then confirm each of these and report any that fail rather than marking the task complete:

- [ ] `/clients` lists companies with real packages, owners, deadlines, and payment status.
- [ ] A company with no annual-return case shows "No case", not a blank cell.
- [ ] Typing in the search box narrows by name, CR, BR, and owner; the term appears in the URL and survives a reload.
- [ ] The package, team, and status filters each narrow the list and persist in the URL.
- [ ] Navigating into a profile and back preserves the filters.
- [ ] `/clients/$id` renders the profile, **not** the directory. This is the regression that the hoisted outlet guard exists to prevent.
- [ ] Contacts add, edit, promote-to-primary, and remove all work without a page reload, and each writes a company timeline entry naming the actor.
- [ ] An unknown client id shows the not-found state.
- [ ] The Clients entry appears in the sidebar and the mobile drawer.
- [ ] `/annual-returns`, `/work-queue`, and `/` still work.

- [ ] **Step 5: Commit any fixes**

If a check fails, fix it, re-run `npx tsc --noEmit` and the client suites, and commit with a `fix:` message.

---

## Notes for the Implementer

- **The outlet guard in `src/routes/clients.tsx` must stay above the branch and above any added hooks.** `/clients/$id` renders only through it. On the previous attempt this guard sat after the hooks and the directory rendered in place of the profile — a bug that passed both a spec review and a code-quality review and was found only by opening the page.
- **Do not narrow the register by team or owner.** It is deliberately firm-wide for active staff, unlike `caseFiltersForActor`. The reasoning is in the spec under "The deliberate deviation on read scope"; if you disagree, raise it rather than quietly scoping the query.
- **Do not add a delete-client operation.** `annual_return_cases`, `documents`, `payments`, and `timeline_events` cascade on `company_id`, so deleting a company destroys its filing history. Deactivation via `status` is the intended path.
- **Hide controls rather than disabling them.** A disabled button still advertises an action the server will refuse.
- **`npx tsc --noEmit` has pre-existing errors** elsewhere in the repo when the shared `node_modules` is stale. The bar for every task is that no reported error names a file you touched.
