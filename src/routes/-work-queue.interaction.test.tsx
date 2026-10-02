// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
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
  listWorkQueue: mocks.list,
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
    useSearch: () => ({
      view: "team",
      owner: "all",
      workType: "all",
      sla: "all",
      priority: "all",
      status: "all",
    }),
    useNavigate: () => mocks.navigate,
    useRouteContext: () => ({
      dataMode: "production",
      actor: { userId: "admin", authUserId: "auth", role: "Admin", teamId: null, active: true },
    }),
  }),
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
import { WorkQueueRoute } from "./work-queue";
afterEach(cleanup);
describe("work queue assignment and blockers", () => {
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
