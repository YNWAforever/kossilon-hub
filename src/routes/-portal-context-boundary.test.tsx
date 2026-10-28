// @vitest-environment jsdom
import { Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultParseSearch } from "@tanstack/react-router";
const state = vi.hoisted(() => ({
  role: "Staff",
  search: {} as Record<string, unknown>,
  staff: vi.fn(),
  client: vi.fn(),
  staffPicker: vi.fn(),
  clientPicker: vi.fn(),
  docs: vi.fn(),
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  createFileRoute:
    () => (options: { validateSearch: (search: Record<string, unknown>) => unknown }) => ({
      options,
      useRouteContext: () => ({
        dataMode: "production",
        actor: {
          authUserId: "context-a",
          userId: "staff-a",
          role: state.role,
          teamId: "team-a",
          active: true,
        },
      }),
      useSearch: () => options.validateSearch(state.search),
    }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a href="/portal">{children}</a>,
}));
vi.mock("../features/annual-return/server-fns", () => ({
  getAnnualReturnCase: state.staff,
  listAnnualReturnCasePage: state.staffPicker,
}));
vi.mock("../features/annual-return/client-portal-server-fns", () => ({
  getClientPortalCase: state.client,
  listClientPortalCases: state.clientPicker,
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
beforeEach(() => {
  vi.clearAllMocks();
  state.staff.mockResolvedValue(null);
  state.client.mockResolvedValue(null);
  state.staffPicker.mockResolvedValue({ cases: [], nextCursor: null });
  state.clientPicker.mockResolvedValue([]);
  state.docs.mockResolvedValue({ documents: [], nextCursor: null });
});
const first = "40000000-0000-4000-8000-000000000001";
const second = "40000000-0000-4000-8000-000000000002";
for (const role of ["Staff", "Client"])
  describe(`${role} portal context input`, () => {
    it.each([
      ["empty", "?caseId="],
      ["numeric", "?caseId=123"],
      ["null", "?caseId=null"],
      ["boolean", "?caseId=true"],
      ["object", "?caseId=%7B%22id%22%3A%22x%22%7D"],
      ["duplicate different IDs", `?caseId=${first}&caseId=${second}`],
      ["duplicate identical IDs", `?caseId=${first}&caseId=${first}`],
      ["UUID array", `?caseId=${encodeURIComponent(JSON.stringify([first]))}`],
      ["whitespace UUID", `?caseId=%20${first}%20`],
    ])("rejects %s without any case/picker/document query", async (_label, search) => {
      state.role = role;
      state.search = defaultParseSearch(search);
      await Page.preload?.();
      render(
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
        >
          <Suspense fallback={<p>Loading test route</p>}>
            <Page />
          </Suspense>
        </QueryClientProvider>,
      );
      await screen.findByText("案件 ID 格式無效。請重新選擇案件。");
      for (const query of [
        state.staff,
        state.client,
        state.staffPicker,
        state.clientPicker,
        state.docs,
      ])
        expect(query).not.toHaveBeenCalled();
    });
    it("keeps an absent ID distinct from a malformed ID and offers the actor's picker", async () => {
      state.role = role;
      state.search = {};
      await Page.preload?.();
      render(
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
        >
          <Suspense fallback={<p>Loading test route</p>}>
            <Page />
          </Suspense>
        </QueryClientProvider>,
      );
      const picker = role === "Client" ? state.clientPicker : state.staffPicker;
      await vi.waitFor(() => expect(picker).toHaveBeenCalledOnce());
      expect(screen.queryByText("案件 ID 格式無效。請重新選擇案件。")).toBeNull();
      expect(state.staff).not.toHaveBeenCalled();
      expect(state.client).not.toHaveBeenCalled();
      expect(state.docs).not.toHaveBeenCalled();
    });
  });
