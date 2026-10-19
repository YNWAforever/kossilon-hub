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
    context: { queryClient: new QueryClient(), dataMode, actor: null },
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

    expect(html).not.toContain("暫時無法載入");
    expect(html).not.toContain("無法載入");

    const values = kpiValues(html);
    expect(values).toHaveLength(6);
    expect(values.some((value) => /[1-9]/.test(value))).toBe(true);
  });

  it("renders the digest and the upcoming table from demo data", async () => {
    const html = await renderDashboard("demo");

    // Renamed in Phase C. The heading was not inside a dataMode branch, so a
    // production user read "AI" over buildDailyDigest -- a hardcoded weight table.
    expect(html).toContain("優先處理");
    expect(html).not.toContain("AI daily digest");
    expect(html).toContain("即將到期的周年申報");
    expect(html).not.toContain("周年申報暫無需要優先處理的工作。");
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

    expect(outage).toContain("周年申報資料暫時無法載入");
    expect(forbidden).toContain("你沒有權限查看周年申報資料");
    expect(forbidden).toContain("請重新登入");
  });
});
