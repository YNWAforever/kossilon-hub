import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../styles.css?url", () => ({ default: "/styles.css" }));

const session = {
  id: "test-admin",
  name: "Test Admin",
  email: "admin@example.com",
  role: "Admin" as const,
  initials: "TA",
  team: "Operations",
  signedInAt: "2026-07-11T00:00:00.000Z",
};

vi.mock("@/features/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/auth/session")>()),
  getStoredSession: () => session,
}));

vi.mock("@/features/auth/neon-auth-rpc", () => ({
  getAuthenticatedActor: () => Promise.resolve({ authUserId: "test-admin" }),
}));

vi.mock("@/features/auth/auth-context-neon", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/auth/auth-context-neon")>()),
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
}));

vi.mock("../features/whatsapp/server-fns", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/whatsapp/server-fns")>()),
  listWhatsAppConversations: vi.fn(async () => []),
  listWhatsAppConversationMessages: vi.fn(async () => []),
  getWhatsAppIntegrationStatus: vi.fn(async () => ({
    provider: "woztell" as const,
    deliveryMode: "live" as const,
    webhookConfigured: true,
    liveSendConfigured: true,
    missingLiveEnvVars: [] as string[],
  })),
}));

vi.mock("../features/annual-return/follow-up-server-fns", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/annual-return/follow-up-server-fns")>()),
  listProductionFollowUpDrafts: vi.fn(async () => []),
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

// Markers, chosen so each screen is identified by something only it renders.
const DEMO_COMPOSER = "Type a reply or insert an AI draft";
const PRODUCTION_INBOX = "Loading conversations";
const AUTOMATION_TITLE = "WhatsApp Automation";

describe("whatsapp route across data modes", () => {
  // The regression guard. /whatsapp/automation is a CHILD of /whatsapp and renders
  // only through the parent's <Outlet />. A parent that branches on dataMode
  // without keeping that guard silently stops rendering the automation screen —
  // and every other route test in this repo runs at dataMode "demo".
  it("still renders the automation screen through the parent outlet in production mode", async () => {
    const html = await renderRoute("/whatsapp/automation", "production");

    expect(html).toContain(AUTOMATION_TITLE);
    expect(html).not.toContain(DEMO_COMPOSER);
    expect(html).not.toContain(PRODUCTION_INBOX);
  });

  it("still renders the automation screen through the parent outlet in demo mode", async () => {
    const html = await renderRoute("/whatsapp/automation", "demo");

    expect(html).toContain(AUTOMATION_TITLE);
    expect(html).not.toContain(DEMO_COMPOSER);
  });

  it("renders the production inbox at /whatsapp in production mode", async () => {
    // renderToString does not run TanStack Query, so this asserts the production
    // component is mounted rather than that the server call fired. The server call
    // and its guards are covered in production-inbox.interaction.test.tsx.
    const html = await renderRoute("/whatsapp", "production");

    expect(html).toContain(PRODUCTION_INBOX);
    expect(html).not.toContain(DEMO_COMPOSER);
    expect(html).not.toContain("Mandy Lee");
  });

  it("renders the demo inbox from fixtures at /whatsapp in demo mode", async () => {
    const html = await renderRoute("/whatsapp", "demo");

    expect(html).toContain(DEMO_COMPOSER);
    expect(html).toContain("Mandy Lee");
    expect(html).not.toContain(PRODUCTION_INBOX);
  });
});
