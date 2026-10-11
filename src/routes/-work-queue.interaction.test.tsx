// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  page: vi.fn(),
  options: vi.fn(),
  search: null as Record<string, string> | null,
  recommend: vi.fn(),
  assign: vi.fn(),
  ack: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock("@/components/bulk-selection-toolbar", () => ({
  BulkSelectionToolbar: ({ resource }: { resource: string }) => (
    <section aria-label="Bulk assignment">{resource}</section>
  ),
}));
vi.mock("@/features/work-items/server-fns", () => ({
  listWorkQueueFilterOptions: async (input: { data: { kind: string } }) => {
    if (mocks.options.getMockImplementation()) return mocks.options(input);
    const items = (await mocks.list()) ?? [];
    return {
      items:
        input.data.kind === "owner"
          ? items
              .filter((x: { ownerId?: string }) => x.ownerId)
              .map((x: { ownerId: string; ownerName: string; ownerTeamName?: string }) => ({
                id: x.ownerId,
                label: x.ownerName + (x.ownerTeamName ? " · " + x.ownerTeamName : ""),
              }))
          : [...new Set(items.map((x: { workType: string }) => x.workType))].map((id) => ({
              id,
              label: id,
            })),
      nextCursor: null,
    };
  },
  listWorkQueue: mocks.list,
  listWorkQueuePage: async (input: unknown) => {
    if (mocks.page.getMockImplementation()) return mocks.page(input);
    const items = await mocks.list(input);
    return {
      items,
      total: items.length,
      nextCursor: null,
      observedAt: "2026-10-12T00:00:00Z",
      metrics: { dueToday: 0, atRisk: 0, breached: 0, unassigned: 0 },
    };
  },
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
    useSearch: () =>
      mocks.search ?? {
        view: "team",
        owner: "all",
        workType: "all",
        sla: "all",
        priority: "all",
        status: "all",
      },
    useNavigate: () => mocks.navigate,
    useRouteContext: () => ({
      dataMode: "production",
      actor: { userId: "admin", authUserId: "auth", role: "Admin", teamId: null, active: true },
    }),
  }),
  Link: ({ children, search }: { children: React.ReactNode; search: unknown }) => (
    <span data-search={JSON.stringify(search)}>{children}</span>
  ),
}));
import { WorkQueueRoute } from "./work-queue";
afterEach(() => {
  cleanup();
  mocks.page.mockReset();
  mocks.options.mockReset();
  mocks.search = null;
});
describe("work queue assignment and blockers", () => {
  it("offers authorized owner and type found beyond the loaded page and retains a narrowed selection", async () => {
    mocks.page.mockResolvedValue({
      items: [],
      total: 51,
      nextCursor: "next",
      observedAt: "2026-10-12T00:00:00Z",
      metrics: { dueToday: 0, atRisk: 0, breached: 0, unassigned: 0 },
    });
    mocks.options.mockImplementation(({ data }: { data: { kind: string; q: string } }) =>
      Promise.resolve({
        items: data.q
          ? []
          : [
              {
                id: data.kind === "owner" ? "20000000-0000-0000-0000-000000000099" : "later_type",
                label: data.kind === "owner" ? "Owner beyond row50" : "later_type",
              },
            ],
        nextCursor: null,
      }),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const rendered = render(
      <QueryClientProvider client={client}>
        <WorkQueueRoute />
      </QueryClientProvider>,
    );
    await screen.findByRole("option", { name: "Owner beyond row50" });
    expect(screen.getByRole("option", { name: "later_type" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Filter by owner"), {
      target: { value: "20000000-0000-0000-0000-000000000099" },
    });
    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({
        search: expect.objectContaining({ owner: "20000000-0000-0000-0000-000000000099" }),
      }),
    );
    expect(mocks.options).toHaveBeenCalledWith({
      data: expect.objectContaining({ kind: "owner", view: "team", limit: 50 }),
    });
    mocks.search = {
      view: "team",
      owner: "20000000-0000-0000-0000-000000000099",
      workType: "all",
      sla: "all",
      priority: "all",
      status: "all",
    };
    rendered.rerender(
      <QueryClientProvider client={client}>
        <WorkQueueRoute />
      </QueryClientProvider>,
    );
    expect(screen.getByText("My work").getAttribute("data-search")).toContain('"owner":"all"');
    fireEvent.change(screen.getByLabelText("搜尋負責人選項"), { target: { value: "no match" } });
    await waitFor(() =>
      expect(mocks.options).toHaveBeenCalledWith({
        data: expect.objectContaining({ q: "no match" }),
      }),
    );
    expect(screen.getByRole("option", { name: "Owner beyond row50" })).toBeTruthy();
  });
  it("reads a bounded server page and displays the server total rather than loaded rows", async () => {
    mocks.page.mockResolvedValue({
      items: [],
      total: 153,
      nextCursor: "next",
      observedAt: "2026-10-12T00:00:00Z",
      metrics: { dueToday: 3, atRisk: 4, breached: 5, unassigned: 6 },
    });
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <WorkQueueRoute />
      </QueryClientProvider>,
    );
    await screen.findByText(/共153項/);
    expect(mocks.page).toHaveBeenCalledWith({
      data: expect.objectContaining({ view: "team", limit: 50 }),
    });
    expect(screen.getByRole("button", { name: /下一頁/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /下一頁/ }));
    expect(mocks.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ search: expect.objectContaining({ cursor: "next" }) }),
    );
    mocks.page.mockReset();
  });
  it("shows real identity, payment blocker with on-track SLA, and current owner/reviewer candidates", async () => {
    const userId = "20000000-0000-0000-0000-000000000001";
    const factors = {
      capacityUtilization: 0,
      skillProficiency: 5,
      workloadPoints: 0,
      continuityBonus: 0,
    };
    mocks.list.mockResolvedValue([
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
    ]);
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
    fireEvent.change(screen.getByPlaceholderText("Search case or work type"), {
      target: { value: "Scoped company" },
    });
    expect(screen.getAllByText("Review case").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Payment missing").length).toBeGreaterThan(0);
    expect(screen.queryByText("None")).toBeNull();
    expect(screen.queryByText("Staff 20000000")).toBeNull();
    fireEvent.click(screen.getAllByTitle("Assign work item")[0]);
    await screen.findByRole("button", { name: /Amy Chan · Team A/ });
    expect(screen.queryByText("Inactive person")).toBeNull();
    fireEvent.change(screen.getByLabelText("Assignment responsibility"), {
      target: { value: "reviewer" },
    });
    await waitFor(() =>
      expect(mocks.recommend).toHaveBeenLastCalledWith({
        data: { workItemId: "wi", assignmentTarget: "reviewer" },
      }),
    );
  });
});
