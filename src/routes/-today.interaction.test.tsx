// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense } from "react";
const state = vi.hoisted(() => ({
  query: vi.fn(),
  navigate: vi.fn(),
  search: { view: "chaseToday", q: "", sort: "deadline" },
}));
vi.mock("@/features/annual-return/server-fns", () => ({
  getAnnualReturnWorkViews: state.query,
  getAnnualReturnWorkPage: async ({ data }: { data: { view: string } }) => {
    const results = await state.query();
    return {
      rows:
        results.find((v: { definition: { key: string } }) => v.definition.key === data.view)
          ?.rows ?? [],
      nextCursor: results.length > 5 ? "controlled-cursor" : null,
    };
  },
  getAnnualReturnWorkMetrics: async () => ({
    chaseToday: 10000,
    newlyReceived: 0,
    awaitingMyReview: 0,
    readyToFile: 0,
    returnsAndExceptions: 0,
  }),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (options: unknown) => ({
    options,
    useRouteContext: () => ({ dataMode: "production" }),
    useSearch: () => state.search,
  }),
  useNavigate: () => state.navigate,
  Link: ({
    children,
    search,
    params,
    ...props
  }: {
    children: import("react").ReactNode;
    search?: Record<string, string>;
    params?: unknown;
  }) => (
    <a
      href="#controlled-local"
      {...props}
      data-search={JSON.stringify(search)}
      data-params={JSON.stringify(params)}
    >
      {children}
    </a>
  ),
}));
import { WORK_VIEWS } from "@/features/annual-return/work-views";
import { Route } from "./today";
const Page = Route.options.component!;
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  state.search = { view: "chaseToday", q: "", sort: "deadline" };
});
async function mount() {
  await act(async () => {
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <Suspense fallback={<p>Testing load</p>}>
          <Page />
        </Suspense>
      </QueryClientProvider>,
    );
  });
}
describe("Today truthful journey state", () => {
  it("uses server totals and offers explicit next-page navigation", async () => {
    state.query.mockResolvedValue([
      ...WORK_VIEWS.map((definition) => ({ definition, rows: [] })),
      { sentinel: true },
    ]);
    await mount();
    await screen.findByRole("button", { name: "今日要追 (10000)" });
    fireEvent.click(screen.getByRole("button", { name: "下一頁工作" }));
    expect(state.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ search: expect.objectContaining({ cursor: "controlled-cursor" }) }),
    );
  });
  it("shows loading before data exists", async () => {
    state.query.mockImplementation(() => new Promise(() => {}));
    await mount();
    expect((await screen.findByRole("status")).textContent).toContain("正在載入今日工作");
  });
  it("shows live error and explicit retry; no fake empty work", async () => {
    state.query.mockRejectedValue(new Error("Controlled unavailable"));
    await mount();
    expect((await screen.findByRole("alert")).textContent).toContain("無法載入");
    expect(screen.queryByText("現時沒有這一類工作。")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重新載入" }));
    await waitFor(() => expect(state.query).toHaveBeenCalledTimes(2));
  });
  it("expands full reason and keeps validated filter in the case return path", async () => {
    state.search = { view: "chaseToday", q: "Harbour", sort: "deadline" };
    state.query.mockResolvedValue(
      WORK_VIEWS.map((definition) => ({
        definition,
        rows:
          definition.key === "chaseToday"
            ? [
                {
                  caseId: "11111111-1111-4111-8111-111111111111",
                  companyName: "Harbour local",
                  returnYear: 2026,
                  filingDueDate: "2026-10-10",
                  daysRemaining: 8,
                  ownerName: "Controlled owner",
                  blocker:
                    "A very long reason that must remain available to the operator without a clipped line",
                },
              ]
            : [],
      })),
    );
    await mount();
    const reason = await screen.findByText(
      "A very long reason that must remain available to the operator without a clipped line",
    );
    expect(reason.closest("details")).toBeTruthy();
    expect(screen.getByRole("link", { name: "開啟案件" }).getAttribute("data-search")).toContain(
      "q=Harbour",
    );
    fireEvent.change(screen.getByLabelText("搜尋今日工作"), { target: { value: "New search" } });
    expect(state.navigate).toHaveBeenCalled();
  });
});
