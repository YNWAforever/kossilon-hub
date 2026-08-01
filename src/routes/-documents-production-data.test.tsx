// Renders /documents against the production data path, which nothing else
// covers: the demo dev server's listDocuments always fails, so the route takes
// the "Production records unavailable" branch and the row-rendering code never
// runs locally. That gap is why a crash in it reached production.
//
// The shapes below are ones the types deny but a database this code does not
// own can still produce.
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
vi.mock("../features/documents/server-fns", () => ({
  listDocuments: () => Promise.resolve([]),
  downloadDocument: () => Promise.resolve(new Response()),
}));
vi.mock("../features/annual-return/server-fns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../features/annual-return/server-fns")>();
  return { ...actual, getAnnualReturnCase: () => Promise.resolve(null) };
});

import { routeTree } from "../routeTree.gen";
import { resetAnnualReturnCasesForTest } from "../lib/annual-return-store";
import { resetClientPortalStoreForTest } from "../lib/client-portal-store";

const CASE_ID = "33333333-3333-4333-8333-333333333333";

const baseDocument = {
  id: "11111111-1111-4111-8111-111111111111",
  companyId: "22222222-2222-4222-8222-222222222222",
  caseId: CASE_ID,
  category: "identity",
  fileName: "director-passport.pdf",
  objectKey: "private/company/doc.pdf",
  contentType: "application/pdf",
  sizeBytes: 12345,
  checksum: "abc123",
  uploadStatus: "available",
  reviewStatus: "pending",
  uploadedBy: null,
  uploadedAt: "2026-07-30T02:00:00.000Z",
};

async function render(options: {
  documents: unknown[];
  caseData?: unknown;
  withCaseId: boolean;
  dataMode?: "demo" | "production";
}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const path = options.withCaseId ? `/documents?caseId=${CASE_ID}` : "/documents";
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient, dataMode: options.dataMode ?? "production" },
    defaultPreloadStaleTime: 0,
  });
  await router.load();
  await queryClient.prefetchQuery({
    queryKey: ["documents", "archive", options.withCaseId ? CASE_ID : "all"],
    queryFn: () => Promise.resolve(options.documents),
  });
  if (options.withCaseId) {
    await queryClient.prefetchQuery({
      queryKey: ["annual-return", "detail", CASE_ID],
      queryFn: () => Promise.resolve(options.caseData),
    });
  }
  return renderToString(createElement(RouterProvider, { router }));
}

describe("/documents against data the types say is impossible", () => {
  it("a production case with no checklist array", async () => {
    const html = await render({
      documents: [baseDocument],
      caseData: { id: CASE_ID, companyName: "Harbour Trading Ltd" },
      withCaseId: true,
    });
    expect(html).toContain("Production document vault");
  });

  it("a category outside DOCUMENT_CATEGORIES", async () => {
    const html = await render({
      documents: [{ ...baseDocument, category: "bank-statement" }],
      withCaseId: false,
    });
    expect(html).toContain("Production document vault");
  });

  it("null in the string columns labelValue formats", async () => {
    const html = await render({
      documents: [{ ...baseDocument, category: null, uploadStatus: null, reviewStatus: null }],
      withCaseId: false,
    });
    expect(html).toContain("Production document vault");
  });

  it("a null fileName", async () => {
    const html = await render({
      documents: [{ ...baseDocument, fileName: null }],
      withCaseId: false,
    });
    expect(html).toContain("Production document vault");
  });

  it("listDocuments resolving null instead of an array", async () => {
    const html = await render({ documents: null as unknown as unknown[], withCaseId: false });
    expect(html).toContain("Production document vault");
  });
});

describe("/documents in production must not link demo rows into production routes", () => {
  it("emits no /annual-returns/$id link carrying a demo fixture id", async () => {
    resetAnnualReturnCasesForTest();
    resetClientPortalStoreForTest();

    const html = await render({ documents: [], withCaseId: false });

    // Demo case ids look like ar-harbour. The production detail route validates
    // its id with z.string().uuid(), so following such a link renders
    // "Annual return case unavailable" over a raw Zod error.
    const demoLinks = [...html.matchAll(/href="\/annual-returns\/(ar-[a-z-]+)"/g)].map(
      (match) => match[1],
    );

    expect(demoLinks).toEqual([]);
  });

  it("still renders the fixture archive in demo mode, where those links resolve", async () => {
    // The gate must hide the archive in production, not delete it: demo mode is
    // the walkthrough and /annual-returns/ar-harbour is a real screen there.
    resetAnnualReturnCasesForTest();
    resetClientPortalStoreForTest();

    const html = await render({ documents: [], withCaseId: false, dataMode: "demo" });

    const demoLinks = [...html.matchAll(/href="\/annual-returns\/(ar-[a-z-]+)"/g)].map(
      (match) => match[1],
    );

    expect(demoLinks.length).toBeGreaterThan(0);
    expect(html).toContain("Search company, contact, title, or filename");
  });
});
