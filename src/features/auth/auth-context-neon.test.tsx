// @vitest-environment jsdom

import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authClient = vi.hoisted(() => ({
  getSession: vi.fn(),
  signIn: {
    email: vi.fn(),
    magicLink: vi.fn(),
    social: vi.fn(),
  },
  signOut: vi.fn(),
}));
const createNeonAuthClient = vi.hoisted(() => vi.fn(() => authClient));
const getNeonAuthClientConfiguration = vi.hoisted(() => vi.fn());
const getAuthenticatedActor = vi.hoisted(() => vi.fn());
const isDemoAuthEnabled = vi.hoisted(() => vi.fn());

vi.mock("./neon-auth-client", () => ({ createNeonAuthClient }));
vi.mock("./neon-auth-rpc", () => ({
  getNeonAuthClientConfiguration,
  getAuthenticatedActor,
}));
vi.mock("./route-guard", () => ({ isDemoAuthEnabled }));

import { AuthProvider, useAuth } from "./auth-context-neon";

function MagicLinkConsumer() {
  const { loginWithMagicLink } = useAuth();
  const [message, setMessage] = useState("");

  return (
    <>
      <button
        onClick={() => {
          void loginWithMagicLink("  USER@EXAMPLE.TEST  ").then((result) => {
            setMessage(result.ok ? (result.message ?? "") : result.error);
          });
        }}
      >
        Request magic link
      </button>
      <output>{message}</output>
    </>
  );
}

describe("Neon Auth context magic-link login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isDemoAuthEnabled.mockReturnValue(false);
    getNeonAuthClientConfiguration.mockResolvedValue({ url: "https://auth.example.test" });
    authClient.getSession.mockResolvedValue({ data: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("returns the magic-link confirmation after the provider accepts the request", async () => {
    authClient.signIn.magicLink.mockResolvedValue({ error: null });

    render(
      <AuthProvider>
        <MagicLinkConsumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(createNeonAuthClient).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Request magic link" }));

    expect(await screen.findByText("Check your email for a magic link.")).toBeTruthy();
    expect(authClient.signIn.magicLink).toHaveBeenCalledWith({
      email: "user@example.test",
      callbackURL: `${window.location.origin}/login`,
      newUserCallbackURL: `${window.location.origin}/login`,
    });
  });

  it("returns the provider error without exposing its response body", async () => {
    authClient.signIn.magicLink.mockResolvedValue({
      error: { message: "Email address is not allowed.", body: "Internal response details" },
    });

    render(
      <AuthProvider>
        <MagicLinkConsumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(createNeonAuthClient).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Request magic link" }));

    expect(await screen.findByText("Email address is not allowed.")).toBeTruthy();
    expect(screen.queryByText("Internal response details")).toBeNull();
  });
});

function GoogleConsumer() {
  const { loginWithGoogle } = useAuth();
  const [message, setMessage] = useState("");

  return (
    <>
      <button
        onClick={() => {
          void loginWithGoogle().then((result) => {
            setMessage(result.ok ? "ok" : result.error);
          });
        }}
      >
        Continue with Google
      </button>
      <output>{message}</output>
    </>
  );
}

describe("Neon Auth context Google login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isDemoAuthEnabled.mockReturnValue(false);
    getNeonAuthClientConfiguration.mockResolvedValue({ url: "https://auth.example.test" });
    authClient.getSession.mockResolvedValue({ data: null });
  });

  afterEach(() => {
    cleanup();
  });

  it("requests a Google sign-in with the correct provider and callback", async () => {
    authClient.signIn.social.mockResolvedValue({
      data: { url: "https://accounts.google.test/x", redirect: true },
      error: null,
    });

    render(
      <AuthProvider>
        <GoogleConsumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(createNeonAuthClient).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByText("ok")).toBeTruthy();
    expect(authClient.signIn.social).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: `${window.location.origin}/login`,
      newUserCallbackURL: `${window.location.origin}/login`,
    });
  });

  it("surfaces a provider error without throwing", async () => {
    authClient.signIn.social.mockResolvedValue({
      data: null,
      error: { message: "Google sign-in is not configured." },
    });

    render(
      <AuthProvider>
        <GoogleConsumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(createNeonAuthClient).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(await screen.findByText("Google sign-in is not configured.")).toBeTruthy();
  });
});
