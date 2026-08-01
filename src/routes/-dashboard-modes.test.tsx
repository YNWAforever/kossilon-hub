import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../styles.css?url", () => ({ default: "/styles.css" }));

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

const productionFailure = vi.hoisted(() => ({ error: new Error("boom") }));

vi.mock("@/features/annual-return/server-fns", () => ({
  getAnnualReturnDashboardMetrics: () => Promise.reject(productionFailure.error),
  listAnnualReturnCases: () => Promise.reject(productionFailure.error),
}));

import { routeTree } from "../routeTree.gen";
import { resetAnnualReturnCasesForTest } from "../lib/annual-return-store";

async function renderDashboard(dataMode: "demo" | "production") {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/"] }),
    context: { queryClient: new QueryClient(), dataMode },
    defaultPreloadStaleTime: 0,
  });

  await router.load();

  return renderToString(createElement(RouterProvider, { router }));
}

function kpiValues(html: string): string[] {
  const grid = html.match(/data-testid="kpi-grid"[\s\S]*?<\/section>/)?.[0] ?? "";
  return [...grid.matchAll(/data-testid="kpi-value"[^>]*>([^<]*)</g)].map((match) => match[1]);
}

describe("dashboard at both data modes", () => {
  beforeEach(() => {
    resetAnnualReturnCasesForTest();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("shows the demo story rather than an error state", async () => {
    const html = await renderDashboard("demo");

    expect(html).not.toContain("temporarily unavailable");
    expect(html).not.toContain("could not be loaded");

    const values = kpiValues(html);
    expect(values).toHaveLength(6);
    expect(values.some((value) => /[1-9]/.test(value))).toBe(true);
  });

  it("renders the digest and the upcoming table from demo data", async () => {
    const html = await renderDashboard("demo");

    expect(html).toContain("AI daily digest");
    expect(html).toContain("Upcoming annual returns");
    expect(html).not.toContain("No priority work detected from annual returns.");
  });

  it("renders no numeral in any tile when the production load fails", async () => {
    const html = await renderDashboard("production");

    const values = kpiValues(html);
    expect(values).toHaveLength(6);
    for (const value of values) {
      expect(value).not.toMatch(/\d/);
    }
  });

  it("distinguishes an authorization failure from an outage", async () => {
    productionFailure.error = new Error("connection terminated unexpectedly");
    const outage = await renderDashboard("production");

    productionFailure.error = new Error("Forbidden: staff access required");
    const forbidden = await renderDashboard("production");

    productionFailure.error = new Error("boom");

    expect(outage).toContain("Annual return data is temporarily unavailable");
    expect(forbidden).toContain("You do not have access to annual return data");
    expect(forbidden).toContain("Sign in again");
  });
});
