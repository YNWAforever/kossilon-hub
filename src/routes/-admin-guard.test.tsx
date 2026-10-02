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
      demoUsers: [
        {
          id: "demo-readonly",
          name: "Readonly Demo",
          email: "demo@example.test",
          role: "Staff",
          team: "Demo",
          initials: "RD",
          active: true,
          lastLoginAt: null,
        },
      ],
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

async function renderAdmin(dataMode: "production" | "demo" = "production") {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/admin"] }),
    context: { queryClient: new QueryClient(), dataMode, actor: null },
    defaultPreloadStaleTime: 0,
  });

  await router.load();

  return renderToString(createElement(RouterProvider, { router }));
}

describe("/admin production console, gated by role", () => {
  it("keeps demo staff roles and active flags read-only", async () => {
    const html = await renderAdmin("demo");
    expect(html).toMatch(/<select[^>]*disabled=""[^>]*aria-label="Role for Readonly Demo"/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Deactivate Readonly Demo"/);
  });
  it("shows the console to an admin", async () => {
    mockIsAdmin.value = true;

    const html = await renderAdmin();

    expect(html).toContain("員工與團隊管理");
    expect(html).toContain("邀請未啟用");
    expect(html).not.toContain("Admin access required");
  });

  it("shows a denied state to a non-admin", async () => {
    mockIsAdmin.value = false;

    const html = await renderAdmin();

    expect(html).toContain("Admin access required");
    expect(html).not.toContain("Not available in this deployment");
  });
});
