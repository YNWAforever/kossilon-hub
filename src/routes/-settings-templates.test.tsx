import { createElement, type ReactNode } from "react";
import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../styles.css?url", () => ({ default: "/styles.css" }));

vi.mock("@/features/auth/neon-auth-rpc", () => ({
  getAuthenticatedActor: () => Promise.resolve({ authUserId: "test-user" }),
}));

vi.mock("@/features/whatsapp/server-fns", () => ({
  getWhatsAppIntegrationStatus: vi.fn(async () => ({
    deliveryMode: "simulated",
    missingLiveEnvVars: [],
  })),
}));

vi.mock("@/features/checklist-templates/server-fns", () => ({
  listChecklistTemplates: vi.fn(async () => [
    {
      id: "tpl-prod-1",
      name: "Production template",
      serviceType: "Annual Return — Private Ltd",
      description: "",
      active: true,
      documents: [],
      reminders: [],
      riskRules: [],
      updatedAt: "2026-08-18T00:00:00.000Z",
    },
  ]),
  createChecklistTemplate: vi.fn(),
  updateChecklistTemplate: vi.fn(),
  duplicateChecklistTemplate: vi.fn(),
  deleteChecklistTemplate: vi.fn(),
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

import { listChecklistTemplates } from "@/features/checklist-templates/server-fns";
import { routeTree } from "../routeTree.gen";

afterEach(() => {
  mockIsAdmin.value = true;
});

async function renderSettings(dataMode: "demo" | "production" = "production") {
  const queryClient = new QueryClient();

  // /settings has no route `loader` for checklist templates — it's fetched by a plain
  // `useQuery` inside the component (see settings.tsx). `router.load()` only awaits route
  // loaders, so it never waits on that query, and `renderToString` is a single synchronous
  // pass that can't await anything started during render either. Pre-seed the cache the same
  // way a real SSR pass would (a prefetch before the render), so the first synchronous render
  // already has data to show instead of the "no templates yet" empty state.
  if (dataMode === "production") {
    await queryClient.prefetchQuery({
      queryKey: ["checklist-templates"],
      queryFn: () => listChecklistTemplates(),
    });
  }

  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/settings"] }),
    context: { queryClient, dataMode, actor: null },
    defaultPreloadStaleTime: 0,
  });

  await router.load();

  return renderToString(createElement(RouterProvider, { router }));
}

describe("/settings checklist templates, by data mode", () => {
  it("shows the fixture read-only in demo — no mutating controls", async () => {
    const html = await renderSettings("demo");

    expect(html).toContain("Annual return — Private Ltd");
    expect(html).not.toContain("New template");
  });

  it("shows the real backend's data with working controls in production for an admin", async () => {
    mockIsAdmin.value = true;

    const html = await renderSettings("production");

    expect(html).toContain("Production template");
    expect(html).toContain("New template");
  });
});
