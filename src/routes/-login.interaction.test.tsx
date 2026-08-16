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
  }),
}));

import { Route } from "./login";

const LoginPage = Route.options.component as ComponentType;

function enterEmail(email: string) {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
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
  login.mockResolvedValue({ ok: true });
  loginWithMagicLink.mockResolvedValue({
    ok: true,
    message: "Check your email for a magic link.",
  });
  loginDemo.mockResolvedValue({ ok: true });
  loginWithGoogle.mockResolvedValue({ ok: true });
});

describe("LoginPage", () => {
  it("shows magic link and Google by default (a real Neon Auth backend)", () => {
    render(<LoginPage />);

    expect(screen.getByRole("button", { name: "Magic link" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeTruthy();
  });

  it("hides magic link and Google under the fixture demo-auth provider", () => {
    vi.stubEnv("VITE_ENABLE_DEMO_AUTH", "true");
    render(<LoginPage />);

    expect(screen.queryByRole("button", { name: "Magic link" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue with Google" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Request an invitation" })).toBeNull();
  });

  it("switches to magic-link mode and requests a link", async () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole("button", { name: "Magic link" }));
    enterEmail("staff@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Email me a magic link" }));

    await waitFor(() => expect(loginWithMagicLink).toHaveBeenCalledWith("staff@example.com"));
    expect(await screen.findByText("Check your email for a magic link.")).toBeTruthy();
  });

  it("renders a provider error from a magic-link request", async () => {
    loginWithMagicLink.mockResolvedValue({ ok: false, error: "Invitation required." });
    render(<LoginPage />);
    fireEvent.click(screen.getByRole("button", { name: "Magic link" }));
    enterEmail("staff@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Email me a magic link" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Invitation required.");
  });

  it("hides the password input in magic-link mode", () => {
    render(<LoginPage />);
    fireEvent.click(screen.getByRole("button", { name: "Magic link" }));

    expect(screen.queryByLabelText("Password")).toBeNull();
  });

  it("keeps password login behavior", async () => {
    render(<LoginPage />);
    enterEmail("staff@example.com");
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(login).toHaveBeenCalledWith("staff@example.com", "secret"));
  });

  it("recovers controls after a rejected magic-link request", async () => {
    loginWithMagicLink.mockRejectedValueOnce(new Error("Network unavailable"));
    render(<LoginPage />);
    fireEvent.click(screen.getByRole("button", { name: "Magic link" }));
    enterEmail("staff@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Email me a magic link" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Unable to complete sign-in request. Please try again.",
    );
    const submitButton = screen.getByRole("button", {
      name: "Email me a magic link",
    }) as HTMLButtonElement;
    expect(submitButton.disabled).toBe(false);
  });

  it("links invitation requests to the firm contact", () => {
    render(<LoginPage />);

    expect(screen.getByRole("link", { name: "Request an invitation" }).getAttribute("href")).toBe(
      "mailto:willylai@fimmick.com?subject=Kossilon%20demo%20invitation%20request",
    );
  });

  it("requests Google sign-in and surfaces a provider error", async () => {
    loginWithGoogle.mockResolvedValue({ ok: false, error: "Google sign-in is not configured." });
    render(<LoginPage />);

    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));

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
      expect(screen.getByRole("alert").textContent).toContain("does not have access");
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });

  it("does not show the denied message without the query param", () => {
    render(<LoginPage />);
    expect(screen.queryByText(/does not have access/i)).toBeNull();
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
      expect(screen.getByRole("alert").textContent).toContain("does not have access");
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: originalLocation });
    }
  });
});
