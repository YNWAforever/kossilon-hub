import { readFileSync } from "node:fs";

import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { routeTree } from "../routeTree.gen";
import { resetAnnualReturnCasesForTest } from "../lib/annual-return-store";
import { resetClientPortalStoreForTest } from "../lib/client-portal-store";

const annualReturnsRouteSource = readFileSync(
  new URL("./annual-returns.tsx", import.meta.url),
  "utf8",
);
const annualReturnDetailRouteSource = readFileSync(
  new URL("../features/annual-return/components/demo-case-detail.tsx", import.meta.url),
  "utf8",
);
const whatsappAutomationRouteSource = readFileSync(
  new URL("./whatsapp.automation.tsx", import.meta.url),
  "utf8",
);
const documentsRouteSource = readFileSync(new URL("./documents.tsx", import.meta.url), "utf8");
const portalRouteSource = readFileSync(new URL("./portal.tsx", import.meta.url), "utf8");

async function renderRoute(pathname: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [pathname] }),
    context: { queryClient: new QueryClient(), dataMode: "demo" },
    defaultPreloadStaleTime: 0,
  });

  await router.load();

  return renderToString(createElement(RouterProvider, { router }));
}

describe("annual return workflow route regressions", () => {
  beforeEach(() => {
    resetAnnualReturnCasesForTest();
    resetClientPortalStoreForTest();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders the operational workflow routes in labeled desktop and mobile root navigation", async () => {
    const html = await renderRoute("/portal?caseId=ar-delta");
    const desktopNavigation = html.match(
      /<nav[^>]*aria-label="Primary navigation"[^>]*>[\s\S]*?<\/nav>/,
    )?.[0];
    // Mobile navigation is now a drawer: its contents mount on open, so the shell
    // renders the trigger rather than a second inline <nav>.
    const mobileNavigationTrigger = html.match(
      /<button[^>]*aria-label="Open navigation menu"[^>]*>/,
    )?.[0];

    expect(desktopNavigation).toBeDefined();
    expect(mobileNavigationTrigger).toBeDefined();

    for (const [path, label] of [
      ["/portal", "Portal"],
      ["/payments", "Payments"],
      ["/whatsapp/automation", "WhatsApp Automation"],
      ["/annual-returns", "Annual Returns"],
    ]) {
      expect(desktopNavigation).toContain(`href="${path}"`);
      expect(desktopNavigation).toContain(`>${label}</span>`);
    }

    expect(desktopNavigation?.indexOf('href="/portal"')).toBeLessThan(
      desktopNavigation?.indexOf('href="/whatsapp/automation"') ?? -1,
    );
    // Destinations are grouped rather than presented as one flat list.
    expect(desktopNavigation).toContain(">Operations<");
    expect(desktopNavigation).toContain(">Messaging<");
    expect(desktopNavigation).toContain(">Administration<");
  });

  it("keeps the blockers column in the command center alongside packet and follow-up columns", () => {
    expect(annualReturnsRouteSource).toContain("<span>Blockers</span>");
    expect(annualReturnsRouteSource).toContain("<span>Packet</span>");
    expect(annualReturnsRouteSource).toContain("<span>Follow-ups</span>");
    expect(annualReturnsRouteSource).toContain('<Field label="Blockers" value={blockerSummary} />');
  });

  it("renders the annual-return detail route instead of swallowing it in the parent list route", async () => {
    const html = await renderRoute("/annual-returns/ar-delta");

    expect(html).toContain("Client portal activity");
    expect(html).toContain("Delta Bloom Ventures Limited");
    expect(html).not.toContain("Search company or contact");
  });

  it("renders the root not-found state for a route that no longer exists", async () => {
    // /clients was deleted. This pins that the router 404s rather than
    // crashing, which is otherwise only checked by hand in the browser.
    const html = await renderRoute("/clients/missing-client");

    expect(html).toContain("Page not found");
  });

  it("marks only WhatsApp Automation active on its nested route", async () => {
    const html = await renderRoute("/whatsapp/automation");
    const navigation = html.match(
      /<nav[^>]*aria-label="Primary navigation"[^>]*>[\s\S]*?<\/nav>/,
    )?.[0];
    const inboxLink = navigation?.match(/<a[^>]*href="\/whatsapp"[^>]*>/)?.[0];
    const automationLink = navigation?.match(/<a[^>]*href="\/whatsapp\/automation"[^>]*>/)?.[0];

    expect(inboxLink).toBeDefined();
    expect(automationLink).toBeDefined();
    expect(inboxLink).not.toContain('data-status="active"');
    expect(inboxLink).not.toContain("bg-sidebar-accent text-sidebar-accent-foreground");
    expect(automationLink).toContain('data-status="active"');
    expect(automationLink).toContain("bg-sidebar-accent text-sidebar-accent-foreground");
  });

  it("renders an explicit status column in WhatsApp automation", () => {
    expect(whatsappAutomationRouteSource).toContain("<span>Status</span>");
    expect(whatsappAutomationRouteSource).toContain('label="Status"');
    expect(whatsappAutomationRouteSource).toContain("statusToneClass(draft.status)");
  });

  // Superseded by demo-case-detail.interaction.test.tsx, which renders the screen
  // and asserts that every control is disabled — not just the filed-case ones this
  // used to check by matching `disabled={isFiled}` in the source.
  it("leaves the demo detail view with no live control and no stranded warning state", () => {
    expect(annualReturnDetailRouteSource).not.toContain("setPacketWarning");
    expect(annualReturnDetailRouteSource).not.toContain("setFollowUpWarning");
    expect(annualReturnDetailRouteSource).not.toContain("onChange");
    expect(annualReturnDetailRouteSource).not.toContain("onClick");
  });

  it("renders the client portal action center with mocked client actions", () => {
    expect(portalRouteSource).toContain('createFileRoute("/portal")');
    expect(portalRouteSource).toContain("caseId");
    expect(portalRouteSource).toContain("Upload");
    expect(portalRouteSource).toContain("Replace");
    expect(portalRouteSource).toContain("Acknowledge payment");
    expect(portalRouteSource).toContain("Approve packet");
    expect(portalRouteSource).toContain("View receipt");
  });

  it("keeps the portal and documents route contract aligned around case search and receipt access", () => {
    expect(documentsRouteSource).toContain('createFileRoute("/documents")');
    expect(documentsRouteSource).toContain("validateSearch");
    expect(documentsRouteSource).toContain("caseId");
    expect(portalRouteSource).toContain("search={{ caseId: selectedCase.id }}");
    expect(portalRouteSource).toContain('action.kind === "receipt"');
    expect(portalRouteSource).toContain('action.kind !== "receipt" && isReadOnly');
  });
});
