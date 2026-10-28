// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "./types";
import type { DataMode } from "@/features/runtime/data-mode";

const rpc = vi.hoisted(() => ({
  configuration: vi.fn(),
  actor: vi.fn(),
  client: {
    getSession: vi.fn(),
    signOut: vi.fn(),
    signIn: { email: vi.fn(), magicLink: vi.fn(), social: vi.fn() },
  },
}));
vi.mock("./neon-auth-client", () => ({ createNeonAuthClient: () => rpc.client }));
vi.mock("./neon-auth-rpc", () => ({
  getNeonAuthClientConfiguration: rpc.configuration,
  getAuthenticatedActor: rpc.actor,
}));
vi.mock("./route-guard", async (original) => ({
  ...(await original<typeof import("./route-guard")>()),
  isDemoAuthEnabled: () => false,
}));
vi.mock("@/components/app-sidebar", () => ({
  AppSidebar: function SignOutControl() {
    const { signOut } = useAuth();
    return <button onClick={() => void signOut().catch(() => undefined)}>Sign out</button>;
  },
}));
vi.mock("@/components/app-mobile-nav", () => ({ AppMobileNav: () => null }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));

import { useAuth } from "./auth-context-neon";
import { Route as AppRoot } from "@/routes/__root";
import { LoginPage } from "@/routes/login";

const actorA: AuthenticatedActor = {
  authUserId: "auth-A",
  userId: "staff-A",
  role: "Staff",
  teamId: "team-A",
  active: true,
};
const actorB: AuthenticatedActor = { ...actorA, authUserId: "auth-B", userId: "staff-B" };
let activeActor = actorA;
let actorReadFails = false;
const clients: QueryClient[] = [];
const unsubscribers: (() => void)[] = [];
const locations: string[] = [];

function PrivateOutlet() {
  return <p>Private account {useAuth().session?.id}</p>;
}
// This composition exercises denied recovery after a provider is hydrated,
// independently of the initial bootstrap. Direct-entry bootstrap is tested too.
function HydratedLogin() {
  const { isHydrated } = useAuth();
  const [opened, setOpened] = useState(false);
  useEffect(() => {
    if (isHydrated) setOpened(true);
  }, [isHydrated]);
  return opened ? <LoginPage /> : <p>Preparing login</p>;
}

// Expire the outstanding auth deadline without virtualizing the router's own
// scheduling while its real error boundary is mounting.
function controlAuthDeadline() {
  const active = new Map<ReturnType<typeof setTimeout>, () => void>();
  const schedule = globalThis.setTimeout;
  const cancel = globalThis.clearTimeout;
  vi.spyOn(globalThis, "setTimeout").mockImplementation((callback, delay, ...args) => {
    const id = schedule(callback, delay, ...args);
    if (delay === 10_000) active.set(id, () => callback(...args));
    return id;
  });
  vi.spyOn(globalThis, "clearTimeout").mockImplementation((id) => {
    active.delete(id as ReturnType<typeof setTimeout>);
    cancel(id);
  });
  return () => {
    if (active.size !== 1)
      throw new Error(`Expected one outstanding auth deadline, found ${active.size}`);
    const [id, expire] = [...active][0]!;
    cancel(id);
    expire();
  };
}
async function mountRouter(path = "/documents", hydratedLogin = false, beforeRender?: () => void) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(queryClient);
  const root = createRootRouteWithContext<{
    queryClient: QueryClient;
    dataMode: DataMode;
    actor: AuthenticatedActor | null;
  }>()({
    beforeLoad: AppRoot.options.beforeLoad,
    component: AppRoot.options.component,
    errorComponent: AppRoot.options.errorComponent,
  });
  const documents = createRoute({
    getParentRoute: () => root,
    path: "/documents",
    component: PrivateOutlet,
  });
  const next = createRoute({ getParentRoute: () => root, path: "/next", component: PrivateOutlet });
  const login = createRoute({
    getParentRoute: () => root,
    path: "/login",
    component: hydratedLogin ? HydratedLogin : LoginPage,
  });
  const today = createRoute({
    getParentRoute: () => root,
    path: "/today",
    component: PrivateOutlet,
  });
  const history = createMemoryHistory({ initialEntries: [path] });
  window.history.replaceState(null, "", path);
  unsubscribers.push(
    history.subscribe(({ location }) => {
      locations.push(location.href);
      window.history.replaceState(null, "", location.href);
    }),
  );
  const router = createRouter({
    routeTree: root.addChildren([documents, next, login, today]),
    history,
    context: { queryClient, dataMode: "production", actor: null },
    defaultPendingMinMs: 0,
  });
  await router.load();
  beforeRender?.();
  await act(async () => {
    render(<RouterProvider router={router} />);
  });
  return { router, queryClient };
}
beforeEach(() => {
  vi.resetAllMocks();
  activeActor = actorA;
  actorReadFails = false;
  locations.length = 0;
  window.sessionStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network forbidden in auth recovery unit tests.");
    }),
  );
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  rpc.configuration.mockResolvedValue({ url: "https://auth.example.test" });
  rpc.actor.mockImplementation(async () => {
    if (actorReadFails)
      throw Object.assign(new Error("Synthetic actor unavailable"), { status: 503 });
    return activeActor;
  });
  rpc.client.getSession.mockImplementation(async () => ({
    data: {
      user: {
        id: activeActor.authUserId,
        email: activeActor === actorA ? "a@example.test" : "b@example.test",
        name: "Synthetic staff",
      },
    },
    error: null,
  }));
  rpc.client.signIn.email.mockImplementation(async () => {
    activeActor = actorB;
    return { error: null };
  });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("REVIEW-3 actual router auth recovery", () => {
  it.each(["pending", "rejected", "timeout", "timeout while error"] as const)(
    "retains sign-out through root error Retry while remote sign-out is %s",
    async (outcome) => {
      let complete!: (value: { error: null }) => void;
      let reject!: (error: Error) => void;
      rpc.client.signOut.mockReturnValueOnce(
        new Promise((resolve, no) => {
          complete = resolve;
          reject = no;
        }),
      );
      const { router, queryClient } = await mountRouter();
      await screen.findByText("Private account staff-A");
      queryClient.setQueryData(["private"], "A private cached row");
      const expire = outcome === "timeout while error" ? controlAuthDeadline() : undefined;
      if (outcome === "timeout") vi.useFakeTimers();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
      });
      expect(rpc.client.signOut).toHaveBeenCalledOnce();
      try {
        if (outcome === "rejected")
          await act(async () => {
            reject(new Error("Synthetic logout failure"));
          });
        if (outcome === "timeout") {
          await act(async () => {
            await vi.advanceTimersByTimeAsync(10_001);
          });
          vi.useRealTimers();
        }
        const configurationCount = rpc.configuration.mock.calls.length;
        actorReadFails = true;
        await act(async () => {
          await router.navigate({ href: "/next" });
        });
        await screen.findByText("發生錯誤");
        if (outcome === "timeout while error") {
          await act(async () => {
            expire!();
          });
        }
        actorReadFails = false;
        fireEvent.click(screen.getByRole("button", { name: "重試" }));
        await waitFor(() =>
          expect(rpc.configuration.mock.calls.length).toBeGreaterThan(configurationCount),
        );
        await act(async () => undefined);
        expect(screen.queryByText("Private account staff-A")).toBeNull();
        expect(queryClient.getQueryData(["private"])).toBeUndefined();
        if (outcome !== "pending") expect(screen.getByRole("alert").textContent).toContain("登出");
        else expect(screen.getByText("正在核對登入狀態…")).toBeTruthy();
      } finally {
        await act(async () => {
          complete({ error: null });
        });
      }
    },
  );

  it.each(["rejected", "returned error", "timeout"] as const)(
    "finishes denied recovery after %s and reaches B's safe destination",
    async (outcome) => {
      let finish!: (value: { error: null }) => void;
      if (outcome === "rejected")
        rpc.client.signOut.mockRejectedValueOnce(new Error("Synthetic logout failure"));
      else if (outcome === "returned error")
        rpc.client.signOut.mockResolvedValueOnce({ error: { status: 503 } });
      else
        rpc.client.signOut.mockReturnValueOnce(
          new Promise((resolve) => {
            finish = resolve;
          }),
        );
      const target = "/documents?from=recovery";
      const { router } = await mountRouter(
        `/login?denied=1&redirect=${encodeURIComponent(target)}`,
        true,
        outcome === "timeout" ? () => vi.useFakeTimers() : undefined,
      );
      expect(rpc.client.signOut).toHaveBeenCalledOnce();
      if (outcome === "timeout") {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(10_001);
        });
        vi.useRealTimers();
      }
      const recovery = await screen.findByRole("button", { name: "重試登入狀態" });
      expect(new URLSearchParams(window.location.search).get("denied")).toBe("1");
      rpc.client.signOut.mockResolvedValueOnce({ error: null });
      fireEvent.click(recovery);
      await waitFor(() => expect(rpc.client.signOut).toHaveBeenCalledTimes(2));
      await act(async () => undefined);
      expect(new URLSearchParams(window.location.search).get("redirect")).toBe(target);
      fireEvent.change(screen.getByLabelText("電郵"), { target: { value: "b@example.test" } });
      fireEvent.change(screen.getByLabelText("密碼"), { target: { value: "synthetic-secret" } });
      fireEvent.click(screen.getByRole("button", { name: "登入" }));
      try {
        await screen.findByText("Private account staff-B");
        expect(router.state.location.pathname, locations.join(" -> ")).toBe("/documents");
        expect(new URLSearchParams(window.location.search).get("from")).toBe("recovery");
        expect(new URLSearchParams(window.location.search).has("denied")).toBe(false);
      } finally {
        if (finish)
          await act(async () => {
            finish({ error: null });
          });
      }
    },
  );

  it("waits for the actual auth provider before automatic denied sign-out on a direct login entry", async () => {
    let rejectSignOut!: (reason: Error) => void;
    rpc.configuration.mockRejectedValueOnce(new Error("Synthetic configuration failure"));
    rpc.client.signOut.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectSignOut = reject;
        }),
    );
    await mountRouter("/login?denied=1&redirect=%2Fdocuments");
    await act(async () => undefined);
    expect(screen.queryByText("Private account staff-A")).toBeNull();
    expect(new URLSearchParams(window.location.search).get("denied")).toBe("1");
    expect(rpc.client.signOut).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重試登入狀態" }));
    await waitFor(() => expect(rpc.client.signOut).toHaveBeenCalledOnce());
    expect(screen.queryByText("Private account staff-A")).toBeNull();
    expect(new URLSearchParams(window.location.search).get("denied")).toBe("1");
    expect(rpc.client.signOut).toHaveBeenCalledOnce();
    try {
      // A provider call starting does not mean its rejection has rendered.
      expect(screen.queryByRole("button", { name: "重試登入狀態" })).toBeNull();
    } finally {
      await act(async () => {
        rejectSignOut(new Error("Synthetic logout failure"));
      });
    }
    expect(await screen.findByRole("button", { name: "重試登入狀態" })).toBeTruthy();
    expect(screen.queryByText("Private account staff-A")).toBeNull();
    expect(new URLSearchParams(window.location.search).get("denied")).toBe("1");
    expect(rpc.client.signOut).toHaveBeenCalledOnce();
  });

  it("does not share one router client's failed sign-out intent with a separate router client", async () => {
    rpc.client.signOut.mockRejectedValueOnce(new Error("Synthetic logout failure"));
    await mountRouter();
    await screen.findByText("Private account staff-A");
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByRole("alert");
    cleanup();
    await mountRouter();
    expect(await screen.findByText("Private account staff-A")).toBeTruthy();
  });
});
