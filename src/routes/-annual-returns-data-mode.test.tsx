import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  listAnnualReturnCases: vi.fn(async () => []),
  listWorkQueue: vi.fn(async () => []),
}));

vi.mock("../features/annual-return/server-fns", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/annual-return/server-fns")>()),
  listAnnualReturnCases: serverFns.listAnnualReturnCases,
  getAnnualReturnCase: vi.fn(async () => null),
}));

vi.mock("../features/work-items/server-fns", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/work-items/server-fns")>()),
  listWorkQueue: serverFns.listWorkQueue,
}));

import { routeTree } from "../routeTree.gen";
import { resetAnnualReturnCasesForTest } from "../lib/annual-return-store";
import { resetClientPortalStoreForTest } from "../lib/client-portal-store";

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

describe("annual returns route across data modes", () => {
  beforeEach(() => {
    resetAnnualReturnCasesForTest();
    resetClientPortalStoreForTest();
    serverFns.listAnnualReturnCases.mockClear();
  });

  // The regression guard. /annual-returns/$id is a CHILD of /annual-returns and
  // renders only through the parent's <Outlet />. A parent that branches on
  // dataMode without keeping that guard silently stops rendering the detail
  // screen, and every other test in the repo runs at dataMode "demo".
  it("still renders the production detail screen through the parent outlet", async () => {
    const html = await renderRoute(
      "/annual-returns/11111111-1111-4111-8111-111111111111",
      "production",
    );

    // SSR renders the detail screen's pending state, which has no PageHeader.
    expect(html).toContain("Loading annual return case");
    // The load-bearing half: if the parent stops rendering <Outlet /> it draws its
    // own board here instead, and the detail screen silently disappears.
    expect(html).not.toContain("Search company");
  });

  it("still renders the demo detail screen through the parent outlet", async () => {
    const html = await renderRoute("/annual-returns/ar-delta", "demo");

    expect(html).toContain("Delta Bloom Ventures Limited");
    expect(html).not.toContain("Search company or contact");
  });

  it("renders the production board at /annual-returns in production mode", async () => {
    const html = await renderRoute("/annual-returns", "production");

    expect(html).toContain("Search company");
    expect(html).not.toContain("Search company or contact");
    expect(html).not.toContain("Delta Bloom Ventures Limited");
  });

  it("carries board filters from the URL into the rendered screen", async () => {
    // renderToString does not run TanStack Query, so this asserts the params reach
    // the component rather than the server call. board-filters.test.ts covers the
    // mapping onto the query itself.
    const html = await renderRoute("/annual-returns?q=Harbour&status=Filed", "production");

    expect(html).toContain('value="Harbour"');
    expect(html).toContain('value="Filed" selected');
  });

  it("renders the demo board at /annual-returns in demo mode", async () => {
    const html = await renderRoute("/annual-returns", "demo");

    expect(html).toContain("Search company or contact");
    expect(html).toContain("Delta Bloom Ventures Limited");
  });
});
