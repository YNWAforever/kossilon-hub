// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cases: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (options: unknown) => ({
    options,
    useRouteContext: () => ({
      dataMode: "production",
      actor: { authUserId: "client-a", userId: null, role: "Client", teamId: null, active: true },
    }),
    useSearch: () => ({}),
  }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a href="#local">{children}</a>,
}));

vi.mock("../features/annual-return/client-portal-server-fns", () => ({
  listClientPortalCases: state.cases,
  getClientPortalCase: vi.fn(),
}));

vi.mock("../features/annual-return/server-fns", () => ({
  getAnnualReturnCase: vi.fn(),
  listAnnualReturnCasePage: vi.fn(),
}));

vi.mock("../features/documents/server-fns", () => ({
  listDocumentPage: vi.fn(),
  createDocumentUploadIntent: vi.fn(),
  downloadDocument: vi.fn(),
  finalizeDocumentUpload: vi.fn(),
}));

import { Route } from "./portal";
import { paymentStatusLabel } from "../features/annual-return/labels";

const Page = Route.options.component!;

afterEach(cleanup);

it("shows awaiting-review and payment facts on a client's case card", async () => {
  await Page.preload?.();
  state.cases.mockResolvedValue([
    {
      id: "40000000-0000-4000-8000-000000000001",
      companyId: "10000000-0000-4000-8000-000000000001",
      companyName: "Harbour Holdings Limited",
      returnYear: 2026,
      filingDueDate: "2026-05-12",
      currentStatus: "Documents pending",
      outstandingRequiredItems: 1,
      awaitingOurReviewItems: 2,
      paymentStatus: "Payment pending",
    },
  ]);

  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Suspense fallback={<p>Loading local route</p>}>
        <Page />
      </Suspense>
    </QueryClientProvider>,
  );

  expect(await screen.findByText(/Harbour Holdings Limited/)).toBeTruthy();
  expect(screen.getByText("已收到 2 份文件，待我們核實。")).toBeTruthy();
  expect(screen.getByText(`付款狀態：${paymentStatusLabel("Payment pending")}`)).toBeTruthy();
});
