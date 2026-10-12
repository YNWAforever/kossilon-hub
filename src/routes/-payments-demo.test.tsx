import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../styles.css?url", () => ({ default: "/styles.css" }));
vi.mock("@/features/auth/auth-context-neon", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/auth/auth-context-neon")>()),
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({
    session: { id: "a", name: "A", email: "a@example.com", role: "Admin", initials: "A" },
    isHydrated: true,
    demoUsers: [],
    isCurrentUserAdmin: true,
    signOut: vi.fn(),
  }),
}));

import { routeTree } from "../routeTree.gen";

async function renderPayments() {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/payments"] }),
    context: { queryClient: new QueryClient(), dataMode: "demo", actor: null },
  });
  await router.load();
  return renderToString(createElement(RouterProvider, { router })).replaceAll("<!-- -->", "");
}

describe("demo payments board", () => {
  it("formats due dates for people rather than printing ISO strings", async () => {
    const html = await renderPayments();

    expect(html).toContain("Due 10 Jun 2026");
    expect(html).not.toMatch(/\| 2026-\d\d-\d\d/);
  });

  it("explains a closed case instead of showing a dead button beside 'Awaiting proof'", async () => {
    const html = await renderPayments();
    const summit = html.slice(html.indexOf("Summit Bamboo"));

    expect(summit).toContain("Return filed — no proof needed.");
    expect(summit).toContain("Not required");
    expect(summit).not.toContain("Awaiting proof");
  });
});
