import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../styles.css?url", () => ({ default: "/styles.css" }));

vi.mock("@/features/auth/neon-auth-rpc", () => ({
  getAuthenticatedActor: () => Promise.resolve({ authUserId: "test-user" }),
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

async function renderAdmin() {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/admin"] }),
    context: { queryClient: new QueryClient(), dataMode: "production" as const, actor: null },
    defaultPreloadStaleTime: 0,
  });

  await router.load();

  return renderToString(createElement(RouterProvider, { router }));
}

describe("/admin production console, gated by role", () => {
  it("shows the console to an admin", async () => {
    mockIsAdmin.value = true;

    const html = await renderAdmin();

    expect(html).toContain("Not available in this deployment");
    expect(html).not.toContain("Admin access required");
  });

  it("shows a denied state to a non-admin", async () => {
    mockIsAdmin.value = false;

    const html = await renderAdmin();

    expect(html).toContain("Admin access required");
    expect(html).not.toContain("Not available in this deployment");
  });
});
