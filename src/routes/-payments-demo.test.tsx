import { QueryClient } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { createElement, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { formatDate } from "@/lib/format-date";

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

    expect(html).toContain(`到期日 ${formatDate("2026-06-10")}`);
    expect(html).not.toMatch(/\| 2026-\d\d-\d\d/);
  });

  it("explains a closed case instead of showing a dead button beside '等待證明'", async () => {
    const html = await renderPayments();
    const summit = html.slice(html.indexOf("Summit Bamboo"));

    expect(summit).toContain("周年申報已遞交，毋須付款證明。");
    expect(summit).toContain("毋須提供");
    expect(summit).not.toContain("等待證明");
  });
});
