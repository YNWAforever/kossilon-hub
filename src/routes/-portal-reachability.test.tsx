// /portal is unreachable in production: the sidebar links to it with no
// caseId, and the only link that carries one lives in demo-case-detail, a
// demo-only component. So production always lands on the bare empty state,
// which offers no way forward.
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

const CASE_ID = "33333333-3333-4333-8333-333333333333";

const productionCase = {
  id: CASE_ID,
  companyId: "22222222-2222-4222-8222-222222222222",
  companyTeamId: "team-a",
  companyName: "Harbour Trading Ltd",
  returnYear: 2026,
  madeUpDate: "2026-06-01",
  filingDueDate: "2026-07-05",
  currentStatus: "Documents pending",
  riskLevel: "red",
  ownerId: "u-amy",
  ownerName: "Amy Chan",
  reviewerId: null,
  reviewerName: null,
  remindersSent: 1,
  filingReference: null,
  confirmationDocumentId: null,
  lockedAt: null,
  completedAt: null,
  checklist: [],
  payment: null,
};

vi.mock("../features/annual-return/server-fns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../features/annual-return/server-fns")>();
  return { ...actual, getAnnualReturnCase: () => Promise.resolve(productionCase) };
});

import { routeTree } from "../routeTree.gen";

async function render(pathname: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [pathname] }),
    context: { queryClient, dataMode: "production" },
    defaultPreloadStaleTime: 0,
  });
  await router.load();
  await queryClient.prefetchQuery({
    queryKey: ["annual-returns", "detail", CASE_ID],
    queryFn: () => Promise.resolve(productionCase),
  });
  return renderToString(createElement(RouterProvider, { router }));
}

describe("the production portal is reachable", () => {
  it("offers a way onward from the bare /portal the sidebar links to", async () => {
    const html = await render("/portal");

    // The sidebar has no caseId to give, so this is the screen staff actually
    // land on. It used to say "Select a UUID-backed annual return case" and
    // stop there — no link, and implementation vocabulary on a user screen.
    expect(html).toContain('href="/annual-returns"');
    expect(html).not.toContain("UUID-backed");
  });

  it("links to a case's portal from the production case detail", async () => {
    const html = await render(`/annual-returns/${CASE_ID}`);

    expect(html).toContain(`href="/portal?caseId=${CASE_ID}"`);
  });
});
