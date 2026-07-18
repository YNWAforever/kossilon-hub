// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
const login = vi.fn();
const loginWithMagicLink = vi.fn();
const loginDemo = vi.fn();

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
    session: null,
    isHydrated: true,
    demoUsers: [],
    login,
    loginWithMagicLink,
    loginDemo,
  }),
}));

import { Route } from "./login";

const LoginPage = Route.options.component as ComponentType;

function enterEmail(email: string) {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  login.mockResolvedValue({ ok: true });
  loginWithMagicLink.mockResolvedValue({
    ok: true,
    message: "Check your email for a magic link.",
  });
  loginDemo.mockResolvedValue({ ok: true });
});

describe("LoginPage", () => {
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

  it("links invitation requests to the firm contact", () => {
    render(<LoginPage />);

    expect(screen.getByRole("link", { name: "Request an invitation" }).getAttribute("href")).toBe(
      "mailto:willylai@fimmick.com?subject=Kossilon%20demo%20invitation%20request",
    );
  });
});
