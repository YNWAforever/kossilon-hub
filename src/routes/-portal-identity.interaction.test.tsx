// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  actor: { authUserId: "A", userId: null, role: "Client", teamId: null, active: true },
  cases: vi.fn(),
  docs: vi.fn(),
}));
const caseId = "40000000-0000-0000-0000-000000000001";
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (options: unknown) => ({
    options,
    useRouteContext: () => ({ dataMode: "production", actor: state.actor }),
    useSearch: () => ({ caseId: "40000000-0000-0000-0000-000000000001" }),
  }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a href="#local">{children}</a>,
}));
vi.mock("../features/annual-return/client-portal-server-fns", () => ({
  getClientPortalCase: state.cases,
  listClientPortalCases: async () => [],
}));
vi.mock("../features/annual-return/server-fns", () => ({
  getAnnualReturnCase: vi.fn(),
  listAnnualReturnCasePage: vi.fn(),
}));
vi.mock("../features/documents/server-fns", () => ({
  listDocumentPage: state.docs,
  createDocumentUploadIntent: vi.fn(),
  downloadDocument: vi.fn(),
  finalizeDocumentUpload: vi.fn(),
}));
import { Route } from "./portal";
const Page = Route.options.component!;
afterEach(cleanup);
it("does not render accountA's cached case or filenames for accountB's Forbidden result", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  state.cases.mockImplementation(async () => {
    if (state.actor.authUserId === "B") throw new Error("Forbidden");
    return {
      id: caseId,
      companyId: "10000000-0000-0000-0000-000000000001",
      companyName: "A private company",
      returnYear: 2026,
      filingDueDate: "2026-10-31",
      currentStatus: "Documents pending",
      checklist: [],
    };
  });
  state.docs.mockResolvedValue({
    documents: [{ id: caseId, fileName: "A private.pdf", reviewStatus: "pending" }],
    nextCursor: null,
  });
  await Page.preload?.();
  const tree = () => (
    <QueryClientProvider client={client}>
      <Suspense fallback={<p>Loading local route</p>}>
        <Page />
      </Suspense>
    </QueryClientProvider>
  );
  const view = render(tree());
  await screen.findByText("A private.pdf");
  await act(async () => {
    state.actor = { ...state.actor, authUserId: "B" };
    view.rerender(tree());
  });
  await waitFor(() => expect(screen.queryByText("A private.pdf")).toBeNull());
  expect(screen.queryByText("A private company")).toBeNull();
  await screen.findByText("Annual return not found");
  expect(state.docs).toHaveBeenCalledTimes(1);
});
