# Client Register UI (P1-3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the already-built client register data layer (repository, server fns,
authorization, both form dialogs) reachable from the UI by adding `/clients` and
`/clients/$id` routes and restoring the navigation entry.

**Architecture:** Two new route files (`clients.tsx`, `clients.$id.tsx`) each branch on
`dataMode` exactly like `annual-returns.tsx` / `annual-returns.$id.tsx` do: production
renders a new `Production*` component that owns its own TanStack Query wiring against the
already-existing `clients` server fns; demo renders a shared `DemoClientNotice` component,
since this feature has no fixture-backed tier by design.

**Tech Stack:** TanStack Router (file-based routes) · TanStack Query 5 · React 19 ·
TypeScript 5.8 strict · Vitest 4 + Testing Library · Tailwind utility classes (no new UI
library) — all matching the existing `annual-return` feature's screens, which this plan
copies the shape of.

**Reference files** (read, not modified, by every task below):
- `src/features/clients/types.ts` — `ClientSummary`, `ClientDetail`, `ClientAssignmentOptions`,
  `CompanyContact`, `CompanyStatus`, `ClientPaymentStatus`.
- `src/features/clients/server-fns.ts` — `listClients`, `getClient`, `listAssignmentOptions`,
  `removeClientContact` (all already implemented; called, never edited, by this plan).
- `src/components/clients/client-form-dialog.tsx` — `ClientFormDialog`, props
  `{ open, onOpenChange, options: ClientAssignmentOptions, client?: ClientDetail, onSaved:
  (clientId: string) => void }`.
- `src/components/clients/contact-form-dialog.tsx` — `ContactFormDialog`, props
  `{ open, onOpenChange, companyId: string, contact?: CompanyContact, onSaved: () => void }`.
- `src/lib/status.ts` — `StatusTone` and `toneClasses`, consumed via `<StatusPill>`.
- `src/components/status-pill.tsx` — `<StatusPill tone={...}>{children}</StatusPill>`.

---

### Task 1: Demo-mode notice component

**Files:**
- Create: `src/features/clients/components/demo-client-notice.tsx`
- Test: `src/features/clients/components/demo-client-notice.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DemoClientNotice } from "./demo-client-notice";

describe("DemoClientNotice", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders a register-specific message and a PageHeader h1", () => {
    render(<DemoClientNotice variant="register" />);

    expect(screen.getByRole("heading", { level: 1, name: "Clients" })).toBeTruthy();
    expect(screen.getByText(/no demo fixtures/i)).toBeTruthy();
  });

  it("renders a detail-specific message", () => {
    render(<DemoClientNotice variant="detail" />);

    expect(screen.getByRole("heading", { level: 1, name: "Client" })).toBeTruthy();
    expect(screen.getByText(/no demo fixtures/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm run test -- src/features/clients/components/demo-client-notice.test.tsx`
Expected: FAIL — `Cannot find module './demo-client-notice'`.

- [ ] **Step 3: Implement the component**

```tsx
import { PageHeader } from "@/components/page-header";

type Props = {
  variant: "register" | "detail";
};

const COPY: Record<Props["variant"], { title: string; message: string }> = {
  register: {
    title: "Clients",
    message:
      "The client register reads live company records and has no demo fixtures. Sign in to a production environment to use it.",
  },
  detail: {
    title: "Client",
    message:
      "Client profiles read live company records and have no demo fixtures. Sign in to a production environment to view one.",
  },
};

export function DemoClientNotice({ variant }: Props) {
  const copy = COPY[variant];

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader eyebrow="Operations" title={copy.title} />
      <section className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        {copy.message}
      </section>
    </main>
  );
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm run test -- src/features/clients/components/demo-client-notice.test.tsx`
Expected: PASS (2/2).

- [ ] **Step 5: Commit**

```bash
git add src/features/clients/components/demo-client-notice.tsx src/features/clients/components/demo-client-notice.test.tsx
git commit -m "feat: add demo-mode notice for the client register"
```

---

### Task 2: Production client register (list) component

**Files:**
- Create: `src/features/clients/components/production-client-register.tsx`
- Test: `src/features/clients/components/production-client-register.interaction.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClientAssignmentOptions, ClientSummary } from "../types";
import { ProductionClientRegister } from "./production-client-register";

const serverFns = vi.hoisted(() => ({
  listClients: vi.fn(),
  listAssignmentOptions: vi.fn(),
}));

vi.mock("../server-fns", () => ({
  listClients: serverFns.listClients,
  listAssignmentOptions: serverFns.listAssignmentOptions,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/clients">{children}</a>,
}));

function makeClient(overrides: Partial<ClientSummary> = {}): ClientSummary {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    companyName: "Acme Company Limited",
    crNumber: "CR1234567",
    brNumber: "BR7654321",
    status: "active",
    packageId: null,
    packageName: "Standard",
    ownerId: "22222222-2222-4222-8222-222222222222",
    ownerName: "Ada Chan",
    ownerInitials: "AC",
    teamId: "33333333-3333-4333-8333-333333333333",
    teamName: "Team Alpha",
    arDueDate: "2026-09-11",
    paymentStatus: "pending",
    invoiceAmount: 3000,
    ...overrides,
  };
}

function makeOptions(): ClientAssignmentOptions {
  return {
    owners: [{ id: "22222222-2222-4222-8222-222222222222", name: "Ada Chan", teamId: "33333333-3333-4333-8333-333333333333" }],
    teams: [{ id: "33333333-3333-4333-8333-333333333333", name: "Team Alpha" }],
    packages: [{ id: "44444444-4444-4444-8444-444444444444", name: "Standard", defaultFee: 3000, currency: "HKD", active: true, sortOrder: 0 }],
  };
}

function renderRegister() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ProductionClientRegister />
    </QueryClientProvider>,
  );
}

describe("production client register", () => {
  beforeEach(() => {
    serverFns.listClients.mockReset();
    serverFns.listAssignmentOptions.mockReset();
    serverFns.listAssignmentOptions.mockResolvedValue(makeOptions());
  });

  afterEach(() => {
    cleanup();
  });

  it("renders a row per client", async () => {
    serverFns.listClients.mockResolvedValue([makeClient()]);
    renderRegister();

    expect(await screen.findByText("Acme Company Limited")).toBeTruthy();
  });

  it("shows a fixed message on failure and never the raw server error", async () => {
    serverFns.listClients.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.4:5432"));
    renderRegister();

    const alert = await screen.findByRole("alert");

    expect(alert.textContent).toContain("Client data is unavailable.");
    expect(alert.textContent).not.toContain("ECONNREFUSED");
  });

  it("shows the empty state when the query succeeds with no clients", async () => {
    serverFns.listClients.mockResolvedValue([]);
    renderRegister();

    expect(await screen.findByText("No clients match the current filters.")).toBeTruthy();
  });

  it("filters rows by the search box", async () => {
    serverFns.listClients.mockResolvedValue([
      makeClient(),
      makeClient({ id: "55555555-5555-4555-8555-555555555555", companyName: "Beta Holdings" }),
    ]);
    renderRegister();
    await screen.findByText("Acme Company Limited");

    const search = screen.getByPlaceholderText("Search company, CR or BR number");
    fireEvent.change(search, { target: { value: "Beta" } });

    await waitFor(() => expect(screen.queryByText("Acme Company Limited")).toBeNull());
    expect(screen.getByText("Beta Holdings")).toBeTruthy();
  });

  it("disables New client until assignment options resolve", async () => {
    serverFns.listClients.mockResolvedValue([]);
    let resolveOptions: (value: ClientAssignmentOptions) => void = () => {};
    serverFns.listAssignmentOptions.mockReturnValue(
      new Promise((resolve) => {
        resolveOptions = resolve;
      }),
    );
    renderRegister();

    const button = () => screen.getByRole("button", { name: "New client" }) as HTMLButtonElement;
    expect(button().disabled).toBe(true);

    resolveOptions(makeOptions());
    await waitFor(() => expect(button().disabled).toBe(false));
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm run test -- src/features/clients/components/production-client-register.interaction.test.tsx`
Expected: FAIL — `Cannot find module './production-client-register'`.

- [ ] **Step 3: Implement the component**

```tsx
import { type ReactNode, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import type { StatusTone } from "@/lib/status";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { listAssignmentOptions, listClients } from "../server-fns";
import type { ClientPaymentStatus, ClientSummary, CompanyStatus } from "../types";

const REGISTER_GRID_COLUMNS =
  "lg:grid-cols-[minmax(220px,1.6fr)_140px_140px_140px_100px_120px_110px_72px]";
const REGISTER_GRID_MIN_WIDTH = "lg:min-w-[1180px]";

const STATUS_FILTERS = ["all", "active", "inactive"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const companyStatusTone: Record<CompanyStatus, StatusTone> = {
  active: "green",
  inactive: "neutral",
};

const paymentStatusTone: Record<ClientPaymentStatus, StatusTone> = {
  paid: "green",
  pending: "yellow",
  overdue: "red",
};

export function ProductionClientRegister() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const clientsQuery = useQuery({
    queryKey: ["clients"],
    queryFn: () => listClients(),
    retry: false,
  });

  const optionsQuery = useQuery({
    queryKey: ["clients", "assignment-options"],
    queryFn: () => listAssignmentOptions(),
    retry: false,
  });

  const clients = useMemo(() => clientsQuery.data ?? [], [clientsQuery.data]);

  const visibleClients = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return clients.filter((client) => {
      const matchesQuery =
        needle.length === 0 ||
        client.companyName.toLowerCase().includes(needle) ||
        client.crNumber.toLowerCase().includes(needle) ||
        client.brNumber.toLowerCase().includes(needle);
      const matchesStatus = statusFilter === "all" || client.status === statusFilter;
      const matchesTeam = teamFilter === "all" || client.teamId === teamFilter;
      return matchesQuery && matchesStatus && matchesTeam;
    });
  }, [clients, query, statusFilter, teamFilter]);

  function handleCreated() {
    void queryClient.invalidateQueries({ queryKey: ["clients"] });
  }

  return (
    <main className="flex-1 space-y-6 p-6">
      <PageHeader
        eyebrow="Operations"
        title="Clients"
        actions={
          <button
            type="button"
            disabled={!optionsQuery.data}
            onClick={() => setIsCreateOpen(true)}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-60"
          >
            New client
          </button>
        }
      />

      {clientsQuery.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Client data is unavailable. Try again shortly.
        </p>
      ) : null}

      <section className="rounded-lg border bg-card">
        <div className="grid gap-3 border-b p-4 lg:grid-cols-[1fr_auto_auto]">
          <input
            className="rounded-md border bg-background px-3 py-2 text-sm"
            aria-label="Search company, CR or BR number"
            placeholder="Search company, CR or BR number"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {STATUS_FILTERS.map((value) => (
              <button
                key={value}
                type="button"
                className={`rounded-md border px-3 py-2 text-sm capitalize ${
                  statusFilter === value ? "bg-primary text-primary-foreground" : "bg-background"
                }`}
                onClick={() => setStatusFilter(value)}
              >
                {value}
              </button>
            ))}
          </div>
          <select
            className="rounded-md border bg-background px-3 py-2 text-sm"
            aria-label="Filter by team"
            value={teamFilter}
            onChange={(event) => setTeamFilter(event.target.value)}
          >
            <option value="all">All teams</option>
            {(optionsQuery.data?.teams ?? []).map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-x-auto">
          <div className={REGISTER_GRID_MIN_WIDTH}>
            <div
              className={`hidden gap-3 border-b px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground lg:grid ${REGISTER_GRID_COLUMNS}`}
            >
              <span>Company</span>
              <span>Owner</span>
              <span>Team</span>
              <span>Package</span>
              <span>Status</span>
              <span>AR due</span>
              <span>Payment</span>
              <span className="text-right">Open</span>
            </div>

            <div className="divide-y">
              {visibleClients.map((client) => (
                <ClientRow key={client.id} client={client} />
              ))}
            </div>
          </div>
        </div>

        {clientsQuery.isPending ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Loading clients...</p>
        ) : null}

        {!clientsQuery.isPending && !clientsQuery.isError && visibleClients.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            No clients match the current filters.
          </p>
        ) : null}
      </section>

      {optionsQuery.data ? (
        <ClientFormDialog
          open={isCreateOpen}
          onOpenChange={setIsCreateOpen}
          options={optionsQuery.data}
          onSaved={handleCreated}
        />
      ) : null}
    </main>
  );
}

function ClientRow({ client }: { client: ClientSummary }) {
  return (
    <div className={`grid gap-3 px-4 py-4 lg:items-center ${REGISTER_GRID_COLUMNS}`}>
      <div className="min-w-0">
        <p className="truncate font-medium">{client.companyName}</p>
        <p className="truncate text-xs text-muted-foreground">
          CR {client.crNumber} · BR {client.brNumber}
        </p>
      </div>
      <Field label="Owner" value={client.ownerName} />
      <Field label="Team" value={client.teamName} />
      <Field label="Package" value={client.packageName ?? "No package"} />
      <Field
        label="Status"
        value={<StatusPill tone={companyStatusTone[client.status]}>{client.status}</StatusPill>}
      />
      <Field label="AR due" value={client.arDueDate ?? "No case yet"} />
      <Field
        label="Payment"
        value={
          client.paymentStatus ? (
            <StatusPill tone={paymentStatusTone[client.paymentStatus]}>
              {client.paymentStatus}
            </StatusPill>
          ) : (
            "—"
          )
        }
      />
      <div className="flex justify-start lg:justify-end">
        <Link
          className="rounded-md border px-3 py-2 text-center text-sm"
          to="/clients/$id"
          params={{ id: client.id }}
        >
          Open
        </Link>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:hidden">
        {label}
      </p>
      <div className="text-sm leading-5">{value}</div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm run test -- src/features/clients/components/production-client-register.interaction.test.tsx`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add src/features/clients/components/production-client-register.tsx src/features/clients/components/production-client-register.interaction.test.tsx
git commit -m "feat: add the production client register list screen"
```

---

### Task 3: `/clients` route + route-level data-mode test

**Files:**
- Create: `src/routes/clients.tsx`
- Modify: `src/components/page-header.convention.test.ts:47-54` (the `passThroughRoutes` set)
- Test: `src/routes/-clients-data-mode.test.tsx`

**Why the convention-test edit is needed:** `page-header.convention.test.ts` statically
scans every route file's own source text for the literal string `<PageHeader`, to guarantee
every screen renders one. `clients.tsx` delegates entirely to `DemoClientNotice` /
`ProductionClientRegister` — neither string appears in the route file itself — so without
adding it to `passThroughRoutes` (the same escape hatch already used for
`routes/annual-returns.$id.tsx`, for the identical reason) this test fails.

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../styles.css?url", () => ({ default: "/styles.css" }));

vi.mock("@/features/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../features/auth/session")>();
  return {
    ...actual,
    getStoredSession: () => ({
      id: "test-admin",
      name: "Test Admin",
      email: "admin@example.com",
      role: "Admin",
      initials: "TA",
      team: "Operations",
      signedInAt: "2026-07-11T00:00:00.000Z",
    }),
  };
});

vi.mock("@/features/auth/neon-auth-rpc", () => ({
  getAuthenticatedActor: () => Promise.resolve({ authUserId: "test-admin" }),
}));

vi.mock("@/features/auth/auth-context-neon", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../features/auth/auth-context-neon")>();
  const session = {
    id: "test-admin",
    name: "Test Admin",
    email: "admin@example.com",
    role: "Admin" as const,
    initials: "TA",
    team: "Operations",
    signedInAt: "2026-07-11T00:00:00.000Z",
  };

  return {
    ...actual,
    AuthProvider: ({ children }: { children: ReactNode }) => children,
    useAuth: () => ({
      session,
      isHydrated: true,
      demoUsers: [],
      isCurrentUserAdmin: true,
      login: vi.fn(),
      loginDemo: vi.fn(),
      loginDemoUser: vi.fn(),
      signOut: vi.fn(),
    }),
  };
});

const serverFns = vi.hoisted(() => ({
  listClients: vi.fn(async () => []),
  getClient: vi.fn(async () => null),
  listAssignmentOptions: vi.fn(async () => ({ owners: [], teams: [], packages: [] })),
}));

vi.mock("../features/clients/server-fns", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/clients/server-fns")>()),
  listClients: serverFns.listClients,
  getClient: serverFns.getClient,
  listAssignmentOptions: serverFns.listAssignmentOptions,
}));

import { routeTree } from "../routeTree.gen";

async function renderRoute(pathname: string, dataMode: "demo" | "production") {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [pathname] }),
    context: { queryClient: new QueryClient(), dataMode, actor: null },
    defaultPreloadStaleTime: 0,
  });

  await router.load();

  return renderToString(createElement(RouterProvider, { router }));
}

describe("clients route across data modes", () => {
  it("renders the production register at /clients in production mode", async () => {
    const html = await renderRoute("/clients", "production");

    expect(html).toContain("Search company, CR or BR number");
    expect(html).not.toContain("no demo fixtures");
  });

  it("renders the demo notice at /clients in demo mode", async () => {
    const html = await renderRoute("/clients", "demo");

    expect(html).toContain("no demo fixtures");
    expect(html).not.toContain("Search company, CR or BR number");
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm run test -- src/routes/-clients-data-mode.test.tsx`
Expected: FAIL — no route matches `/clients` (routeTree.gen.ts has no such path yet).

- [ ] **Step 3: Create the route file**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { DemoClientNotice } from "@/features/clients/components/demo-client-notice";
import { ProductionClientRegister } from "@/features/clients/components/production-client-register";

export const Route = createFileRoute("/clients")({
  component: ClientsRoute,
});

function ClientsRoute() {
  const { dataMode } = Route.useRouteContext();
  return dataMode === "demo" ? (
    <DemoClientNotice variant="register" />
  ) : (
    <ProductionClientRegister />
  );
}
```

- [ ] **Step 4: Add the new route to the page-header convention test's pass-through set**

In `src/components/page-header.convention.test.ts`, add `"routes/clients.tsx"` to the
`passThroughRoutes` set (in the `"is rendered by every route that draws a page"` test):

```ts
    const passThroughRoutes = new Set([
      "routes/__root.tsx",
      "routes/login.tsx",
      // A pass-through to the demo and production case-detail components, which
      // render the header themselves.
      "routes/annual-returns.$id.tsx",
      // A pass-through to DemoClientNotice / ProductionClientRegister, same reason.
      "routes/clients.tsx",
    ]);
```

- [ ] **Step 5: Regenerate the route tree and run the tests**

Run (this is a non-interactive shell, so background the dev server and kill it after it has
had time to run its startup route-generation pass, rather than pressing Ctrl+C):

```bash
npm run dev & DEV_PID=$!
sleep 10
kill $DEV_PID
```

This runs the TanStack Start Vite plugin once, which regenerates `src/routeTree.gen.ts` to
include the new `/clients` route. Confirm `routeTree.gen.ts` now references `/clients`, then:

Run: `npm run test -- src/routes/-clients-data-mode.test.tsx src/components/page-header.convention.test.ts`
Expected: PASS (2/2 in the first file, 4/4 in the second).

- [ ] **Step 6: Commit**

```bash
git add src/routes/clients.tsx src/routeTree.gen.ts src/routes/-clients-data-mode.test.tsx src/components/page-header.convention.test.ts
git commit -m "feat: add the /clients route"
```

---

### Task 4: Production client detail component

**Files:**
- Create: `src/features/clients/components/production-client-detail.tsx`
- Test: `src/features/clients/components/production-client-detail.interaction.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClientAssignmentOptions, ClientDetail } from "../types";
import { ProductionClientDetail } from "./production-client-detail";

const serverFns = vi.hoisted(() => ({
  getClient: vi.fn(),
  listAssignmentOptions: vi.fn(),
  removeClientContact: vi.fn(),
}));

vi.mock("../server-fns", () => ({
  getClient: serverFns.getClient,
  listAssignmentOptions: serverFns.listAssignmentOptions,
  removeClientContact: serverFns.removeClientContact,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/clients">{children}</a>,
}));

const clientId = "11111111-1111-4111-8111-111111111111";

function makeClient(overrides: Partial<ClientDetail> = {}): ClientDetail {
  return {
    id: clientId,
    companyName: "Acme Company Limited",
    crNumber: "CR1234567",
    brNumber: "BR7654321",
    status: "active",
    packageId: null,
    packageName: "Standard",
    ownerId: "22222222-2222-4222-8222-222222222222",
    ownerName: "Ada Chan",
    ownerInitials: "AC",
    teamId: "33333333-3333-4333-8333-333333333333",
    teamName: "Team Alpha",
    arDueDate: "2026-09-11",
    paymentStatus: "pending",
    invoiceAmount: 3000,
    incorporationDate: "2020-01-15",
    annualReturnBasisDate: "2020-01-15",
    registeredOffice: "1 Harbour Road, Hong Kong",
    companySecretary: "Kossilon Secretaries Ltd",
    contacts: [],
    timeline: [],
    annualReturnHistory: [],
    documents: [],
    ...overrides,
  };
}

function makeOptions(): ClientAssignmentOptions {
  return {
    owners: [{ id: "22222222-2222-4222-8222-222222222222", name: "Ada Chan", teamId: "33333333-3333-4333-8333-333333333333" }],
    teams: [{ id: "33333333-3333-4333-8333-333333333333", name: "Team Alpha" }],
    packages: [],
  };
}

function renderDetail() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ProductionClientDetail clientId={clientId} />
    </QueryClientProvider>,
  );
}

describe("production client detail", () => {
  beforeEach(() => {
    serverFns.getClient.mockReset();
    serverFns.listAssignmentOptions.mockReset();
    serverFns.removeClientContact.mockReset();
    serverFns.listAssignmentOptions.mockResolvedValue(makeOptions());
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the company overview once the query resolves", async () => {
    serverFns.getClient.mockResolvedValue(makeClient());
    renderDetail();

    expect(await screen.findByText("Acme Company Limited")).toBeTruthy();
    expect(screen.getByText("1 Harbour Road, Hong Kong")).toBeTruthy();
  });

  it("shows a not-found state when the client does not exist", async () => {
    serverFns.getClient.mockResolvedValue(null);
    renderDetail();

    expect(await screen.findByText("Client not found")).toBeTruthy();
  });

  it("shows a fixed message on failure and never the raw server error", async () => {
    serverFns.getClient.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.4:5432"));
    renderDetail();

    const alert = await screen.findByRole("alert");

    expect(alert.textContent).toContain("Client data is unavailable.");
    expect(alert.textContent).not.toContain("ECONNREFUSED");
  });

  it("renders each contact and removes one on click", async () => {
    serverFns.getClient.mockResolvedValue(
      makeClient({
        contacts: [
          { id: "66666666-6666-4666-8666-666666666666", companyId: clientId, name: "Ivy Wong", role: "Director", email: "ivy@example.com", phone: null, isPrimary: true },
        ],
      }),
    );
    serverFns.removeClientContact.mockResolvedValue(undefined);
    renderDetail();

    await screen.findByText("Ivy Wong");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(serverFns.removeClientContact).toHaveBeenCalledWith({
        data: { companyId: clientId, contactId: "66666666-6666-4666-8666-666666666666" },
      }),
    );
  });

  it("links each annual-return history row to its case", async () => {
    serverFns.getClient.mockResolvedValue(
      makeClient({
        annualReturnHistory: [
          { id: "77777777-7777-4777-8777-777777777777", returnYear: 2026, madeUpDate: "2026-01-15", filingDueDate: "2026-02-26", currentStatus: "Upcoming" },
        ],
      }),
    );
    renderDetail();

    expect(await screen.findByText("Return year 2026")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open case" })).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npm run test -- src/features/clients/components/production-client-detail.interaction.test.tsx`
Expected: FAIL — `Cannot find module './production-client-detail'`.

- [ ] **Step 3: Implement the component**

```tsx
import { type ReactNode, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { PageHeader } from "@/components/page-header";
import { StatusPill } from "@/components/status-pill";
import type { StatusTone } from "@/lib/status";
import { ClientFormDialog } from "@/components/clients/client-form-dialog";
import { ContactFormDialog } from "@/components/clients/contact-form-dialog";
import { getClient, listAssignmentOptions, removeClientContact } from "../server-fns";
import type {
  ClientPaymentStatus,
  CompanyContact,
  CompanyStatus,
} from "../types";

const companyStatusTone: Record<CompanyStatus, StatusTone> = {
  active: "green",
  inactive: "neutral",
};

const paymentStatusTone: Record<ClientPaymentStatus, StatusTone> = {
  paid: "green",
  pending: "yellow",
  overdue: "red",
};

const verificationTone: Record<"pending" | "verified" | "rejected", StatusTone> = {
  pending: "yellow",
  verified: "green",
  rejected: "red",
};

export function ProductionClientDetail({ clientId }: { clientId: string }) {
  const queryClient = useQueryClient();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [contactDialog, setContactDialog] = useState<{ open: boolean; contact?: CompanyContact }>({
    open: false,
  });

  const clientQuery = useQuery({
    queryKey: ["clients", clientId],
    queryFn: () => getClient({ data: { id: clientId } }),
    retry: false,
  });

  const optionsQuery = useQuery({
    queryKey: ["clients", "assignment-options"],
    queryFn: () => listAssignmentOptions(),
    retry: false,
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["clients", clientId] });
    void queryClient.invalidateQueries({ queryKey: ["clients"] });
  }

  async function handleRemoveContact(contactId: string) {
    await removeClientContact({ data: { companyId: clientId, contactId } });
    invalidate();
  }

  if (clientQuery.isPending) {
    return (
      <div className="flex min-h-64 items-center justify-center p-6 text-sm text-muted-foreground">
        <Loader2 aria-hidden className="mr-2 h-4 w-4 animate-spin" />
        Loading client
      </div>
    );
  }

  if (clientQuery.isError) {
    return (
      <main className="flex-1 space-y-3 p-6">
        <PageHeader eyebrow="Client" title="Client unavailable" />
        <p role="alert" className="text-sm text-destructive">
          Client data is unavailable. Try again shortly.
        </p>
        <Link className="inline-flex rounded-md border px-3 py-2 text-sm" to="/clients">
          Back to clients
        </Link>
      </main>
    );
  }

  const client = clientQuery.data;

  if (!client) {
    return (
      <main className="flex-1 space-y-3 p-6">
        <PageHeader eyebrow="Client" title="Client not found" />
        <Link className="inline-flex rounded-md border px-3 py-2 text-sm" to="/clients">
          Back to clients
        </Link>
      </main>
    );
  }

  return (
    <main className="flex-1 space-y-6 p-4 md:p-6">
      <PageHeader
        eyebrow="Client"
        title={client.companyName}
        subtitle={`CR ${client.crNumber} · BR ${client.brNumber}`}
        actions={
          optionsQuery.data ? (
            <button
              type="button"
              onClick={() => setIsEditOpen(true)}
              className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
            >
              Edit
            </button>
          ) : null
        }
      />

      <section className="grid gap-4 rounded-lg border bg-card p-4 md:grid-cols-3">
        <Detail
          label="Status"
          value={<StatusPill tone={companyStatusTone[client.status]}>{client.status}</StatusPill>}
        />
        <Detail label="Owner" value={client.ownerName} />
        <Detail label="Team" value={client.teamName} />
        <Detail label="Package" value={client.packageName ?? "No package"} />
        <Detail label="Incorporation date" value={client.incorporationDate} />
        <Detail label="AR basis date" value={client.annualReturnBasisDate} />
        <Detail label="Registered office" value={client.registeredOffice} />
        <Detail label="Company secretary" value={client.companySecretary} />
        <Detail
          label="Latest payment"
          value={
            client.paymentStatus ? (
              <StatusPill tone={paymentStatusTone[client.paymentStatus]}>
                {client.paymentStatus}
              </StatusPill>
            ) : (
              "No case yet"
            )
          }
        />
      </section>

      <section className="rounded-lg border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Contacts</h2>
          <button
            type="button"
            onClick={() => setContactDialog({ open: true })}
            className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
          >
            Add contact
          </button>
        </div>
        <div className="divide-y">
          {client.contacts.map((contact) => (
            <div key={contact.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {contact.name}
                  {contact.isPrimary ? (
                    <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                      Primary
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {contact.role} · {contact.email ?? contact.phone ?? "No contact details"}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => setContactDialog({ open: true, contact })}
                  className="rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => void handleRemoveContact(contact.id)}
                  className="rounded-md border px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
          {client.contacts.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">No contacts on file.</p>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Annual return history</h2>
        <div className="divide-y">
          {client.annualReturnHistory.map((entry) => (
            <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <span>Return year {entry.returnYear}</span>
              <span className="text-muted-foreground">Made up {entry.madeUpDate}</span>
              <span className="text-muted-foreground">Due {entry.filingDueDate}</span>
              <span>{entry.currentStatus}</span>
              <Link
                className="rounded-md border px-2 py-1 text-xs"
                to="/annual-returns/$id"
                params={{ id: entry.id }}
              >
                Open case
              </Link>
            </div>
          ))}
          {client.annualReturnHistory.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">No annual return cases yet.</p>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Documents</h2>
        <div className="divide-y">
          {client.documents.map((document) => (
            <div key={document.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
              <span className="truncate">{document.fileName}</span>
              <span className="text-muted-foreground">{document.fileType}</span>
              <StatusPill tone={verificationTone[document.verificationStatus]}>
                {document.verificationStatus}
              </StatusPill>
              <span className="text-muted-foreground">{document.uploadedAt.slice(0, 10)}</span>
            </div>
          ))}
          {client.documents.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">No documents on file.</p>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Timeline</h2>
        <div className="divide-y">
          {client.timeline.map((entry) => (
            <div key={entry.id} className="py-3 text-sm">
              <p>{entry.description}</p>
              <p className="text-xs text-muted-foreground">
                {entry.actorName ?? "System"} · {new Date(entry.createdAt).toLocaleString("en-HK")}
              </p>
            </div>
          ))}
          {client.timeline.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">No activity yet.</p>
          ) : null}
        </div>
      </section>

      {optionsQuery.data ? (
        <ClientFormDialog
          open={isEditOpen}
          onOpenChange={setIsEditOpen}
          options={optionsQuery.data}
          client={client}
          onSaved={invalidate}
        />
      ) : null}

      <ContactFormDialog
        open={contactDialog.open}
        onOpenChange={(open) => setContactDialog((current) => ({ ...current, open }))}
        companyId={clientId}
        contact={contactDialog.contact}
        onSaved={() => {
          invalidate();
          setContactDialog({ open: false });
        }}
      />
    </main>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="mt-1 text-sm">{value}</div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npm run test -- src/features/clients/components/production-client-detail.interaction.test.tsx`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add src/features/clients/components/production-client-detail.tsx src/features/clients/components/production-client-detail.interaction.test.tsx
git commit -m "feat: add the production client detail screen"
```

---

### Task 5: `/clients/$id` route + route-level data-mode test

**Files:**
- Create: `src/routes/clients.$id.tsx`
- Modify: `src/routes/-clients-data-mode.test.tsx` (append two more tests to the same
  `describe` block written in Task 3 — same mocks and `renderRoute` helper already in the
  file, no new imports needed)
- Modify: `src/components/page-header.convention.test.ts` (same `passThroughRoutes` set
  edited in Task 3, for the same reason: `clients.$id.tsx` delegates entirely to
  `DemoClientNotice` / `ProductionClientDetail`, so the literal string `<PageHeader` never
  appears in the route file itself)

- [ ] **Step 1: Extend the failing test**

Append inside the existing `describe("clients route across data modes", ...)` block:

```tsx
  it("renders the production detail screen at /clients/$id in production mode", async () => {
    const html = await renderRoute(
      "/clients/11111111-1111-4111-8111-111111111111",
      "production",
    );

    expect(html).toContain("Loading client");
    expect(html).not.toContain("no demo fixtures");
  });

  it("renders the demo notice at /clients/$id in demo mode", async () => {
    const html = await renderRoute(
      "/clients/11111111-1111-4111-8111-111111111111",
      "demo",
    );

    expect(html).toContain("no demo fixtures");
    expect(html).not.toContain("Loading client");
  });
```

- [ ] **Step 2: Run the test and confirm the two new cases fail**

Run: `npm run test -- src/routes/-clients-data-mode.test.tsx`
Expected: FAIL on the two new tests — no route matches `/clients/$id` yet.

- [ ] **Step 3: Create the route file**

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { DemoClientNotice } from "@/features/clients/components/demo-client-notice";
import { ProductionClientDetail } from "@/features/clients/components/production-client-detail";

export const Route = createFileRoute("/clients/$id")({
  component: ClientDetailRoute,
});

function ClientDetailRoute() {
  const { id } = Route.useParams();
  const { dataMode } = Route.useRouteContext();
  return dataMode === "demo" ? (
    <DemoClientNotice variant="detail" />
  ) : (
    <ProductionClientDetail clientId={id} />
  );
}
```

- [ ] **Step 4: Add the new route to the page-header convention test's pass-through set**

In `src/components/page-header.convention.test.ts`, add `"routes/clients.$id.tsx"` next to
the `"routes/clients.tsx"` entry added in Task 3:

```ts
    const passThroughRoutes = new Set([
      "routes/__root.tsx",
      "routes/login.tsx",
      // A pass-through to the demo and production case-detail components, which
      // render the header themselves.
      "routes/annual-returns.$id.tsx",
      // A pass-through to DemoClientNotice / ProductionClientRegister(/Detail), same reason.
      "routes/clients.tsx",
      "routes/clients.$id.tsx",
    ]);
```

- [ ] **Step 5: Regenerate the route tree and run the tests**

Run the same background-and-kill sequence as Task 3 Step 5 to regenerate
`routeTree.gen.ts` with `/clients/$id` included:

```bash
npm run dev & DEV_PID=$!
sleep 10
kill $DEV_PID
```

Run: `npm run test -- src/routes/-clients-data-mode.test.tsx src/components/page-header.convention.test.ts`
Expected: PASS (4/4 in the first file, 4/4 in the second).

- [ ] **Step 6: Commit**

```bash
git add src/routes/clients.\$id.tsx src/routeTree.gen.ts src/routes/-clients-data-mode.test.tsx src/components/page-header.convention.test.ts
git commit -m "feat: add the /clients/\$id route"
```

---

### Task 6: Restore the navigation entry

**Files:**
- Modify: `src/components/navigation.ts:1-23` (imports + the comment block above `navGroups`)
  and `:38-49` (the "Operations" group's `items` array)

- [ ] **Step 1: Update the icon import**

In `src/components/navigation.ts`, add `Building2` to the `lucide-react` import (currently
unused anywhere in this file):

```ts
import {
  Building2,
  CalendarClock,
  CreditCard,
  ExternalLink,
  FileText,
  LayoutDashboard,
  ListChecks,
  MessageCircle,
  Settings,
  ShieldCheck,
  Zap,
  type LucideIcon,
} from "lucide-react";
```

- [ ] **Step 2: Replace the stale comment**

Replace the comment block (lines 15-22) with:

```ts
// Single source of truth for primary navigation. The sidebar (desktop) and the
// drawer (mobile) both render this, so the two can no longer drift apart in
// either the set of destinations they expose or the labels they use.
//
// /clients has no fixture-backed tier, by design: it reads live company
// records in production and renders an explanatory notice in demo mode
// (see DemoClientNotice) rather than a fixture board. /enquiries, /teams
// and /tasks remain deleted — each had no table behind it, or is superseded
// by a screen already reading Postgres (/work-queue, /annual-returns).
```

- [ ] **Step 3: Add the nav item**

In the "Operations" group's `items` array, add the `Clients` entry after `Annual Returns`:

```ts
  {
    heading: "Operations",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
      { to: "/work-queue", label: "Work Queue", icon: ListChecks },
      { to: "/annual-returns", label: "Annual Returns", icon: CalendarClock },
      { to: "/clients", label: "Clients", icon: Building2 },
      { to: "/documents", label: "Documents", icon: FileText },
      { to: "/portal", label: "Portal", icon: ExternalLink },
      { to: "/payments", label: "Payments", icon: CreditCard },
    ],
  },
```

- [ ] **Step 4: Run the full test suite and typecheck**

Run: `npm run test`
Expected: PASS, same or higher total test count than before this task, no new failures.

Run: `npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/components/navigation.ts
git commit -m "feat: restore the Clients entry in primary navigation"
```

---

### Task 7: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm run test`
Expected: PASS, all suites green.

- [ ] **Step 2: Run lint**

Run: `npm run lint`
Expected: PASS, no errors.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS, no errors.

- [ ] **Step 4: Manual smoke test (production mode)**

Start the dev server (`npm run dev`), sign in as a production (non-demo) user, and confirm:
- `/clients` shows the "Clients" entry in the sidebar, lists at least the seeded demo/test
  companies, search and filters narrow the table, and "New client" opens a working create
  dialog.
- Opening a row's "Open" link lands on `/clients/$id` and renders the overview, contacts,
  annual-return history, documents, and timeline sections.
- Editing the company and adding/editing/removing a contact all work and refresh the screen
  without a manual reload.

- [ ] **Step 5: Manual smoke test (demo mode)**

With demo auth enabled, visit `/clients` and `/clients/$id` and confirm both show the
explanatory notice, not a crash, blank screen, or fixture data.

No commit for this task — it is verification of Tasks 1-6.
