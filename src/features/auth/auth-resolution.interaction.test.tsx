// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
const api = vi.hoisted(() => ({
  getSession: vi.fn(),
  actor: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("./route-guard", () => ({ isDemoAuthEnabled: () => false }));
vi.mock("./neon-auth-client", () => ({
  createNeonAuthClient: () => ({
    getSession: api.getSession,
    signIn: { email: api.signIn },
    signOut: api.signOut,
  }),
}));
vi.mock("./neon-auth-rpc", () => ({
  getNeonAuthClientConfiguration: async () => ({ url: "https://auth.example.test" }),
  getAuthenticatedActor: api.actor,
}));
import { AuthProvider, useAuth } from "./auth-context-neon";
function Probe() {
  const auth = useAuth();
  const [result, setResult] = useState<unknown>(null);
  return (
    <>
      <output aria-label="hydration">{auth.isHydrated ? "ready" : "loading"}</output>
      <output aria-label="session">{auth.session?.name ?? "none"}</output>
      <output aria-label="resolution">{auth.resolution?.kind}</output>
      <output aria-label="result">{JSON.stringify(result)}</output>
      <button
        onClick={() => {
          void auth.login("synthetic@example.test", "local fixture").then(setResult);
        }}
      >
        Login
      </button>
      <button
        onClick={() => {
          void auth.refreshSession();
        }}
      >
        Retry
      </button>
    </>
  );
}
const user = { id: "verified-user", email: "synthetic@example.test", name: "Synthetic staff" };
const actor = {
  authUserId: user.id,
  userId: "20000000-0000-0000-0000-000000000001",
  role: "Staff",
  teamId: "10000000-0000-0000-0000-000000000001",
  active: true,
};
beforeEach(() => {
  vi.resetAllMocks();
  api.getSession.mockResolvedValue({ data: { user } });
  api.actor.mockResolvedValue(actor);
  api.signIn.mockResolvedValue({ data: { user } });
});
afterEach(cleanup);
describe("R24 auth resolution and verified login", () => {
  it("classifies session error data and offers retry without a stale actor", async () => {
    api.getSession.mockResolvedValue({
      data: null,
      error: { status: 503, message: "private provider diagnostic" },
    });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText("hydration").textContent).toBe("ready"));
    expect(screen.getByLabelText("resolution").textContent).toBe("transient_error");
    expect(screen.getByLabelText("session").textContent).toBe("none");
    api.getSession.mockResolvedValue({ data: { user } });
    fireEvent.click(screen.getByText("Retry"));
    await waitFor(() =>
      expect(screen.getByLabelText("resolution").textContent).toBe("authenticated"),
    );
  });
  it("does not return ok:true when password succeeds but actor resolution fails", async () => {
    api.getSession.mockResolvedValueOnce({ data: null });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText("hydration").textContent).toBe("ready"));
    api.actor.mockRejectedValue(Object.assign(new Error("service unavailable"), { status: 503 }));
    fireEvent.click(screen.getByText("Login"));
    await waitFor(() =>
      expect(screen.getByLabelText("result").textContent).toContain('"ok":false'),
    );
    expect(screen.getByLabelText("session").textContent).toBe("none");
  });
  it("finishes hydration on a rejected getSession request", async () => {
    api.getSession.mockRejectedValue(new Error("network unavailable"));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText("hydration").textContent).toBe("ready"));
    expect(screen.getByLabelText("resolution").textContent).toBe("transient_error");
  });
  it("denies a provisioned-but-forbidden or mismatched actor", async () => {
    api.actor.mockRejectedValue(new Error("Forbidden: inactive staff"));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText("hydration").textContent).toBe("ready"));
    expect(screen.getByLabelText("resolution").textContent).toBe("forbidden");
    api.actor.mockResolvedValue({ ...actor, authUserId: "another-user" });
    fireEvent.click(screen.getByText("Login"));
    await waitFor(() =>
      expect(screen.getByLabelText("result").textContent).toContain('"ok":false'),
    );
  });
});
