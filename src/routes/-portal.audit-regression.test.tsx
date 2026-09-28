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

const LEGACY_ID = "40000000-0000-0000-0000-000000000002";
const caseRecord = {
  id: LEGACY_ID,
  companyId: "40000000-0000-0000-0000-000000000001",
  companyTeamId: "team-a",
  companyName: "T02 Legacy Company",
  returnYear: 2026,
  madeUpDate: "2026-06-01",
  filingDueDate: "2026-07-05",
  currentStatus: "Documents pending",
  riskLevel: "red",
  ownerId: "u-amy",
  ownerName: "Amy Chan",
  reviewerId: null,
  reviewerName: null,
  remindersSent: 0,
  filingReference: null,
  confirmationDocumentId: null,
  lockedAt: null,
  completedAt: null,
  checklist: [],
  payment: null,
};
vi.mock("../features/annual-return/server-fns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../features/annual-return/server-fns")>();
  return { ...actual, getAnnualReturnCase: () => Promise.resolve(caseRecord) };
});

import { routeTree } from "../routeTree.gen";

async function render(path: string, prefetch = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient, dataMode: "production", actor: null },
    defaultPreloadStaleTime: 0,
  });
  await router.load();
  if (prefetch) {
    await queryClient.prefetchQuery({
      queryKey: ["annual-returns", "detail", LEGACY_ID],
      queryFn: () => Promise.resolve(caseRecord),
    });
  }
  return renderToString(createElement(RouterProvider, { router }));
}

describe("T02 portal link regression", () => {
  it("t02_scenario_2 opens a legacy UUID-shaped case ID from the staff case link", async () => {
    const html = await render(`/portal?caseId=${LEGACY_ID}`, true);
    expect(html).toContain("T02 Legacy Company");
    expect(html).not.toContain("瀏覽周年申報案件");
  });

  it("t02_scenario_2 shows an invalid-link state instead of a case chooser", async () => {
    const html = await render("/portal?caseId=not-a-case");
    expect(html).toContain("案件連結無效");
    expect(html).not.toContain("瀏覽周年申報案件");
  });
});
