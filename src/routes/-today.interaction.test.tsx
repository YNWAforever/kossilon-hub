// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense } from "react";
const state = vi.hoisted(() => ({
  query: vi.fn(),
  metrics: vi.fn(),
  other: vi.fn(),
  actor: undefined as undefined | { active: boolean; authUserId: string },
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
  getAnnualReturnWorkMetrics: state.metrics,
}));
vi.mock("@/features/annual-return/work-views-other-server", () => ({
  getOtherBusinessWorkPage: state.other,
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (options: unknown) => ({
    options,
    useRouteContext: () => ({ dataMode: "production", actor: state.actor }),
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
  state.actor = undefined;
  state.metrics.mockReset().mockResolvedValue({
    chaseToday: 10000,
    newlyReceived: 0,
    awaitingMyReview: 0,
    readyToFile: 0,
    returnsAndExceptions: 0,
  });
  state.other.mockReset().mockResolvedValue({ rows: [], nextCursor: null });
});
async function mount(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  await act(async () => {
    render(
      <QueryClientProvider client={client}>
        <Suspense fallback={<p>Testing load</p>}>
          <Page />
        </Suspense>
      </QueryClientProvider>,
    );
  });
}
describe("Today truthful journey state", () => {
  // Under the full parallel suite the default 1s wait for the first render was
  // occasionally not enough (seen at 1086ms), so it allows 5s.
  it("uses server totals and offers explicit next-page navigation", async () => {
    state.query.mockResolvedValue([
      ...WORK_VIEWS.map((definition) => ({ definition, rows: [] })),
      { sentinel: true },
    ]);
    await mount();
    await screen.findByRole("button", { name: "今日要追 (10000)" }, { timeout: 5000 });
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

function annualRows() {
  return WORK_VIEWS.map((definition) => ({
    definition,
    rows:
      definition.key === "chaseToday"
        ? [
            {
              caseId: "11111111-1111-4111-8111-111111111111",
              companyName: "Old queue company",
              returnYear: 2026,
              daysRemaining: 3,
              ownerName: "Staff",
              blocker: "Old blocker",
            },
          ]
        : [],
  }));
}

it("hides cached annual rows after denied refresh and deduplicates read-only retry", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  state.query.mockResolvedValue(annualRows());
  await mount(client);
  await screen.findByRole("link", { name: "開啟案件" });
  state.query.mockRejectedValue(new Error("private error"));
  await act(async () => {
    await client.refetchQueries({ queryKey: ["annual-return", "work-views"] });
  });
  await screen.findByRole("button", { name: "重新載入" });
  expect(screen.queryByRole("link", { name: "開啟案件" })).toBeNull();
  expect(screen.queryByText("Old queue company")).toBeNull();
  expect(screen.queryByText("現時沒有這一類工作。")).toBeNull();
  let resolve!: (value: unknown) => void;
  state.query.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const retry = screen.getByRole("button", { name: "重新載入" });
  act(() => {
    retry.click();
    retry.click();
  });
  await waitFor(() => expect(state.query).toHaveBeenCalledTimes(3));
  expect((retry as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("link", { name: "開啟案件" })).toBeNull();
  await act(async () => resolve(WORK_VIEWS.map((definition) => ({ definition, rows: [] }))));
  await screen.findByText("現時沒有這一類工作。");
  expect(state.metrics).toHaveBeenCalledTimes(1);
  expect(state.navigate).not.toHaveBeenCalled();
});

it("hides cached totals after denial and restores fresh totals with one pending retry", async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  state.query.mockResolvedValue(annualRows());
  await mount(client);
  await screen.findByRole("button", { name: "今日要追 (10000)" });
  state.metrics.mockRejectedValue(new Error("denied"));
  await act(async () => {
    await client.refetchQueries({ queryKey: ["annual-return", "work-metrics"] });
  });
  await screen.findByRole("button", { name: "重試總數" });
  expect(screen.queryByRole("button", { name: "今日要追 (10000)" })).toBeNull();
  let resolve!: (value: unknown) => void;
  state.metrics.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const retry = screen.getByRole("button", { name: "重試總數" });
  act(() => {
    retry.click();
    retry.click();
  });
  await waitFor(() => expect(state.metrics).toHaveBeenCalledTimes(3));
  expect((retry as HTMLButtonElement).disabled).toBe(true);
  await act(async () => resolve({ chaseToday: 7 }));
  await screen.findByRole("button", { name: "今日要追 (7)" });
  expect(state.query).toHaveBeenCalledTimes(1);
});

it("hides other-business links after denial and restores only fresh readback without navigation", async () => {
  state.actor = { active: true, authUserId: "staff" };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  state.query.mockResolvedValue(annualRows());
  state.other.mockResolvedValue({
    rows: [
      {
        business: "incorporation",
        caseId: "other-case",
        companyName: "Old other company",
        target: "/incorporations/$id",
        status: "Pending",
        statusAt: null,
        daysRemaining: null,
        dueDate: null,
        blocker: "Old other blocker",
        nextStep: "Review",
      },
    ],
    nextCursor: null,
  });
  await mount(client);
  await screen.findByRole("link", { name: "開啟公司註冊" });
  state.other.mockRejectedValue(new Error("private error"));
  await act(async () => {
    await client.refetchQueries({ queryKey: ["today-other-business"] });
  });
  const retry = await screen.findByRole("button", { name: "重試其他業務" });
  expect(screen.queryByRole("link", { name: "開啟公司註冊" })).toBeNull();
  expect(screen.queryByText("Old other company")).toBeNull();
  let resolve!: (value: unknown) => void;
  state.other.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  act(() => {
    retry.click();
    retry.click();
  });
  await waitFor(() => expect(state.other).toHaveBeenCalledTimes(3));
  expect((retry as HTMLButtonElement).disabled).toBe(true);
  await act(async () => resolve({ rows: [], nextCursor: null }));
  await screen.findByText("此分類沒有符合的公司註冊或公司變更工作。");
  expect(state.query).toHaveBeenCalledTimes(1);
  expect(state.metrics).toHaveBeenCalledTimes(1);
  expect(state.navigate).not.toHaveBeenCalled();
});
