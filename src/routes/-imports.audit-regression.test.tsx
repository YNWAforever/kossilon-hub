import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../styles.css?url", () => ({ default: "/styles.css" }));
vi.mock("@/features/auth/neon-auth-rpc", () => ({
  getAuthenticatedActor: () => Promise.resolve({ authUserId: "test-admin" }),
}));
vi.mock("@/features/auth/auth-context-neon", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../features/auth/auth-context-neon")>();
  return {
    ...actual,
    AuthProvider: ({ children }: { children: ReactNode }) => children,
    useAuth: () => ({
      session: {
        id: "test-admin",
        name: "Test Admin",
        email: "admin@example.com",
        role: "Admin",
        initials: "TA",
        team: "Operations",
        signedInAt: "2026-07-11T00:00:00.000Z",
      },
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
vi.mock("../features/nar-import/server-fns", () => ({
  listNarImportBatches: () =>
    Promise.reject(
      Object.assign(new Error("private DB connection detail"), { requestId: "req_T02ABC123" }),
    ),
  searchImportCompanies: () =>
    Promise.reject(
      Object.assign(new Error("private DB connection detail"), { requestId: "req_T02ABC123" }),
    ),
  getNarImportBatchReview: () =>
    Promise.reject(
      Object.assign(new Error("private DB connection detail"), { requestId: "req_T02ABC123" }),
    ),
  queueNarImportStageJob: vi.fn(),
  getNarImportStageJob: vi.fn(),
  mapNarImportCompany: vi.fn(),
  revalidateNarImport: vi.fn(),
}));

import { routeTree } from "../routeTree.gen";

async function renderWithReadFailures() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, retryOnMount: false, refetchOnMount: false } },
  });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/imports"] }),
    context: { queryClient, dataMode: "production", actor: null },
    defaultPreloadStaleTime: 0,
  });
  await router.load();
  await Promise.all([
    queryClient.prefetchQuery({
      queryKey: ["nar-import", "batches"],
      queryFn: () =>
        Promise.reject(
          Object.assign(new Error("private DB connection detail"), { requestId: "req_T02ABC123" }),
        ),
    }),
    queryClient.prefetchQuery({
      queryKey: ["nar-import", "companies", "", null],
      queryFn: () =>
        Promise.reject(
          Object.assign(new Error("private DB connection detail"), { requestId: "req_T02ABC123" }),
        ),
    }),
  ]);
  return renderToString(createElement(RouterProvider, { router }));
}

describe("T02 imports read errors", () => {
  it("t02_scenario_3 renders failed batch/company reads as retryable errors, never empty success", async () => {
    const html = await renderWithReadFailures();
    expect(html).toContain("無法載入匯入紀錄");
    expect(html).toContain("無法載入公司清單");
    expect(html).toContain("重試");
    expect(html).toContain("req_T02ABC123");
    expect(html).not.toContain("尚未有匯入紀錄");
    expect(html).not.toContain("private DB connection detail");
  });
});
