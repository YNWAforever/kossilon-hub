// @vitest-environment jsdom

import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
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

    expect(await screen.findByText("請查看電郵中的登入連結。")).toBeTruthy();
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

describe("Demo auth context hydration", () => {
  beforeEach(() => {
    isDemoAuthEnabled.mockReturnValue(true);
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("never reports hydrated-without-session while a stored session is being restored", async () => {
    const { demoUsers, loginWithDemoUser } = await import("./session");
    loginWithDemoUser(demoUsers[0]!);
    const observed: Array<{ isHydrated: boolean; hasSession: boolean }> = [];

    function Probe() {
      const { isHydrated, session } = useAuth();
      observed.push({ isHydrated, hasSession: session !== null });
      return <output>{session?.name ?? ""}</output>;
    }

    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByRole("status").textContent).toBe(demoUsers[0]!.name));
    // A refresh or deep link would otherwise read as "signed out" for one render
    // and the protected shell bounces to /login, losing the requested route.
    expect(observed.filter((entry) => entry.isHydrated && !entry.hasSession)).toEqual([]);
  });
});

function SessionConsumer() {
  const auth = useAuth();
  const [result, setResult] = useState("");
  return (
    <>
      <p data-testid="hydrated">{String(auth.isHydrated)}</p>
      <p data-testid="session">{auth.session?.id ?? "none"}</p>
      <p data-testid="issue">{auth.authIssue?.kind ?? "none"}</p>
      <button
        onClick={() =>
          void auth
            .login("user@example.test", "local-unit-secret")
            .then((value) => setResult(value.ok ? "signed in" : "failed"))
            .catch(() => setResult("rejected"))
        }
      >
        Sign in
      </button>
      <button onClick={() => void auth.retrySession()}>Retry session</button>
      <button onClick={() => void auth.signOut().catch(() => undefined)}>Sign out</button>
      <output>{result}</output>
    </>
  );
}

const verifiedUser = { id: "auth-A", email: "a@example.test", name: "User A" };
const verifiedActor = {
  authUserId: "auth-A",
  userId: "staff-A",
  role: "Staff",
  teamId: "team-A",
  active: true,
};

describe("Neon session recovery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    isDemoAuthEnabled.mockReturnValue(false);
    createNeonAuthClient.mockReturnValue(authClient);
    getNeonAuthClientConfiguration.mockResolvedValue({ url: "https://auth.example.test" });
    authClient.getSession.mockResolvedValue({ data: null });
    authClient.signIn.email.mockResolvedValue({ error: null });
    authClient.signOut.mockResolvedValue({ error: null });
    getAuthenticatedActor.mockResolvedValue(verifiedActor);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  async function mount(queryClient?: QueryClient) {
    render(
      <AuthProvider queryClient={queryClient}>
        <SessionConsumer />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("hydrated").textContent).toBe("true"));
  }

  it("does not report sign-in success when the session read rejects, and releases loading", async () => {
    await mount();
    authClient.getSession.mockRejectedValueOnce(new Error("503 token=private-unit-token"));
    fireEvent.click(screen.getByText("Sign in"));
    expect(await screen.findByText("failed")).toBeTruthy();
    expect(screen.getByTestId("hydrated").textContent).toBe("true");
    expect(screen.getByTestId("session").textContent).toBe("none");
    expect(screen.getByTestId("issue").textContent).toBe("service");
    expect(screen.queryByText(/private-unit-token/)).toBeNull();
  });

  it.each([
    [new Error("Forbidden: user is not provisioned."), "unauthorized"],
    [new Error("Forbidden: staff account is inactive."), "unauthorized"],
    [new Error("Unauthorized: expired session."), "unauthenticated"],
    [Object.assign(new Error("Unavailable"), { status: 503 }), "service"],
    [{ status: 403 }, "unauthorized"],
    [{ status: 401 }, "unauthenticated"],
  ])("refuses false success and classifies actor failure %s", async (failure, kind) => {
    await mount();
    authClient.getSession.mockResolvedValue({ data: { user: verifiedUser } });
    getAuthenticatedActor.mockRejectedValueOnce(failure);
    fireEvent.click(screen.getByText("Sign in"));
    expect(await screen.findByText("failed")).toBeTruthy();
    expect(screen.getByTestId("issue").textContent).toBe(kind);
    expect(screen.getByTestId("session").textContent).toBe("none");
    expect(screen.getByTestId("hydrated").textContent).toBe("true");
  });

  it("requires an active actor matching the verified session identity", async () => {
    await mount();
    authClient.getSession.mockResolvedValue({ data: { user: verifiedUser } });
    getAuthenticatedActor.mockResolvedValue({ ...verifiedActor, authUserId: "another-user" });
    fireEvent.click(screen.getByText("Sign in"));
    expect(await screen.findByText("failed")).toBeTruthy();
    expect(screen.getByTestId("session").textContent).toBe("none");
  });

  it("classifies a returned session-service error instead of treating it as signed out", async () => {
    authClient.getSession.mockResolvedValue({ data: null, error: { status: 503 } });
    await mount();
    expect(screen.getByTestId("issue").textContent).toBe("service");
  });

  it.each(["configuration", "session", "actor"])(
    "bounds a stalled %s read and allows retry",
    async (stage) => {
      vi.useFakeTimers();
      const pending = new Promise<never>(() => undefined);
      if (stage === "configuration") getNeonAuthClientConfiguration.mockReturnValueOnce(pending);
      if (stage === "session") authClient.getSession.mockReturnValueOnce(pending);
      if (stage === "actor") {
        authClient.getSession.mockResolvedValue({ data: { user: verifiedUser } });
        getAuthenticatedActor.mockReturnValueOnce(pending);
      }
      render(
        <AuthProvider>
          <SessionConsumer />
        </AuthProvider>,
      );
      // Let the configuration resolve and mount the real session provider before
      // advancing the clock for its session/actor read.
      await act(async () => undefined);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(screen.getByTestId("hydrated").textContent).toBe("true");
      expect(screen.getByTestId("issue").textContent).toBe("service");
      authClient.getSession.mockResolvedValue({ data: { user: verifiedUser } });
      await act(async () => {
        fireEvent.click(screen.getByText("Retry session"));
      });
      expect(screen.getByTestId("session").textContent).toBe("staff-A");
      expect(screen.getByTestId("issue").textContent).toBe("none");
    },
  );

  it("restores a normal magic-link callback only after verifying its actor", async () => {
    authClient.getSession.mockResolvedValue({ data: { user: verifiedUser } });
    await mount();
    expect(screen.getByTestId("session").textContent).toBe("staff-A");
    expect(screen.getByTestId("issue").textContent).toBe("none");
  });

  it("finishes initial hydration after a rejected session read", async () => {
    authClient.getSession.mockRejectedValueOnce(new Error("Network unavailable"));
    await mount();
    expect(screen.getByTestId("session").textContent).toBe("none");
    expect(screen.getByTestId("issue").textContent).toBe("service");
  });

  it("does not accept an inactive actor returned by the resolver", async () => {
    await mount();
    authClient.getSession.mockResolvedValue({ data: { user: verifiedUser } });
    getAuthenticatedActor.mockResolvedValue({ ...verifiedActor, active: false });
    fireEvent.click(screen.getByText("Sign in"));
    expect(await screen.findByText("failed")).toBeTruthy();
    expect(screen.getByTestId("issue").textContent).toBe("unauthorized");
  });

  it("does not accept a sign-in response without a verified session", async () => {
    await mount();
    fireEvent.click(screen.getByText("Sign in"));
    expect(await screen.findByText("failed")).toBeTruthy();
    expect(screen.getByTestId("session").textContent).toBe("none");
  });

  it("retains the same actor's cached records across transient failure and retry", async () => {
    const client = new QueryClient();
    authClient.getSession.mockResolvedValue({ data: { user: verifiedUser } });
    await mount(client);
    client.setQueryData(["private"], "A private record");
    getAuthenticatedActor.mockRejectedValueOnce({ status: 503 });
    fireEvent.click(screen.getByText("Retry session"));
    await waitFor(() => expect(screen.getByTestId("issue").textContent).toBe("service"));
    expect(screen.getByTestId("session").textContent).toBe("none");
    fireEvent.click(screen.getByText("Retry session"));
    await waitFor(() => expect(screen.getByTestId("session").textContent).toBe("staff-A"));
    expect(client.getQueryData(["private"])).toBe("A private record");
  });

  it("clears local private records even when the remote sign-out rejects", async () => {
    const client = new QueryClient();
    authClient.getSession.mockResolvedValue({ data: { user: verifiedUser } });
    await mount(client);
    client.setQueryData(["private"], "A private record");
    authClient.signOut.mockRejectedValueOnce(new Error("Network unavailable"));
    await act(async () => {
      fireEvent.click(screen.getByText("Sign out"));
    });
    expect(screen.getByTestId("session").textContent).toBe("none");
    expect(client.getQueryCache().getAll()).toHaveLength(0);
  });

  it("clears the prior actor's queries and mutation selections before publishing a different actor", async () => {
    const client = new QueryClient();
    authClient.getSession.mockResolvedValue({ data: { user: verifiedUser } });
    await mount(client);
    client.setQueryData(["private"], "A private record");
    client.getMutationCache().build(
      client,
      { mutationKey: ["selection"] },
      {
        context: undefined,
        data: ["A-case"],
        error: null,
        failureCount: 0,
        failureReason: null,
        isPaused: false,
        status: "success",
        variables: undefined,
        submittedAt: 0,
      },
    );
    authClient.getSession.mockResolvedValue({ data: { user: { ...verifiedUser, id: "auth-B" } } });
    getAuthenticatedActor.mockResolvedValue({
      ...verifiedActor,
      authUserId: "auth-B",
      userId: "staff-B",
    });
    fireEvent.click(screen.getByText("Sign in"));
    await waitFor(() => expect(screen.getByTestId("session").textContent).toBe("staff-B"));
    expect(client.getQueryCache().getAll()).toHaveLength(0);
    expect(client.getMutationCache().getAll()).toHaveLength(0);
  });

  it("prevents an older pending session read from restoring an actor after sign-out", async () => {
    let resolveActor!: (actor: typeof verifiedActor) => void;
    authClient.getSession.mockResolvedValue({ data: { user: verifiedUser } });
    getAuthenticatedActor.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveActor = resolve;
      }),
    );
    render(
      <AuthProvider>
        <SessionConsumer />
      </AuthProvider>,
    );
    await waitFor(() => expect(getAuthenticatedActor).toHaveBeenCalledOnce());
    await act(async () => {
      fireEvent.click(screen.getByText("Sign out"));
    });
    await act(async () => {
      resolveActor(verifiedActor);
    });
    expect(screen.getByTestId("session").textContent).toBe("none");
    expect(screen.getByTestId("hydrated").textContent).toBe("true");
  });

  it("prevents an older pending sign-in from restoring an actor after sign-out", async () => {
    await mount();
    let resolveLogin!: (value: { error: null }) => void;
    authClient.signIn.email.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLogin = resolve;
      }),
    );
    fireEvent.click(screen.getByText("Sign in"));
    await act(async () => {
      fireEvent.click(screen.getByText("Sign out"));
    });
    authClient.getSession.mockResolvedValue({ data: { user: verifiedUser } });
    await act(async () => {
      resolveLogin({ error: null });
    });
    expect(screen.getByTestId("session").textContent).toBe("none");
    expect(screen.getByText("failed")).toBeTruthy();
  });
});
