// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  recommend: vi.fn(),
  assign: vi.fn(),
  ack: vi.fn(),
  navigate: vi.fn(),
  dataMode: "production" as "demo" | "production",
  actorId: "admin",
  bulk: vi.fn(),
  search: {
    view: "team",
    owner: "all",
    workType: "all",
    sla: "all",
    priority: "all",
    status: "all",
    q: "",
    sort: "deadline",
    cursor: undefined as string | undefined,
    contextError: undefined as boolean | undefined,
  },
}));
vi.mock("@/components/bulk-selection-toolbar", () => ({
  BulkSelectionToolbar: ({ resource, filters }: { resource: string; filters: unknown }) => {
    mocks.bulk(filters);
    return <section aria-label="Bulk assignment">{resource}</section>;
  },
}));
vi.mock("@/features/work-items/server-fns", () => ({
  listWorkQueuePage: mocks.list,
  recommendWorkItemAssignees: mocks.recommend,
  assignWorkItem: mocks.assign,
  acknowledgeWorkItemEscalation: mocks.ack,
}));
vi.mock("@/features/auth/auth-context-neon", () => ({
  useAuth: () => ({ session: { role: "Admin" } }),
}));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => (options: object) => ({
    ...options,
    useSearch: () => mocks.search,
    useNavigate: () => mocks.navigate,
    useRouteContext: () => ({
      dataMode: mocks.dataMode,
      actor: {
        userId: mocks.actorId,
        authUserId: mocks.actorId,
        role: "Admin",
        teamId: null,
        active: true,
      },
    }),
  }),
  Link: ({
    children,
    search,
  }: {
    children: React.ReactNode;
    search?: { returnTo?: string; cursor?: string };
  }) => (
    <a href="#" data-return-to={search?.returnTo} data-route-search={JSON.stringify(search)}>
      {children}
    </a>
  ),
}));
import { WorkQueueRoute } from "./work-queue";
beforeEach(() => {
  mocks.actorId = "admin";
  mocks.search = {
    view: "team",
    owner: "all",
    workType: "all",
    sla: "all",
    priority: "all",
    status: "all",
    q: "",
    sort: "deadline",
    cursor: undefined,
    contextError: undefined,
  };
  mocks.navigate.mockClear();
  mocks.bulk.mockClear();
  mocks.list.mockReset();
});
afterEach(() => {
  cleanup();
  mocks.dataMode = "production";
});
describe("work queue in demo mode", () => {
  it("explains the empty queue instead of calling the production server", () => {
    // Demo mode has no database; the call used to spin on "Loading work
    // queue..." through three retries and then report a load failure.
    mocks.dataMode = "demo";
    mocks.list.mockClear();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <WorkQueueRoute />
      </QueryClientProvider>,
    );

    expect(mocks.list).not.toHaveBeenCalled();
    expect(screen.queryByText("工作隊列載入中…")).toBeNull();
    expect(screen.getByText(/示範模式沒有可讀取的工作項目/)).toBeTruthy();
  });
});
describe("work queue assignment and blockers", () => {
  it("offers recovery for malformed filters without issuing queue or bulk reads", () => {
    mocks.search.contextError = true;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <WorkQueueRoute />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("alert").textContent).toContain("篩選連結無效");
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.bulk).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "清除無效篩選" }));
    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ search: expect.objectContaining({ view: "mine", q: "" }) }),
    );
  });
  it("retains successful rows when the next cursor fails, and clears them across actors", async () => {
    const item = {
      id: "retained-work",
      version: 1,
      title: "Owned previous page",
      companyName: "Scoped company",
      companyId: "company",
      workType: "annual_return_case",
      caseType: "annual_return",
      annualReturnCaseId: "case",
      ownerId: null,
      ownerName: null,
      slaDueAt: "2026-10-22T00:00:00Z",
      escalationState: "warning",
      status: "open",
      priority: 50,
    };
    mocks.list
      .mockResolvedValueOnce({ items: [item], nextCursor: "page-2" })
      .mockRejectedValue(new Error("private cursor error"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const renderView = () => (
      <QueryClientProvider client={client}>
        <WorkQueueRoute />
      </QueryClientProvider>
    );
    const view = render(renderView());
    await screen.findAllByText("Owned previous page");
    mocks.search.cursor = "page-2";
    view.rerender(renderView());
    await screen.findByText(/無法載入這一頁/);
    expect(screen.getAllByText("Owned previous page").length).toBeGreaterThan(0);
    expect(screen.queryByText("private cursor error")).toBeNull();
    for (const link of screen.getAllByRole("link", { name: "Owned previous page" }))
      expect(
        new URL(link.getAttribute("data-return-to")!, "https://local.invalid").searchParams.get(
          "cursor",
        ),
      ).toBeNull();
    fireEvent.click(screen.getAllByTitle("確認知悉升級")[0]);
    expect(screen.getByRole("dialog")).toBeTruthy();
    mocks.actorId = "another-actor";
    view.rerender(renderView());
    await waitFor(() => expect(screen.queryByText("Owned previous page")).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("keeps the same return context on desktop and mobile case links", async () => {
    mocks.search.q = "香港";
    mocks.list.mockResolvedValue({
      items: [
        {
          id: "context-work",
          version: 1,
          title: "Context task",
          companyName: "香港測試",
          companyId: "c",
          workType: "annual_return_case",
          caseType: "annual_return",
          annualReturnCaseId: "case",
          ownerId: null,
          ownerName: null,
          slaDueAt: "2026-10-22T00:00:00Z",
          escalationState: "none",
          status: "open",
          priority: 50,
        },
      ],
      nextCursor: null,
    });
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <WorkQueueRoute />
      </QueryClientProvider>,
    );
    const links = await screen.findAllByRole("link", { name: "Context task" });
    expect(links).toHaveLength(2);
    for (const link of links)
      expect(
        new URL(link.getAttribute("data-return-to")!, "https://local.invalid").searchParams.get(
          "q",
        ),
      ).toBe("香港");
  });
  it("uses the effective breached predicate for both reads and all-results snapshots", async () => {
    mocks.search.view = "breached";
    mocks.search.sla = "warning";
    mocks.list.mockResolvedValue({ items: [], nextCursor: null });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <WorkQueueRoute />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(mocks.list).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ escalationState: "breach" }) }),
      ),
    );
    expect(mocks.bulk).toHaveBeenLastCalledWith(
      expect.objectContaining({ view: "breached", escalationState: "breach" }),
    );
  });
  it("starts a new view from its first page", () => {
    mocks.search.cursor = "old-view-page2";
    mocks.list.mockResolvedValue({ items: [], nextCursor: null });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <WorkQueueRoute />
      </QueryClientProvider>,
    );
    const destination = JSON.parse(
      screen.getByRole("link", { name: "我的工作" }).getAttribute("data-route-search")!,
    );
    expect(destination.cursor).toBeUndefined();
  });
  it("shows real identity, payment blocker with on-track SLA, and current owner/reviewer candidates", async () => {
    const userId = "20000000-0000-0000-0000-000000000001";
    const factors = {
      capacityUtilization: 0,
      skillProficiency: 5,
      workloadPoints: 0,
      continuityBonus: 0,
    };
    mocks.list.mockResolvedValue({
      items: [
        {
          id: "wi",
          version: 1,
          title: "Review case",
          companyName: "Scoped company",
          companyId: "c",
          workType: "annual_return_case",
          caseType: "annual_return",
          annualReturnCaseId: "case",
          ownerId: userId,
          ownerName: "Amy Chan",
          ownerTeamName: "Team A",
          slaDueAt: "2026-10-02T00:00:00Z",
          escalationState: "none",
          status: "open",
          priority: 50,
          businessContext: {
            filingDueDate: "2026-11-01",
            sourceVersion: "v",
            blockers: [
              {
                code: "payment_not_received",
                message: "Payment missing",
                action: "/payments",
                stage: "prepare",
              },
            ],
          },
        },
      ],
      nextCursor: null,
    });
    mocks.recommend.mockResolvedValue([
      {
        rank: 1,
        staffId: "staff",
        userId,
        displayName: "Amy Chan",
        teamName: "Team A",
        active: true,
        workload: 2,
        score: 500,
        factors,
      },
      {
        rank: 2,
        staffId: "staff2",
        userId: "inactive",
        displayName: "Inactive person",
        teamName: "Team A",
        active: false,
        workload: 0,
        score: 500,
        factors,
      },
    ]);
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <WorkQueueRoute />
      </QueryClientProvider>,
    );
    await screen.findByText("Amy Chan · Team A");
    expect(screen.getByText("work_item")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("搜尋案件或工作類型"), {
      target: { value: "Scoped company" },
    });
    expect(mocks.navigate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        search: expect.objectContaining({ q: "Scoped company", cursor: undefined }),
      }),
    );
    expect(screen.getAllByText("Review case").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Payment missing").length).toBeGreaterThan(0);
    expect(screen.queryByText("None")).toBeNull();
    expect(screen.queryByText("Staff 20000000")).toBeNull();
    fireEvent.click(screen.getAllByTitle("分配工作項目")[0]);
    await screen.findByRole("button", { name: /Amy Chan · Team A/ });
    expect(screen.queryByText("Inactive person")).toBeNull();
    fireEvent.change(screen.getByLabelText("分配角色"), {
      target: { value: "reviewer" },
    });
    await waitFor(() =>
      expect(mocks.recommend).toHaveBeenLastCalledWith({
        data: { workItemId: "wi", assignmentTarget: "reviewer" },
      }),
    );
  });
});
