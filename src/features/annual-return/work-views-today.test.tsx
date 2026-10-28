// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense } from "react";
import { defaultParseSearch } from "@tanstack/react-router";

const state = vi.hoisted(() => ({
  read: vi.fn(),
  annualRead: vi.fn(),
  navigate: vi.fn(),
  actor: { authUserId: "auth-a", userId: "staff-a", role: "Staff", teamId: "team-a", active: true },
  search: {
    view: "chaseToday",
    q: "海港",
    sort: "deadline",
    cursor: undefined as string | undefined,
    otherCursor: undefined as string | undefined,
  },
}));
vi.mock("./server-fns", () => ({
  getAnnualReturnWorkPage: state.annualRead,
  getAnnualReturnWorkMetrics: async () => ({ chaseToday: 0 }),
}));
vi.mock("./work-views-other-server", () => ({ getOtherBusinessWorkPage: state.read }));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (options: unknown) => ({
    options,
    useRouteContext: () => ({ dataMode: "production", actor: state.actor }),
    useSearch: () => state.search,
  }),
  useNavigate: () => state.navigate,
  Link: ({
    to,
    params,
    search,
    children,
  }: {
    to: string;
    params: { id: string };
    search: Record<string, string>;
    children: import("react").ReactNode;
  }) => <a href={to.replace("$id", params.id) + "?" + new URLSearchParams(search)}>{children}</a>,
}));
import { Route } from "@/routes/today";
const Page = Route.options.component!;
const incorporation = {
  business: "incorporation",
  target: "/incorporation/$id",
  caseId: "inc-a",
  companyName: "海港註冊",
  ownerName: "Ada",
  reviewerName: null,
  dueDate: "2026-10-22",
  daysRemaining: -1,
  status: "Documents pending",
  statusAt: "2026-10-22T16:30:00Z",
  blocker: "公司章程",
  nextStep: "追收及核對缺少文件",
  readyForApproval: false,
};
async function mount(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  let rendered: ReturnType<typeof render>;
  await act(async () => {
    rendered = render(
      <QueryClientProvider client={client}>
        <Suspense>
          <Page />
        </Suspense>
      </QueryClientProvider>,
    );
  });
  return rendered!;
}
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  state.search = {
    view: "chaseToday",
    q: "海港",
    sort: "deadline",
    cursor: undefined,
    otherCursor: undefined,
  };
  state.annualRead.mockResolvedValue({ rows: [], nextCursor: null });
  state.actor = {
    authUserId: "auth-a",
    userId: "staff-a",
    role: "Staff",
    teamId: "team-a",
    active: true,
  };
  state.read.mockResolvedValue({
    rows: [
      incorporation,
      {
        ...incorporation,
        business: "corporate_change",
        target: "/corporate-changes/$id",
        caseId: "change-a",
        companyName: "海港變更",
        dueDate: null,
        daysRemaining: null,
      },
    ],
    nextCursor: null,
  });
});
describe("Today incorporation and corporate change work", () => {
  it("keeps numeric search and both cursors on every business detail link", async () => {
    state.search = {
      view: "chaseToday",
      q: "12345",
      sort: "company",
      cursor: '["company","2026-10-23","12345","00000000-0000-0000-0000-000000000001"]',
      otherCursor: "owned-other-page-3",
    };
    state.annualRead.mockResolvedValue({
      rows: [
        {
          caseId: "00000000-0000-0000-0000-000000000001",
          companyName: "12345",
          returnYear: 2026,
          filingDueDate: "2026-10-23",
          daysRemaining: 0,
          ownerName: "Ada",
          blocker: "核對文件",
        },
      ],
      nextCursor: null,
    });
    await mount();
    await screen.findByRole("link", { name: "開啟案件" }, { timeout: 5000 });
    await screen.findByRole("link", { name: "開啟公司註冊" }, { timeout: 5000 });
    for (const name of ["開啟案件", "開啟公司註冊", "開啟公司變更"]) {
      const detail = new URL(
        screen.getByRole("link", { name }).getAttribute("href")!,
        "https://local.test",
      );
      const returnTo = (defaultParseSearch(detail.search) as { returnTo: string }).returnTo;
      expect(typeof returnTo).toBe("string");
      const restored = defaultParseSearch(new URL(returnTo, "https://local.test").search);
      expect(restored).toEqual(state.search);
    }
  });
  it("shows both domain links, context, first action and explicit unknown deadline/reviewer", async () => {
    await mount();
    await screen.findByText("海港註冊", {}, { timeout: 5000 });
    expect(screen.getByRole("link", { name: "開啟公司註冊" }).getAttribute("href")).toContain(
      "/incorporation/inc-a?",
    );
    const change = screen.getByRole("link", { name: "開啟公司變更" }).getAttribute("href")!;
    expect(change).toContain("/corporate-changes/change-a?");
    expect(new URL(change, "https://local.test").searchParams.get("returnTo")).toContain(
      "q=%E6%B5%B7%E6%B8%AF",
    );
    expect(screen.getAllByText("追收及核對缺少文件")).toHaveLength(2);
    expect(screen.getByText("期限未能判定")).toBeTruthy();
    expect(screen.getAllByText(/覆核人未指定/)).toHaveLength(2);
    expect(screen.getAllByText(/2026\/10\/23.*00:30/)).toHaveLength(2);
  });
  it("keeps read failures separate from zero work and offers retry", async () => {
    state.read.mockRejectedValue(new Error("unavailable"));
    await mount();
    await screen.findByText(/公司註冊及公司變更未能載入/);
    expect(screen.queryByText("此分類沒有符合的公司註冊或公司變更工作。")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重試其他業務" }));
    await waitFor(() => expect(state.read).toHaveBeenCalledTimes(2));
  });
  it("requests a bounded page and uses an independent continuation", async () => {
    state.read.mockResolvedValue({ rows: [incorporation], nextCursor: "next-other" });
    await mount();
    await screen.findByText("海港註冊", {}, { timeout: 5000 });
    expect(state.read).toHaveBeenCalledWith({
      data: { view: "chaseToday", q: "海港", sort: "deadline", cursor: undefined, limit: 25 },
    });
    fireEvent.click(screen.getByRole("button", { name: "下一頁其他業務" }));
    expect(state.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ search: expect.objectContaining({ otherCursor: "next-other" }) }),
    );
  });
  it("clears the prior team rows while the new actor read is pending", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rendered = await mount(client);
    await screen.findByText("海港註冊", {}, { timeout: 5000 });
    state.actor = { ...state.actor, authUserId: "auth-b", teamId: "team-b" };
    state.read.mockImplementation(() => new Promise(() => {}));
    await act(async () => {
      rendered.rerender(
        <QueryClientProvider client={client}>
          <Suspense>
            <Page />
          </Suspense>
        </QueryClientProvider>,
      );
    });
    expect(screen.queryByText("海港註冊")).toBeNull();
  });
});
