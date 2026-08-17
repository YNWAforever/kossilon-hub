import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../styles.css?url", () => ({ default: "/styles.css" }));

vi.mock("@/features/auth/neon-auth-rpc", () => ({
  getAuthenticatedActor: () => Promise.resolve({ authUserId: "test-user" }),
}));

vi.mock("@/features/whatsapp/server-fns", () => ({
  getWhatsAppIntegrationStatus: () =>
    Promise.resolve({ deliveryMode: "simulated" as const, missingLiveEnvVars: [] }),
}));

const mockIsAdmin = vi.hoisted(() => ({ value: true }));

vi.mock("@/features/auth/auth-context-neon", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../features/auth/auth-context-neon")>();
  return {
    ...actual,
    AuthProvider: ({ children }: { children: ReactNode }) => children,
    useAuth: () => ({
      session: {
        id: "test-user",
        name: "Test User",
        email: "user@example.test",
        role: mockIsAdmin.value ? ("Admin" as const) : ("Staff" as const),
        initials: "TU",
        team: "Operations",
        signedInAt: "2026-07-11T00:00:00.000Z",
      },
      isHydrated: true,
      demoUsers: [],
      isCurrentUserAdmin: mockIsAdmin.value,
      login: vi.fn(),
      loginWithMagicLink: vi.fn(),
      loginWithGoogle: vi.fn(),
      loginDemo: vi.fn(),
      loginDemoUser: vi.fn(),
      signOut: vi.fn(),
    }),
  };
});

import { routeTree } from "../routeTree.gen";

afterEach(() => {
  mockIsAdmin.value = true;
});

async function renderSettings(dataMode: "demo" | "production" = "production") {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/settings"] }),
    context: { queryClient: new QueryClient(), dataMode, actor: null },
    defaultPreloadStaleTime: 0,
  });

  await router.load();

  return renderToString(createElement(RouterProvider, { router }));
}

describe("/settings, gated by role", () => {
  it("shows settings content to an admin", async () => {
    mockIsAdmin.value = true;

    const html = await renderSettings();

    expect(html).toContain("WOZTELL");
    expect(html).not.toContain("Admin access required");
  });

  it("shows a denied state to a non-admin", async () => {
    mockIsAdmin.value = false;

    const html = await renderSettings();

    expect(html).toContain("Admin access required");
  });

  it("stays fully open in demo mode regardless of role", async () => {
    mockIsAdmin.value = false;

    const html = await renderSettings("demo");

    expect(html).not.toContain("Admin access required");
  });
});
