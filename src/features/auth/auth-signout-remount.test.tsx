// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "./types";

const transport = vi.hoisted(() => ({
  configuration: vi.fn(),
  actor: vi.fn(),
  client: {
    getSession: vi.fn(),
    signOut: vi.fn(),
    signIn: { email: vi.fn(), magicLink: vi.fn(), social: vi.fn() },
  },
}));
const route = vi.hoisted(() => ({
  pathname: "/documents",
  actor: null as AuthenticatedActor | null,
  queryClient: null as QueryClient | null,
  navigate: vi.fn(),
}));
vi.mock("./neon-auth-client", () => ({ createNeonAuthClient: () => transport.client }));
vi.mock("./neon-auth-rpc", () => ({
  getNeonAuthClientConfiguration: transport.configuration,
  getAuthenticatedActor: transport.actor,
}));
vi.mock("./route-guard", async (original) => ({
  ...(await original<typeof import("./route-guard")>()),
  isDemoAuthEnabled: () => false,
}));
vi.mock("@/components/app-sidebar", () => ({
  AppSidebar: function SignOutAction() {
    const { signOut } = useAuth();
    return <button onClick={() => void signOut().catch(() => undefined)}>Sign out</button>;
  },
}));
vi.mock("@/components/app-mobile-nav", () => ({ AppMobileNav: () => null }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  createRootRouteWithContext: () => (options: object) => ({
    options,
    useRouteContext: () => ({ queryClient: route.queryClient!, actor: route.actor }),
  }),
  createFileRoute: () => (options: object) => ({ options }),
  useNavigate: () => route.navigate,
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({
      location: { pathname: route.pathname, searchStr: window.location.search },
    }),
  Outlet: () => (route.pathname === "/login" ? <LoginPage /> : <p>Private A record</p>),
}));

import { AuthProvider, useAuth } from "./auth-context-neon";
import { Route } from "@/routes/__root";
import { LoginPage } from "@/routes/login";
const Root = Route.options.component as ComponentType;
const actor: AuthenticatedActor = {
  authUserId: "auth-A",
  userId: "staff-A",
  role: "Staff",
  teamId: "team-A",
  active: true,
};

function RouteHarness() {
  const [pathname, setPathname] = useState("/documents");
  route.pathname = pathname;
  route.actor = pathname === "/login" ? null : actor;
  route.navigate.mockImplementation(({ href }: { href: string }) => {
    window.history.replaceState(null, "", href);
    setPathname(new URL(href, window.location.origin).pathname);
  });
  return (
    <>
      <button onClick={() => route.navigate({ href: "/login" })}>Remount login actor</button>
      <Root />
    </>
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw new Error("Network access forbidden in auth component tests.");
    }),
  );
  window.history.replaceState(null, "", "/documents");
  window.sessionStorage.clear();
  route.queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  transport.configuration.mockResolvedValue({ url: "https://auth.example.test" });
  transport.client.getSession.mockResolvedValue({
    data: { user: { id: "auth-A", email: "a@example.test", name: "A" } },
    error: null,
  });
  transport.actor.mockResolvedValue(actor);
});
afterEach(() => {
  cleanup();
  route.queryClient?.clear();
  vi.unstubAllGlobals();
});

describe("explicit sign-out across the real root and login components", () => {
  it.each(["success", "failure", "returned error"] as const)(
    "never restores private UI while sign-out is pending or after its %s across actor remounts",
    async (outcome) => {
      let resolve!: (value: { error: null | { status: number } }) => void;
      let reject!: (error: Error) => void;
      transport.client.signOut.mockReturnValueOnce(
        new Promise((yes, no) => {
          resolve = yes;
          reject = no;
        }),
      );
      render(<RouteHarness />);
      await screen.findByText("Private A record");
      route.queryClient!.setQueryData(["private"], "A private cached record");
      fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
      await waitFor(() => expect(transport.client.signOut).toHaveBeenCalledOnce());
      fireEvent.click(screen.getByRole("button", { name: "Remount login actor" }));
      await waitFor(() =>
        expect(transport.configuration.mock.calls.length).toBeGreaterThanOrEqual(2),
      );
      await act(async () => undefined);
      expect(screen.queryByText("Private A record")).toBeNull();
      expect(route.queryClient!.getQueryData(["private"])).toBeUndefined();

      await act(async () => {
        if (outcome === "success") resolve({ error: null });
        else if (outcome === "returned error") resolve({ error: { status: 503 } });
        else reject(new Error("Synthetic sign-out unavailable"));
      });
      await act(async () => undefined);
      expect(screen.queryByText("Private A record")).toBeNull();
      if (outcome !== "success") expect(screen.getByRole("alert").textContent).toContain("登出");
    },
  );

  it("keeps failed sign-out closed across another remount and retries only on explicit recovery", async () => {
    transport.client.signOut.mockRejectedValueOnce(new Error("Synthetic sign-out failure"));
    render(<RouteHarness />);
    await screen.findByText("Private A record");
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Remount login actor" }));
    await screen.findByRole("button", { name: "重試登入狀態" });
    await act(async () => undefined);
    expect(screen.queryByText("Private A record")).toBeNull();
    expect(transport.client.signOut).toHaveBeenCalledOnce();

    transport.client.signOut.mockResolvedValueOnce({ error: null });
    fireEvent.click(screen.getByRole("button", { name: "重試登入狀態" }));
    await waitFor(() => expect(transport.client.signOut).toHaveBeenCalledTimes(2));
    await act(async () => undefined);
    expect(screen.queryByText("Private A record")).toBeNull();
    expect(screen.queryByRole("button", { name: "重試登入狀態" })).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("已登出");
  });

  it("retains the sign-out fence after timeout and a late success", async () => {
    let finish!: (value: { error: null }) => void;
    transport.client.signOut.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<RouteHarness />);
    await screen.findByText("Private A record");
    vi.useFakeTimers();
    try {
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_001);
      });
      expect(screen.getByRole("alert").textContent).toContain("登出");
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Remount login actor" }));
      });
      await act(async () => {
        finish({ error: null });
      });
      expect(screen.queryByText("Private A record")).toBeNull();
      expect(screen.getByRole("alert").textContent).toContain("登出");
    } finally {
      vi.useRealTimers();
    }
  });

  it("allows a new explicit verified sign-in after confirmed sign-out", async () => {
    function AccountActions() {
      const auth = useAuth();
      return (
        <>
          <p>{auth.session ? `Account ${auth.session.id}` : "No account"}</p>
          <button onClick={() => void auth.signOut()}>Sign out</button>
          <button onClick={() => void auth.retrySession()}>Read session</button>
          <button onClick={() => void auth.login("b@example.test", "synthetic-secret")}>
            Sign in B
          </button>
        </>
      );
    }
    transport.client.signOut.mockResolvedValueOnce({ error: null });
    render(
      <QueryClientProvider client={route.queryClient!}>
        <AuthProvider queryClient={route.queryClient!}>
          <AccountActions />
        </AuthProvider>
      </QueryClientProvider>,
    );
    await screen.findByText("Account staff-A");
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await act(async () => undefined);
    fireEvent.click(screen.getByRole("button", { name: "Read session" }));
    await act(async () => undefined);
    expect(screen.getByText("No account")).toBeTruthy();
    transport.client.signIn.email.mockResolvedValueOnce({ error: null });
    transport.client.getSession.mockResolvedValue({
      data: { user: { id: "auth-B", email: "b@example.test", name: "B" } },
      error: null,
    });
    transport.actor.mockResolvedValue({ ...actor, authUserId: "auth-B", userId: "staff-B" });
    fireEvent.click(screen.getByRole("button", { name: "Sign in B" }));
    expect(await screen.findByText("Account staff-B")).toBeTruthy();
  });
});
