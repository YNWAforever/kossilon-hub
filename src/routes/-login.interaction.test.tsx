// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/features/auth/session";

const navigate = vi.fn();
const login = vi.fn();
const loginWithMagicLink = vi.fn();
const loginDemo = vi.fn();
const loginWithGoogle = vi.fn();
const signOut = vi.fn().mockResolvedValue(undefined);
const retrySession = vi.fn();
let mockAuthIssue: { kind: string; message: string } | null = null;

// Mutable so individual tests (the still-valid-session race in particular) can
// simulate a hydrated AuthProvider that already carries a truthy session, which
// is the realistic way `?denied=1` is ever reached — see route-guard.ts's
// isForbiddenAuthError comment: Forbidden implies a session already exists.
let mockSession: AuthSession | null = null;
let mockIsHydrated = true;

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-router")>();
  return {
    ...actual,
    createFileRoute: () => (options: unknown) => ({ options }),
    useNavigate: () => navigate,
  };
});

vi.mock("@/features/auth/auth-context-neon", () => ({
  useAuth: () => ({
    session: mockSession,
    isHydrated: mockIsHydrated,
    demoUsers: [],
    login,
    loginWithMagicLink,
    loginDemo,
    loginWithGoogle,
    signOut,
    authIssue: mockAuthIssue,
    retrySession,
  }),
}));

import { Route } from "./login";

const LoginPage = Route.options.component as ComponentType;

function enterEmail(email: string) {
  fireEvent.change(screen.getByLabelText("電郵"), { target: { value: email } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VITE_ENABLE_DEMO_AUTH", "false");
  mockSession = null;
  mockIsHydrated = true;
  mockAuthIssue = null;
  retrySession.mockResolvedValue({ ok: true });
  login.mockResolvedValue({ ok: true });
  loginWithMagicLink.mockResolvedValue({
    ok: true,
    message: "請查看電郵中的登入連結。",
  });
  loginDemo.mockResolvedValue({ ok: true });
  loginWithGoogle.mockResolvedValue({ ok: true });
});

describe("LoginPage", () => {
  it("explains a transient session failure and retries without losing a safe return", async () => {
    const originalHref = window.location.href;
    history.replaceState(null, "", "/login?redirect=%2Fdocuments%3Fsearch%3Dannual");
    mockAuthIssue = { kind: "service", message: "登入服務暫時無法使用，請重試。" };
    retrySession.mockImplementation(async () => {
      mockAuthIssue = null;
      mockSession = {
        id: "A",
        name: "User",
        email: "a@example.test",
        role: "Staff",
        initials: "U",
        team: "A",
        signedInAt: "2026-10-23T00:00:00Z",
      };
      return { ok: true };
    });
    try {
      render(<LoginPage />);
      expect(screen.getByRole("alert").textContent).toContain("登入服務暫時無法使用");
      expect(navigate).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "重試登入狀態" }));
      await waitFor(() =>
        expect(navigate).toHaveBeenCalledWith({
          href: "/documents?search=annual",
          replace: true,
        }),
      );
    } finally {
      history.replaceState(null, "", originalHref);
    }
  });

  it("explains an expired callback without reporting sign-in success", () => {
    mockAuthIssue = { kind: "unauthenticated", message: "登入連結已過期，請重新登入。" };
    render(<LoginPage />);
    expect(screen.getByRole("alert").textContent).toContain("已過期");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("explains the magic-link provider's expired callback without exposing its query details", () => {
    const originalHref = window.location.href;
    history.replaceState(
      null,
      "",
      "/login?error=TOKEN_EXPIRED&error_description=private-unit-token",
    );
    try {
      render(<LoginPage />);
      expect(screen.getByRole("alert").textContent).toContain("登入連結已過期或無效");
      expect(screen.queryByText(/private-unit-token/)).toBeNull();
      expect(navigate).not.toHaveBeenCalled();
    } finally {
      history.replaceState(null, "", originalHref);
    }
  });

  it("recovers Google controls after a rejected request", async () => {
    loginWithGoogle.mockRejectedValueOnce(new Error("Network unavailable"));
    render(<LoginPage />);
    fireEvent.click(screen.getByRole("button", { name: "以 Google 帳戶登入" }));
    expect((await screen.findByRole("alert")).textContent).toContain("未能完成登入要求");
    expect(
      (screen.getByRole("button", { name: "以 Google 帳戶登入" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it.each(["Admin", "Manager", "Staff", "Client"] as const)(
    "uses daily role landing for %s without an explicit return",
    async (role) => {
      const originalHref = window.location.href;
      history.replaceState(null, "", "/login");
      window.sessionStorage.clear();
      mockSession = {
        id: "controlled-local",
        name: "Local",
        email: "local@example.test",
        role,
        initials: "L",
        team: "x",
        signedInAt: "2026-10-02T00:00:00Z",
      };
      try {
        render(<LoginPage />);
        await waitFor(() =>
          expect(navigate).toHaveBeenCalledWith({
            href: role === "Client" ? "/portal" : "/today",
            replace: true,
          }),
        );
      } finally {
        history.replaceState(null, "", originalHref);
      }
    },
  );
  it("lands demo staff on the populated dashboard instead of the empty 今日工作", async () => {
    const originalHref = window.location.href;
    history.replaceState(null, "", "/login");
    window.sessionStorage.clear();
    vi.stubEnv("VITE_ENABLE_DEMO_AUTH", "true");
    mockSession = {
      id: "controlled-local",
      name: "Local",
      email: "local@example.test",
      role: "Staff",
      initials: "L",
      team: "x",
      signedInAt: "2026-10-02T00:00:00Z",
    };
    try {
      render(<LoginPage />);
      await waitFor(() => expect(navigate).toHaveBeenCalledWith({ href: "/", replace: true }));
    } finally {
      vi.unstubAllEnvs();
      history.replaceState(null, "", originalHref);
    }
  });
  it("preserves an explicit dashboard return rather than treating slash as absence", async () => {
    const originalHref = window.location.href;
    history.replaceState(null, "", "/login?redirect=%2F");
    window.sessionStorage.clear();
    mockSession = {
      id: "controlled-local",
      name: "Local",
      email: "local@example.test",
      role: "Staff",
      initials: "L",
      team: "x",
      signedInAt: "2026-10-02T00:00:00Z",
    };
    try {
      render(<LoginPage />);
      await waitFor(() => expect(navigate).toHaveBeenCalledWith({ href: "/", replace: true }));
    } finally {
      history.replaceState(null, "", originalHref);
    }
  });
  it("shows magic link and Google by default (a real Neon Auth backend)", () => {
    render(<LoginPage />);

    expect(screen.getByRole("button", { name: "電郵登入連結" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "以 Google 帳戶登入" })).toBeTruthy();
  });

  it("hides magic link and Google under the fixture demo-auth provider", () => {
    vi.stubEnv("VITE_ENABLE_DEMO_AUTH", "true");
    render(<LoginPage />);

    expect(screen.queryByRole("button", { name: "電郵登入連結" })).toBeNull();
    expect(screen.queryByRole("button", { name: "以 Google 帳戶登入" })).toBeNull();
    expect(screen.queryByRole("link", { name: "申請邀請" })).toBeNull();
  });

  it("switches to magic-link mode and requests a link", async () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole("button", { name: "電郵登入連結" }));
    enterEmail("staff@example.com");
    fireEvent.click(screen.getByRole("button", { name: "以電郵傳送登入連結" }));

    await waitFor(() => expect(loginWithMagicLink).toHaveBeenCalledWith("staff@example.com"));
    expect(await screen.findByText("請查看電郵中的登入連結。")).toBeTruthy();
  });

  it("renders a provider error from a magic-link request", async () => {
    loginWithMagicLink.mockResolvedValue({ ok: false, error: "Invitation required." });
    render(<LoginPage />);
    fireEvent.click(screen.getByRole("button", { name: "電郵登入連結" }));
    enterEmail("staff@example.com");
    fireEvent.click(screen.getByRole("button", { name: "以電郵傳送登入連結" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Invitation required.");
  });

  it("hides the password input in magic-link mode", () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole("button", { name: "電郵登入連結" }));

    expect(screen.queryByLabelText("密碼")).toBeNull();
  });

  it("keeps password login behavior", async () => {
    render(<LoginPage />);
    enterEmail("staff@example.com");
    fireEvent.change(screen.getByLabelText("密碼"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "登入" }));

    await waitFor(() => expect(login).toHaveBeenCalledWith("staff@example.com", "secret"));
  });

  it("recovers controls after a rejected magic-link request", async () => {
    loginWithMagicLink.mockRejectedValueOnce(new Error("Network unavailable"));
    render(<LoginPage />);
    fireEvent.click(screen.getByRole("button", { name: "電郵登入連結" }));
    enterEmail("staff@example.com");
    fireEvent.click(screen.getByRole("button", { name: "以電郵傳送登入連結" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "未能完成登入要求，請再試一次。",
    );
    const submitButton = screen.getByRole("button", {
      name: "以電郵傳送登入連結",
    }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(false);
  });

  it("links invitation requests to the firm contact", () => {
    render(<LoginPage />);

    expect(screen.getByRole("link", { name: "申請邀請" }).getAttribute("href")).toBe(
      "mailto:willylai@fimmick.com?subject=Kossilon%20demo%20invitation%20request",
    );
  });

  it("requests Google sign-in and surfaces a provider error", async () => {
    loginWithGoogle.mockResolvedValue({ ok: false, error: "Google sign-in is not configured." });
    render(<LoginPage />);

    fireEvent.click(screen.getByRole("button", { name: "以 Google 帳戶登入" }));

    await waitFor(() => expect(loginWithGoogle).toHaveBeenCalledTimes(1));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Google sign-in is not configured.",
    );
  });
});

describe("LoginPage denied state", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_ENABLE_DEMO_AUTH", "false");
  });

  it("signs out and explains the account has no access", async () => {
    const originalLocation = window.location;
    // Window.location's setter only accepts a string (see lib.dom.d.ts), so a
    // direct assignment of a Location-shaped object doesn't type-check even
    // after deleting the property. Object.defineProperty sidesteps that.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, search: "?denied=1" },
    });

    try {
      render(<LoginPage />);

      await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
      expect(screen.getByRole("alert").textContent).toContain("未獲授權使用");
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });

  it("does not show the denied message without the query param", () => {
    render(<LoginPage />);
    expect(screen.queryByText(/未獲授權使用/)).toBeNull();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("does not navigate away even when a still-valid session is present", async () => {
    // Forbidden means "authenticates but isn't provisioned", so the session
    // that AuthProvider already holds (carried over from immediately before
    // the client-side redirect, since AuthProvider wraps this route and never
    // remounts) is still truthy at this exact moment. This is the realistic —
    // by construction, the only — way ?denied=1 is reached in practice.
    mockSession = {
      id: "u1",
      name: "Test User",
      email: "test@example.test",
      role: "Client",
      initials: "TU",
      team: "x",
      signedInAt: "2026-01-01T00:00:00.000Z",
    };

    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...originalLocation, search: "?denied=1" },
    });

    try {
      render(<LoginPage />);

      await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
      expect(navigate).not.toHaveBeenCalled();
      expect(screen.getByRole("alert").textContent).toContain("未獲授權使用");
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });

  it("allows navigating away after successfully signing in as a different account", async () => {
    // Starts from the same stale-but-still-valid session as the race test
    // above, then drives the actual recovery path the denied banner
    // advertises ("sign in with a different account below") through the
    // rendered form, exactly like "keeps password login behavior" above does.
    //
    // This test uses real history.pushState/replaceState instead of the
    // Object.defineProperty(window, "location", {value: ...}) stub the other
    // denied-state tests use. That stub replaces window.location with an
    // inert plain object entirely disconnected from jsdom's navigation
    // machinery, so a real history.replaceState call (which is what the fix
    // below performs) would silently do nothing observable to it. Verified
    // separately that jsdom's history.pushState/replaceState do genuinely
    // update window.location when the property hasn't been replaced with
    // that stub, which is exactly what this test needs to observe: that the
    // denied effect's own history.replaceState call actually clears the
    // marker, and that doing so is what lets the redirect effect fire once a
    // fresh session for a different account arrives.
    mockSession = {
      id: "u1",
      name: "Stale User",
      email: "stale@example.test",
      role: "Client",
      initials: "SU",
      team: "x",
      signedInAt: "2026-01-01T00:00:00.000Z",
    };
    const originalHref = window.location.href;
    history.pushState(null, "", "/login?denied=1");

    // Mirrors what NeonAuthProvider's real login() does on success: it
    // resolves a fresh, provisioned session, which is what makes the
    // redirect effect's `session` dependency change on this same mounted
    // instance -- exactly the mechanism the regression exploited.
    login.mockImplementation(async () => {
      mockSession = {
        id: "u2",
        name: "Different User",
        email: "different@example.test",
        role: "Staff",
        initials: "DU",
        team: "x",
        signedInAt: "2026-01-01T00:00:00.000Z",
      };
      return { ok: true };
    });

    try {
      render(<LoginPage />);

      await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
      expect(screen.getByRole("alert").textContent).toContain("未獲授權使用");
      // Confirm the fix actually cleared the URL marker before relying on
      // that below -- otherwise this test could pass for the wrong reason.
      await waitFor(() =>
        expect(new URLSearchParams(window.location.search).get("denied")).toBeNull(),
      );

      enterEmail("different@example.test");
      fireEvent.change(screen.getByLabelText("密碼"), { target: { value: "secret" } });
      fireEvent.click(screen.getByRole("button", { name: "登入" }));

      await waitFor(() => expect(navigate).toHaveBeenCalled());
    } finally {
      history.replaceState(null, "", originalHref);
    }
  });
});
