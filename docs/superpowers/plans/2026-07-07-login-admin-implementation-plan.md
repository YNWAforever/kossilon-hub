# Login and Admin Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a prototype login wall and minimal admin console for Kossilon Hub using local demo sessions.

**Architecture:** Add a focused `src/features/auth` module that owns demo users, local session persistence, role checks, and route-guard helpers. Update the root shell to render `/login` without the app chrome and protect every other route with a session-aware boundary. Add `/admin` as a role-aware route that exposes user management and system-setting summaries for Admin users.

**Tech Stack:** TanStack Router/Start, React 19, TypeScript, Vitest, existing Tailwind design tokens, lucide-react icons.

---

## File Structure

- Create `src/features/auth/session.ts`: pure auth adapter for demo users, session persistence, login/logout, and role checks.
- Create `src/features/auth/session.test.ts`: unit coverage for credential login, demo login, logout, corrupt storage, and admin role checks.
- Create `src/features/auth/route-guard.ts`: pure helpers for public route detection and safe post-login redirect persistence.
- Create `src/features/auth/route-guard.test.ts`: unit coverage for public route and redirect normalization behavior.
- Create `src/features/auth/auth-context.tsx`: React provider and `useAuth()` hook backed by the pure auth adapter.
- Modify `src/routes/__root.tsx`: install `AuthProvider`, skip app chrome on `/login`, and guard protected app routes.
- Modify `src/components/top-bar.tsx`: show active session user and sign out action instead of static `currentUser`.
- Modify `src/components/app-sidebar.tsx`: add `/admin` navigation item.
- Create `src/routes/login.tsx`: public login screen with form login and quick demo user buttons.
- Create `src/routes/admin.tsx`: role-aware admin console with Users, System Settings, and Audit Preview sections.
- Update `src/routeTree.gen.ts` only if TanStack route generation changes it during build or dev verification.

---

### Task 1: Auth Session Adapter

**Files:**
- Create: `src/features/auth/session.test.ts`
- Create: `src/features/auth/session.ts`

- [ ] **Step 1: Write the failing session tests**

Create `src/features/auth/session.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  AUTH_SESSION_STORAGE_KEY,
  clearStoredSession,
  demoUsers,
  getStoredSession,
  isAdmin,
  loginAsDemoUser,
  loginWithCredentials,
  logout,
} from "./session";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe("auth session adapter", () => {
  let storage: MemoryStorage;
  const now = () => "2026-07-07T09:00:00.000Z";

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it("signs in with valid demo credentials and stores non-sensitive session metadata", () => {
    const result = loginWithCredentials("admin@kossilon.test", "admin-demo", storage, now);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session).toMatchObject({
      id: "u-amy",
      name: "Amy Chan",
      email: "admin@kossilon.test",
      role: "Admin",
      signedInAt: "2026-07-07T09:00:00.000Z",
    });
    expect(JSON.stringify(result.session)).not.toContain("admin-demo");
    expect(getStoredSession(storage)).toEqual(result.session);
  });

  it("rejects invalid credentials without storing a session", () => {
    const result = loginWithCredentials("admin@kossilon.test", "wrong-password", storage, now);

    expect(result).toEqual({ ok: false, error: "Email or password is incorrect." });
    expect(storage.getItem(AUTH_SESSION_STORAGE_KEY)).toBeNull();
  });

  it("signs in as a demo user by id", () => {
    const result = loginAsDemoUser("u-mei", storage, now);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session).toMatchObject({
      id: "u-mei",
      name: "Mei Lam",
      role: "Staff",
    });
  });

  it("clears the session on logout", () => {
    const result = loginAsDemoUser("u-amy", storage, now);
    expect(result.ok).toBe(true);

    logout(storage);

    expect(getStoredSession(storage)).toBeNull();
  });

  it("ignores corrupt stored session data", () => {
    storage.setItem(AUTH_SESSION_STORAGE_KEY, "{not valid json");

    expect(getStoredSession(storage)).toBeNull();
    expect(storage.getItem(AUTH_SESSION_STORAGE_KEY)).toBeNull();
  });

  it("checks admin permissions by role", () => {
    const admin = demoUsers.find((user) => user.role === "Admin")!;
    const staff = demoUsers.find((user) => user.role === "Staff")!;

    expect(isAdmin(admin)).toBe(true);
    expect(isAdmin(staff)).toBe(false);
  });

  it("clears stored session data explicitly", () => {
    const result = loginAsDemoUser("u-amy", storage, now);
    expect(result.ok).toBe(true);

    clearStoredSession(storage);

    expect(storage.getItem(AUTH_SESSION_STORAGE_KEY)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the failing session tests**

Run:

```bash
bunx vitest run src/features/auth/session.test.ts
```

Expected: FAIL because `src/features/auth/session.ts` does not exist.

- [ ] **Step 3: Implement the session adapter**

Create `src/features/auth/session.ts`:

```ts
export const AUTH_SESSION_STORAGE_KEY = "kossilon.auth.session.v1";

export type AuthRole = "Admin" | "Manager" | "Staff";

export type DemoUser = {
  id: string;
  name: string;
  email: string;
  password: string;
  role: AuthRole;
  initials: string;
  team: string;
  active: boolean;
  lastLoginAt: string;
};

export type AuthSession = {
  id: string;
  name: string;
  email: string;
  role: AuthRole;
  initials: string;
  team: string;
  signedInAt: string;
};

export type AuthResult =
  | { ok: true; session: AuthSession }
  | { ok: false; error: string };

type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type NowProvider = () => string;

export const demoUsers: DemoUser[] = [
  {
    id: "u-amy",
    name: "Amy Chan",
    email: "admin@kossilon.test",
    password: "admin-demo",
    role: "Admin",
    initials: "AC",
    team: "Filing Team A",
    active: true,
    lastLoginAt: "2026-07-07T08:45:00.000Z",
  },
  {
    id: "u-ken",
    name: "Ken Wong",
    email: "manager@kossilon.test",
    password: "manager-demo",
    role: "Manager",
    initials: "KW",
    team: "Filing Team A",
    active: true,
    lastLoginAt: "2026-07-06T17:30:00.000Z",
  },
  {
    id: "u-mei",
    name: "Mei Lam",
    email: "staff@kossilon.test",
    password: "staff-demo",
    role: "Staff",
    initials: "ML",
    team: "Filing Team B",
    active: true,
    lastLoginAt: "2026-07-06T16:20:00.000Z",
  },
];

function browserStorage(): SessionStorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function systemNow(): string {
  return new Date().toISOString();
}

function toSession(user: DemoUser, signedInAt: string): AuthSession {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    initials: user.initials,
    team: user.team,
    signedInAt,
  };
}

function isAuthSession(value: unknown): value is AuthSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<AuthSession>;
  return (
    typeof session.id === "string" &&
    typeof session.name === "string" &&
    typeof session.email === "string" &&
    (session.role === "Admin" || session.role === "Manager" || session.role === "Staff") &&
    typeof session.initials === "string" &&
    typeof session.team === "string" &&
    typeof session.signedInAt === "string"
  );
}

export function getStoredSession(storage = browserStorage()): AuthSession | null {
  if (!storage) return null;

  const raw = storage.getItem(AUTH_SESSION_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (isAuthSession(parsed)) return parsed;
  } catch {
    clearStoredSession(storage);
    return null;
  }

  clearStoredSession(storage);
  return null;
}

export function storeSession(session: AuthSession, storage = browserStorage()): void {
  if (!storage) return;
  storage.setItem(AUTH_SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearStoredSession(storage = browserStorage()): void {
  if (!storage) return;
  storage.removeItem(AUTH_SESSION_STORAGE_KEY);
}

export function loginWithCredentials(
  email: string,
  password: string,
  storage = browserStorage(),
  now: NowProvider = systemNow,
): AuthResult {
  const normalizedEmail = email.trim().toLowerCase();
  const user = demoUsers.find(
    (candidate) =>
      candidate.active &&
      candidate.email.toLowerCase() === normalizedEmail &&
      candidate.password === password,
  );

  if (!user) {
    return { ok: false, error: "Email or password is incorrect." };
  }

  const session = toSession(user, now());
  storeSession(session, storage);
  return { ok: true, session };
}

export function loginAsDemoUser(
  userId: string,
  storage = browserStorage(),
  now: NowProvider = systemNow,
): AuthResult {
  const user = demoUsers.find((candidate) => candidate.active && candidate.id === userId);

  if (!user) {
    return { ok: false, error: "Demo user is unavailable." };
  }

  const session = toSession(user, now());
  storeSession(session, storage);
  return { ok: true, session };
}

export function logout(storage = browserStorage()): void {
  clearStoredSession(storage);
}

export function isAdmin(user: Pick<AuthSession | DemoUser, "role"> | null | undefined): boolean {
  return user?.role === "Admin";
}
```

- [ ] **Step 4: Run the session tests again**

Run:

```bash
bunx vitest run src/features/auth/session.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the session adapter**

Run:

```bash
git add src/features/auth/session.ts src/features/auth/session.test.ts
git commit -m "feat: add demo auth session adapter"
```

---

### Task 2: Redirect and Public Route Helpers

**Files:**
- Create: `src/features/auth/route-guard.test.ts`
- Create: `src/features/auth/route-guard.ts`

- [ ] **Step 1: Write failing route-guard tests**

Create `src/features/auth/route-guard.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  AUTH_REDIRECT_STORAGE_KEY,
  consumeRedirectPath,
  isPublicRoute,
  rememberRedirectPath,
} from "./route-guard";

class MemoryStorage implements Pick<Storage, "getItem" | "setItem" | "removeItem"> {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe("auth route guard helpers", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it("treats only login as public", () => {
    expect(isPublicRoute("/login")).toBe(true);
    expect(isPublicRoute("/")).toBe(false);
    expect(isPublicRoute("/admin")).toBe(false);
  });

  it("remembers and consumes a safe redirect path", () => {
    rememberRedirectPath("/annual-returns?risk=red", storage);

    expect(storage.getItem(AUTH_REDIRECT_STORAGE_KEY)).toBe("/annual-returns?risk=red");
    expect(consumeRedirectPath(storage)).toBe("/annual-returns?risk=red");
    expect(storage.getItem(AUTH_REDIRECT_STORAGE_KEY)).toBeNull();
  });

  it("normalizes unsafe redirect paths to dashboard", () => {
    rememberRedirectPath("https://example.com/phish", storage);
    expect(consumeRedirectPath(storage)).toBe("/");

    rememberRedirectPath("/login", storage);
    expect(consumeRedirectPath(storage)).toBe("/");
  });
});
```

- [ ] **Step 2: Run the failing route-guard tests**

Run:

```bash
bunx vitest run src/features/auth/route-guard.test.ts
```

Expected: FAIL because `src/features/auth/route-guard.ts` does not exist.

- [ ] **Step 3: Implement route-guard helpers**

Create `src/features/auth/route-guard.ts`:

```ts
export const AUTH_REDIRECT_STORAGE_KEY = "kossilon.auth.redirect.v1";

type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): SessionStorageLike | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function isPublicRoute(pathname: string): boolean {
  return pathname === "/login";
}

function normalizeRedirectPath(path: string | null): string {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path === "/login") {
    return "/";
  }

  return path;
}

export function rememberRedirectPath(path: string, storage = browserStorage()): void {
  if (!storage) return;
  storage.setItem(AUTH_REDIRECT_STORAGE_KEY, normalizeRedirectPath(path));
}

export function consumeRedirectPath(storage = browserStorage()): string {
  if (!storage) return "/";

  const path = normalizeRedirectPath(storage.getItem(AUTH_REDIRECT_STORAGE_KEY));
  storage.removeItem(AUTH_REDIRECT_STORAGE_KEY);
  return path;
}
```

- [ ] **Step 4: Run route-guard tests again**

Run:

```bash
bunx vitest run src/features/auth/route-guard.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit route-guard helpers**

Run:

```bash
git add src/features/auth/route-guard.ts src/features/auth/route-guard.test.ts
git commit -m "feat: add auth route guard helpers"
```

---

### Task 3: Auth Context and Protected App Shell

**Files:**
- Create: `src/features/auth/auth-context.tsx`
- Modify: `src/routes/__root.tsx`
- Modify: `src/components/top-bar.tsx`

- [ ] **Step 1: Confirm existing auth helper tests pass before wiring React**

Run:

```bash
bunx vitest run src/features/auth/session.test.ts src/features/auth/route-guard.test.ts
```

Expected: PASS.

- [ ] **Step 2: Create the auth React context**

Create `src/features/auth/auth-context.tsx`:

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  demoUsers,
  getStoredSession,
  isAdmin,
  loginAsDemoUser,
  loginWithCredentials,
  logout,
  type AuthResult,
  type AuthSession,
} from "./session";

type AuthContextValue = {
  session: AuthSession | null;
  isHydrated: boolean;
  demoUsers: typeof demoUsers;
  isCurrentUserAdmin: boolean;
  login: (email: string, password: string) => AuthResult;
  loginDemo: (userId: string) => AuthResult;
  signOut: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    setSession(getStoredSession());
    setIsHydrated(true);
  }, []);

  const login = useCallback((email: string, password: string) => {
    const result = loginWithCredentials(email, password);
    if (result.ok) setSession(result.session);
    return result;
  }, []);

  const loginDemo = useCallback((userId: string) => {
    const result = loginAsDemoUser(userId);
    if (result.ok) setSession(result.session);
    return result;
  }, []);

  const signOut = useCallback(() => {
    logout();
    setSession(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      isHydrated,
      demoUsers,
      isCurrentUserAdmin: isAdmin(session),
      login,
      loginDemo,
      signOut,
    }),
    [isHydrated, login, loginDemo, session, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider.");
  }
  return value;
}
```

- [ ] **Step 3: Protect the root app shell**

Modify `src/routes/__root.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useNavigate,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AppSidebar } from "@/components/app-sidebar";
import { Toaster } from "@/components/ui/sonner";
import { AuthProvider, useAuth } from "@/features/auth/auth-context";
import { isPublicRoute, rememberRedirectPath } from "@/features/auth/route-guard";
```

Keep `NotFoundComponent`, `ErrorComponent`, and the route export. Replace `RootComponent()` and add `ProtectedAppShell()` below it:

```tsx
function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        {isPublicRoute(pathname) ? <Outlet /> : <ProtectedAppShell />}
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}

function ProtectedAppShell() {
  const { session, isHydrated } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isHydrated || session) return;
    rememberRedirectPath(`${window.location.pathname}${window.location.search}`);
    void navigate({ to: "/login" });
  }, [isHydrated, navigate, session]);

  if (!isHydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <span className="font-display text-sm font-bold">K</span>
          </div>
          <p className="mt-3 text-sm text-muted-foreground">Checking session...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return null;
  }

  return (
    <div className="flex min-h-screen w-full bg-background">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Make the top bar session-aware**

Modify `src/components/top-bar.tsx`:

```tsx
import { Search, Bell, HelpCircle, LogOut } from "lucide-react";
import { useAuth } from "@/features/auth/auth-context";

export function TopBar({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  const { session, signOut } = useAuth();

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur">
      <div className="flex h-14 items-center gap-4 px-6">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-lg font-semibold leading-tight text-foreground">
            {title}
          </h1>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>

        <div className="hidden items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 md:flex md:w-72">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            placeholder="Search clients, cases, enquiries..."
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            Cmd K
          </kbd>
        </div>

        {actions}

        <button
          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Help"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
        <button
          className="relative rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-status-red" />
        </button>

        <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-sand text-xs font-semibold text-white">
            {session?.initials ?? "--"}
          </div>
          <div className="hidden text-right leading-tight md:block">
            <div className="text-xs font-semibold text-foreground">{session?.name ?? "Signed in"}</div>
            <div className="text-[10px] text-muted-foreground">{session?.role ?? "User"}</div>
          </div>
        </div>

        <button
          onClick={signOut}
          className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 5: Run focused checks**

Run:

```bash
bunx eslint src/features/auth/auth-context.tsx src/routes/__root.tsx src/components/top-bar.tsx
bunx tsc --noEmit --pretty false
bun run test
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit protected shell changes**

Run:

```bash
git add src/features/auth/auth-context.tsx src/routes/__root.tsx src/components/top-bar.tsx
git commit -m "feat: protect app shell with demo session"
```

---

### Task 4: Login Route

**Files:**
- Create: `src/routes/login.tsx`

- [ ] **Step 1: Create the login route**

Create `src/routes/login.tsx`:

```tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { AlertCircle, ShieldCheck, UserRound } from "lucide-react";
import { StatusPill } from "@/components/status-pill";
import { useAuth } from "@/features/auth/auth-context";
import { consumeRedirectPath } from "@/features/auth/route-guard";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Login - Kossilon CoSec OS" },
      {
        name: "description",
        content: "Sign in to Kossilon CoSec OS.",
      },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const { session, isHydrated, login, loginDemo, demoUsers } = useAuth();
  const [email, setEmail] = useState("admin@kossilon.test");
  const [password, setPassword] = useState("admin-demo");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isHydrated || !session) return;
    const redirectPath = consumeRedirectPath();
    void navigate({ to: redirectPath as never });
  }, [isHydrated, navigate, session]);

  function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = login(email, password);
    setError(result.ok ? null : result.error);
  }

  function submitDemoLogin(userId: string) {
    const result = loginDemo(userId);
    setError(result.ok ? null : result.error);
  }

  return (
    <main className="flex min-h-screen bg-background">
      <section className="hidden min-h-screen flex-1 flex-col justify-between bg-primary p-10 text-primary-foreground lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary-foreground text-primary">
            <span className="font-display text-base font-bold">K</span>
          </div>
          <div>
            <div className="font-display text-lg font-semibold">Kossilon</div>
            <div className="text-xs uppercase tracking-wider text-primary-foreground/70">
              Company Secretary Operating System
            </div>
          </div>
        </div>
        <div className="max-w-xl">
          <p className="text-sm uppercase tracking-[0.2em] text-primary-foreground/60">
            Compliance Core
          </p>
          <h1 className="mt-4 font-display text-4xl font-semibold leading-tight">
            Secure access for annual returns, WhatsApp enquiries, documents, and team operations.
          </h1>
          <p className="mt-4 text-sm leading-6 text-primary-foreground/75">
            This prototype login uses demo identities so the operating system can be tested before
            production authentication is connected.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3 text-xs text-primary-foreground/75">
          <div className="rounded-md bg-primary-foreground/10 p-3">Protected app shell</div>
          <div className="rounded-md bg-primary-foreground/10 p-3">Role-aware admin</div>
          <div className="rounded-md bg-primary-foreground/10 p-3">Replaceable auth adapter</div>
        </div>
      </section>

      <section className="flex min-h-screen w-full items-center justify-center px-6 lg:w-[480px]">
        <div className="w-full max-w-sm">
          <div className="mb-7 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <span className="font-display text-base font-bold">K</span>
            </div>
          </div>

          <div>
            <StatusPill tone="blue">Prototype access</StatusPill>
            <h2 className="mt-4 font-display text-2xl font-semibold text-foreground">
              Sign in to continue
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Use demo credentials or choose a demo identity.
            </p>
          </div>

          <form onSubmit={submitLogin} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Email</span>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-muted-foreground">Password</span>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
            {error && (
              <div className="flex items-start gap-2 rounded-md border border-status-red/30 bg-status-red-soft px-3 py-2 text-xs text-status-red">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5" />
                <span>{error}</span>
              </div>
            )}
            <button className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              <ShieldCheck className="h-4 w-4" />
              Sign in
            </button>
          </form>

          <div className="mt-6">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Demo identities
            </p>
            <div className="mt-2 space-y-2">
              {demoUsers.map((user) => (
                <button
                  key={user.id}
                  onClick={() => submitDemoLogin(user.id)}
                  className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-left hover:bg-accent"
                >
                  <span className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sand text-xs font-semibold text-white">
                      {user.initials}
                    </span>
                    <span>
                      <span className="block text-sm font-medium text-foreground">{user.name}</span>
                      <span className="block text-[11px] text-muted-foreground">{user.email}</span>
                    </span>
                  </span>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <UserRound className="h-3.5 w-3.5" />
                    {user.role}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
```

- [ ] **Step 2: Run focused checks**

Run:

```bash
bunx eslint src/routes/login.tsx
bunx tsc --noEmit --pretty false
```

Expected: both commands exit 0.

- [ ] **Step 3: Commit the login route**

Run:

```bash
git add src/routes/login.tsx src/routeTree.gen.ts
git commit -m "feat: add prototype login page"
```

If `src/routeTree.gen.ts` is not modified, omit it from `git add`.

---

### Task 5: Admin Route and Sidebar Link

**Files:**
- Modify: `src/components/app-sidebar.tsx`
- Create: `src/routes/admin.tsx`

- [ ] **Step 1: Add Admin to the sidebar**

Modify `src/components/app-sidebar.tsx`:

```tsx
import {
  LayoutDashboard,
  Inbox,
  Building2,
  CalendarClock,
  FileText,
  CreditCard,
  MessageCircle,
  CheckSquare,
  Users,
  Settings,
  ShieldCheck,
} from "lucide-react";
```

Add the Admin item near Settings:

```ts
const nav: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/enquiries", label: "Enquiries", icon: Inbox },
  { to: "/clients", label: "Clients", icon: Building2 },
  { to: "/annual-returns", label: "Annual Returns", icon: CalendarClock },
  { to: "/documents", label: "Documents", icon: FileText },
  { to: "/payments", label: "Payments", icon: CreditCard },
  { to: "/whatsapp", label: "WhatsApp Inbox", icon: MessageCircle },
  { to: "/tasks", label: "Tasks", icon: CheckSquare },
  { to: "/teams", label: "Teams", icon: Users },
  { to: "/admin", label: "Admin", icon: ShieldCheck },
  { to: "/settings", label: "Settings", icon: Settings },
];
```

- [ ] **Step 2: Create the admin route**

Create `src/routes/admin.tsx`:

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Activity,
  Building2,
  CheckCircle2,
  KeyRound,
  LockKeyhole,
  MessageCircle,
  Package,
  ShieldCheck,
  UserCog,
  Users,
  type LucideIcon,
} from "lucide-react";
import { TopBar } from "@/components/top-bar";
import { StatusPill } from "@/components/status-pill";
import { demoUsers, isAdmin, type AuthRole } from "@/features/auth/session";
import { useAuth } from "@/features/auth/auth-context";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Admin - Kossilon CoSec OS" },
      {
        name: "description",
        content: "Manage prototype users, roles, and system settings.",
      },
    ],
  }),
  component: AdminPage,
});

type AdminTab = "users" | "system" | "audit";

const adminTabs: { value: AdminTab; label: string; icon: LucideIcon }[] = [
  { value: "users", label: "Users", icon: UserCog },
  { value: "system", label: "System settings", icon: Building2 },
  { value: "audit", label: "Audit preview", icon: Activity },
];

function AdminPage() {
  const { session, loginDemo } = useAuth();
  const [tab, setTab] = useState<AdminTab>("users");
  const [localUsers, setLocalUsers] = useState(demoUsers);
  const canAdmin = isAdmin(session);

  const activeUsers = useMemo(() => localUsers.filter((user) => user.active).length, [localUsers]);

  if (!canAdmin) {
    return (
      <>
        <TopBar
          title="Admin"
          subtitle="Restricted area"
        />
        <main className="flex-1 p-6">
          <section className="rounded-xl border border-border bg-card p-6">
            <div className="flex max-w-2xl items-start gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-status-yellow-soft">
                <LockKeyhole className="h-5 w-5 text-status-orange" />
              </div>
              <div>
                <h2 className="font-display text-lg font-semibold text-foreground">
                  Admin access required
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {session?.name ?? "This user"} is signed in as {session?.role ?? "User"}.
                  Admin tools are limited to prototype Admin users.
                </p>
                <Link
                  to="/"
                  className="mt-4 inline-flex rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  Back to dashboard
                </Link>
              </div>
            </div>
          </section>
        </main>
      </>
    );
  }

  return (
    <>
      <TopBar
        title="Admin"
        subtitle="Users, roles, system settings"
      />
      <main className="flex-1 space-y-6 p-6">
        <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <AdminMetric icon={Users} label="Demo users" value={localUsers.length} />
          <AdminMetric icon={CheckCircle2} label="Active users" value={activeUsers} />
          <AdminMetric icon={ShieldCheck} label="Admin users" value={localUsers.filter((user) => user.role === "Admin").length} />
        </section>

        <section className="rounded-xl border border-border bg-card">
          <div className="flex flex-wrap gap-2 border-b border-border px-5 py-4">
            {adminTabs.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => setTab(value)}
                className={cn(
                  "inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-medium",
                  tab === value
                    ? "bg-primary text-primary-foreground"
                    : "border border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>

          <div className="p-5">
            {tab === "users" && (
              <UsersPanel
                users={localUsers}
                onToggleActive={(id) =>
                  setLocalUsers((users) =>
                    users.map((user) =>
                      user.id === id ? { ...user, active: !user.active } : user,
                    ),
                  )
                }
                onRoleChange={(id, role) =>
                  setLocalUsers((users) =>
                    users.map((user) => (user.id === id ? { ...user, role } : user)),
                  )
                }
                onSwitchUser={(id) => loginDemo(id)}
              />
            )}
            {tab === "system" && <SystemPanel />}
            {tab === "audit" && <AuditPanel />}
          </div>
        </section>
      </main>
    </>
  );
}

function AdminMetric({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <p className="mt-3 font-display text-3xl font-semibold text-foreground">{value}</p>
    </div>
  );
}

function UsersPanel({
  users,
  onToggleActive,
  onRoleChange,
  onSwitchUser,
}: {
  users: typeof demoUsers;
  onToggleActive: (id: string) => void;
  onRoleChange: (id: string, role: AuthRole) => void;
  onSwitchUser: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">User</th>
            <th className="px-3 py-2 font-medium">Role</th>
            <th className="px-3 py-2 font-medium">Team</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Last login</th>
            <th className="px-3 py-2 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {users.map((user) => (
            <tr key={user.id}>
              <td className="px-3 py-3">
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-sand text-xs font-semibold text-white">
                    {user.initials}
                  </div>
                  <div>
                    <p className="font-medium text-foreground">{user.name}</p>
                    <p className="text-xs text-muted-foreground">{user.email}</p>
                  </div>
                </div>
              </td>
              <td className="px-3 py-3">
                <select
                  value={user.role}
                  onChange={(event) => onRoleChange(user.id, event.target.value as AuthRole)}
                  className="rounded-md border border-border bg-background px-2 py-1 text-xs"
                >
                  <option>Admin</option>
                  <option>Manager</option>
                  <option>Staff</option>
                </select>
              </td>
              <td className="px-3 py-3 text-muted-foreground">{user.team}</td>
              <td className="px-3 py-3">
                <StatusPill tone={user.active ? "green" : "yellow"}>
                  {user.active ? "Active" : "Inactive"}
                </StatusPill>
              </td>
              <td className="px-3 py-3 text-muted-foreground">
                {new Date(user.lastLoginAt).toLocaleString("en-HK", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </td>
              <td className="px-3 py-3">
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => onSwitchUser(user.id)}
                    className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-accent"
                  >
                    Sign in as
                  </button>
                  <button
                    onClick={() => onToggleActive(user.id)}
                    className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-accent"
                  >
                    {user.active ? "Deactivate" : "Activate"}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SystemPanel() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <SystemCard icon={Building2} title="Firm profile" value="Kossilon" detail="Company secretary operations workspace" />
      <SystemCard icon={Package} title="Service packages" value="3 active packages" detail="Basic, Standard, Premium annual-return services" />
      <SystemCard icon={MessageCircle} title="WhatsApp API" value="WOZTELL configured in Settings" detail="Use Settings for channel and API key management" />
      <SystemCard icon={KeyRound} title="Annual-return actor" value="Server env required" detail="Prototype login does not configure KOSSILON_ANNUAL_RETURN_ACTOR_ID for server-side annual-return actions" />
    </div>
  );
}

function SystemCard({
  icon: Icon,
  title,
  value,
  detail,
}: {
  icon: LucideIcon;
  title: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      <p className="mt-3 text-sm font-medium text-foreground">{value}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</p>
    </div>
  );
}

function AuditPanel() {
  const rows = [
    ["Amy Chan", "Opened admin console", "2026-07-07 09:05"],
    ["Amy Chan", "Reviewed WhatsApp API status", "2026-07-07 09:03"],
    ["Ken Wong", "Signed in as Manager demo", "2026-07-06 17:30"],
  ];

  return (
    <ul className="divide-y divide-border rounded-lg border border-border">
      {rows.map(([actor, action, time]) => (
        <li key={`${actor}-${action}-${time}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">{action}</p>
            <p className="text-xs text-muted-foreground">{actor}</p>
          </div>
          <span className="text-xs text-muted-foreground">{time}</span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: Run focused checks**

Run:

```bash
bunx eslint src/components/app-sidebar.tsx src/routes/admin.tsx
bunx tsc --noEmit --pretty false
```

Expected: both commands exit 0.

- [ ] **Step 4: Commit admin route and navigation**

Run:

```bash
git add src/components/app-sidebar.tsx src/routes/admin.tsx src/routeTree.gen.ts
git commit -m "feat: add prototype admin console"
```

If `src/routeTree.gen.ts` is not modified, omit it from `git add`.

---

### Task 6: Final Verification and Browser Smoke Test

**Files:**
- Verify all files changed in Tasks 1-5.

- [ ] **Step 1: Run all automated checks**

Run:

```bash
bunx eslint src/features/auth/session.ts src/features/auth/session.test.ts src/features/auth/route-guard.ts src/features/auth/route-guard.test.ts src/features/auth/auth-context.tsx src/routes/__root.tsx src/routes/login.tsx src/routes/admin.tsx src/components/top-bar.tsx src/components/app-sidebar.tsx
bunx tsc --noEmit --pretty false
bun run test
bun run build
```

Expected:

- ESLint exits 0.
- TypeScript exits 0.
- Vitest exits 0 with all existing tests plus new auth tests passing.
- Production build exits 0. Existing Vite chunk-size advisory may appear and does not fail the build.

- [ ] **Step 2: Run local dev server**

Run:

```bash
bun run dev -- --host 127.0.0.1 --port 4390
```

Expected:

- Vite prints a local URL for `http://127.0.0.1:4390/`.
- Keep this server running for the next smoke checks.

- [ ] **Step 3: Verify signed-out redirect**

In a browser with local storage cleared for the dev server origin, open:

```text
http://127.0.0.1:4390/
```

Expected:

- App redirects to `/login`.
- Sidebar is not visible on the login page.
- Login form and demo identity buttons are visible.

- [ ] **Step 4: Verify Admin sign-in and admin console**

On `/login`, click the Admin demo identity.

Expected:

- App navigates to `/`.
- Top bar shows Amy Chan and Admin.
- Sidebar includes Admin.
- Opening `/admin` shows the Users, System settings, and Audit preview tabs.
- Users table includes Amy Chan, Ken Wong, and Mei Lam.

- [ ] **Step 5: Verify Staff restricted state**

From `/admin`, use "Sign in as" on Mei Lam or sign out and choose Staff demo from `/login`.

Expected:

- App remains usable.
- Top bar shows Mei Lam and Staff.
- Opening `/admin` shows "Admin access required" with a dashboard link.

- [ ] **Step 6: Verify sign out**

Click the sign-out icon in the top bar.

Expected:

- Session clears.
- App redirects to `/login`.
- Refreshing `/` still redirects to `/login`.

- [ ] **Step 7: Stop dev server**

Stop the Vite server with `Ctrl-C`.

Expected: no dev server session remains running.

- [ ] **Step 8: Final status and commit**

Run:

```bash
git status --short
git diff --check
```

Expected:

- Only intended files are modified or staged.
- `git diff --check` exits 0.
- Pre-existing local changes in `.gitignore`, `src/lib/knowledge-base.ts`, and `.superpowers/` are not included unless the user explicitly asks.

Commit any remaining final route tree or formatting changes:

```bash
git add src/features/auth src/routes/__root.tsx src/routes/login.tsx src/routes/admin.tsx src/components/top-bar.tsx src/components/app-sidebar.tsx src/routeTree.gen.ts
git commit -m "feat: add prototype login and admin"
```

If `src/routeTree.gen.ts` is not modified, omit it from `git add`.
