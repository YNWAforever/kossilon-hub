// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../styles.css?url", () => ({ default: "/styles.css" }));

vi.mock("@/features/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../features/auth/session")>();
  return {
    ...actual,
    getStoredSession: () => ({
      id: "test-admin",
      name: "Test Admin",
      email: "admin@example.com",
      role: "Admin",
      initials: "TA",
      team: "Operations",
      signedInAt: "2026-07-11T00:00:00.000Z",
    }),
  };
});

vi.mock("@/features/auth/neon-auth-rpc", () => ({
  getAuthenticatedActor: () => Promise.resolve({ authUserId: "test-admin" }),
}));

vi.mock("@/features/auth/auth-context-neon", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../features/auth/auth-context-neon")>();
  const session = {
    id: "test-admin",
    name: "Test Admin",
    email: "admin@example.com",
    role: "Admin" as const,
    initials: "TA",
    team: "Operations",
    signedInAt: "2026-07-11T00:00:00.000Z",
  };

  return {
    ...actual,
    AuthProvider: ({ children }: { children: ReactNode }) => children,
    useAuth: () => ({
      session,
      isHydrated: true,
      demoUsers: [],
      isCurrentUserAdmin: true,
      login: vi.fn(),
      loginDemo: vi.fn(),
      loginDemoUser: vi.fn(),
      signOut: vi.fn(),
    }),
  };
});

const serverFns = vi.hoisted(() => ({
  listClients: vi.fn(async () => []),
  getClient: vi.fn(async () => null),
  listClientAssignmentOptions: vi.fn(async () => ({ owners: [], teams: [], packages: [] })),
}));

vi.mock("../features/clients/server-fns", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/clients/server-fns")>()),
  listClients: serverFns.listClients,
  getClient: serverFns.getClient,
  listClientAssignmentOptions: serverFns.listClientAssignmentOptions,
}));

import { routeTree } from "../routeTree.gen";

async function renderRoute(pathname: string, dataMode: "demo" | "production") {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [pathname] }),
    context: { queryClient: new QueryClient(), dataMode, actor: null },
    defaultPreloadStaleTime: 0,
  });

  await router.load();

  return renderToString(createElement(RouterProvider, { router }));
}

describe("clients route across data modes", () => {
  it("renders the production register at /clients in production mode", async () => {
    const html = await renderRoute("/clients", "production");

    expect(html).toContain("Search company, CR or BR number");
    expect(html).not.toContain("no demo fixtures");
  });

  it("renders the demo notice at /clients in demo mode", async () => {
    const html = await renderRoute("/clients", "demo");

    expect(html).toContain("no demo fixtures");
    expect(html).not.toContain("Search company, CR or BR number");
  });
});
