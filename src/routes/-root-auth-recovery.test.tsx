// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState, type ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/features/auth/types";
import type { AuthSession } from "@/features/auth/session";

const mocks = vi.hoisted(() => ({
  getActor: vi.fn(),
  navigate: vi.fn(),
  retrySession: vi.fn(),
  context: {} as { queryClient: QueryClient; actor: AuthenticatedActor | null },
  auth: {} as {
    session: AuthSession | null;
    isHydrated: boolean;
    authIssue: { kind: string; message: string } | null;
    retrySession: () => Promise<unknown>;
  },
}));
vi.mock("@/features/auth/neon-auth-rpc", () => ({ getAuthenticatedActor: mocks.getActor }));
vi.mock("@/features/auth/auth-context-neon", async (original) => ({
  ...(await original<typeof import("@/features/auth/auth-context-neon")>()),
  AuthProvider: ({ children }: { children: import("react").ReactNode }) => children,
  useAuth: () => mocks.auth,
}));
vi.mock("@/components/app-sidebar", () => ({ AppSidebar: () => null }));
vi.mock("@/components/app-mobile-nav", () => ({ AppMobileNav: () => null }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  createRootRouteWithContext: () => (options: unknown) => ({
    options,
    useRouteContext: () => mocks.context,
  }),
  useNavigate: () => mocks.navigate,
  useRouterState: () => "/documents?search=annual",
  Outlet: function Selection() {
    const [selected, setSelected] = useState(false);
    return (
      <button onClick={() => setSelected(true)}>
        {selected ? "A case selected" : "Select case"}
      </button>
    );
  },
}));

import { Route } from "./__root";
const load = Route.options.beforeLoad as unknown as (args: {
  context: { queryClient: QueryClient; dataMode: "production" };
  location: { pathname: string; href: string };
}) => Promise<unknown>;
const Root = Route.options.component as ComponentType;
const actor: AuthenticatedActor = {
  authUserId: "auth-A",
  userId: "staff-A",
  role: "Staff",
  teamId: "A",
  active: true,
};
const session: AuthSession = {
  id: "staff-A",
  name: "A",
  email: "a@example.test",
  role: "Staff",
  team: "A",
  initials: "A",
  signedInAt: "2026-10-23T00:00:00Z",
};
const args = () => ({
  context: { queryClient: mocks.context.queryClient, dataMode: "production" as const },
  location: { pathname: "/documents", href: "/documents?search=annual" },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.context = { queryClient: new QueryClient(), actor };
  mocks.auth = { session, isHydrated: true, authIssue: null, retrySession: mocks.retrySession };
  mocks.getActor.mockResolvedValue(actor);
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("verified root auth recovery", () => {
  it("preserves the current route on actor 503 instead of sending it through sign-in", async () => {
    const failure = Object.assign(new Error("Service unavailable"), { status: 503 });
    mocks.getActor.mockRejectedValueOnce(failure);
    await expect(load(args())).rejects.toMatchObject({ message: "登入服務暫時無法使用，請重試。" });
  });

  it.each([
    [new Error("Unauthorized: session expired."), "/login?redirect=%2Fdocuments%3Fsearch%3Dannual"],
    [{ status: 401 }, "/login?redirect=%2Fdocuments%3Fsearch%3Dannual"],
    [new Error("Forbidden: inactive."), "/login?denied=1&redirect=%2Fdocuments%3Fsearch%3Dannual"],
    [{ status: 403 }, "/login?denied=1&redirect=%2Fdocuments%3Fsearch%3Dannual"],
  ])("routes definitive auth failure %s explicitly", async (failure, href) => {
    mocks.getActor.mockRejectedValueOnce(failure);
    await expect(load(args())).rejects.toMatchObject({ options: { href, replace: true } });
  });

  it("bounds a stalled actor read", async () => {
    vi.useFakeTimers();
    mocks.getActor.mockReturnValueOnce(new Promise(() => undefined));
    const result = load(args()).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await result).toMatchObject({ message: "登入服務暫時無法使用，請重試。" });
  });

  it("shows session-service retry in the protected shell without redirecting", async () => {
    mocks.auth = {
      ...mocks.auth,
      session: null,
      authIssue: {
        kind: "service",
        message: "登入服務暫時無法使用，請重試。",
      },
    };
    render(<Root />);
    expect(screen.getByRole("alert").textContent).toContain("登入服務暫時無法使用");
    fireEvent.click(screen.getByRole("button", { name: "重試登入狀態" }));
    await waitFor(() => expect(mocks.retrySession).toHaveBeenCalledOnce());
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(screen.queryByText("Select case")).toBeNull();
  });

  it("drops component selection when the actor changes in the mounted shell", async () => {
    const view = render(<Root />);
    fireEvent.click(screen.getByText("Select case"));
    expect(screen.getByText("A case selected")).toBeTruthy();
    mocks.context = {
      ...mocks.context,
      actor: { ...actor, authUserId: "auth-B", userId: "staff-B" },
    };
    mocks.auth = { ...mocks.auth, session: { ...session, id: "staff-B" } };
    await act(async () => {
      view.rerender(<Root />);
    });
    expect(screen.queryByText("A case selected")).toBeNull();
    expect(screen.getByText("Select case")).toBeTruthy();
  });

  it("drops selection when the verified route actor changes before session hydration catches up", () => {
    const view = render(<Root />);
    fireEvent.click(screen.getByText("Select case"));
    mocks.context = {
      ...mocks.context,
      actor: { ...actor, authUserId: "auth-B", userId: "staff-B" },
    };
    view.rerender(<Root />);
    expect(screen.queryByText("A case selected")).toBeNull();
    expect(screen.getByText("Select case")).toBeTruthy();
  });
});
