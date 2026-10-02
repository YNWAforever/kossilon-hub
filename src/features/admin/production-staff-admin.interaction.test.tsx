// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffMember } from "./types";
const api = vi.hoisted(() => ({
  list: vi.fn(),
  teams: vi.fn(),
  preview: vi.fn(),
  audit: vi.fn(),
  update: vi.fn(),
}));
vi.mock("./server-fns", () => ({
  listStaff: api.list,
  listAdminTeams: api.teams,
  previewReassignment: api.preview,
  listStaffAudit: api.audit,
  updateStaff: api.update,
}));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  Link: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
import { ProductionStaffAdmin } from "./production-staff-admin";
const member: StaffMember = {
  userId: "20000000-0000-0000-0000-000000000003",
  displayName: "Mei Lam",
  email: "synthetic@example.test",
  role: "Staff",
  teamId: "10000000-0000-0000-0000-000000000001",
  teamName: "Annual return",
  active: true,
  expectedVersion: 7,
  openCases: 1,
  openWorkItems: 0,
  lastLogin: null,
  stateMismatch: false,
};
function view(scope = "verified-admin") {
  return <ProductionStaffAdmin actorScope={scope} />;
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}>{view()}</QueryClientProvider>);
}
beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.list.mockResolvedValue({ staff: [member], nextCursor: null });
  api.teams.mockResolvedValue([{ id: member.teamId, name: member.teamName, active: true }]);
  api.audit.mockResolvedValue([]);
  api.preview.mockResolvedValue({
    userId: member.userId,
    expectedVersion: 7,
    openCases: 1,
    openWorkItems: 0,
    cases: [{ id: "case", companyName: "Outstanding company", status: "Upcoming" }],
    workItems: [],
    truncated: false,
  });
});
afterEach(cleanup);
describe("verified staff maintenance UI", () => {
  it("shows concrete handover before disabling and never calls a provider invite", async () => {
    mount();
    await screen.findByText(/Mei Lam · Annual return/);
    expect(screen.getByText(/邀請未啟用/)).toBeTruthy();
    const details = screen.getByText("維護帳戶／轉交預覽").closest("details")!;
    fireEvent(details, new Event("toggle"));
    details.open = true;
    fireEvent(details, new Event("toggle"));
    await screen.findByText(/Outstanding company/);
    fireEvent.click(screen.getByLabelText("Active for Mei Lam"));
    expect((screen.getByText("套用帳戶變更") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText("套用帳戶變更"));
    expect(api.update).not.toHaveBeenCalled();
    expect(screen.getByText(/必須先完成轉交/)).toBeTruthy();
  });
  it("does not display a failed read as an empty roster", async () => {
    api.list.mockRejectedValue(new Error("synthetic read unavailable"));
    mount();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("沒有符合條件的員工紀錄。")).toBeNull();
  });
  it("requires a current handover preview and sends the displayed staff revision without auto retry", async () => {
    api.preview.mockResolvedValue({
      userId: member.userId,
      expectedVersion: 7,
      openCases: 0,
      openWorkItems: 0,
      cases: [],
      workItems: [],
      truncated: false,
    });
    api.update.mockRejectedValue(new Error("synthetic stale version"));
    mount();
    await screen.findByText(/Mei Lam · Annual return/);
    expect((screen.getByText("套用帳戶變更") as HTMLButtonElement).disabled).toBe(true);
    const details = screen.getByText("維護帳戶／轉交預覽").closest("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    await screen.findByText("當前未交案件：0；工作：0。");
    fireEvent.click(screen.getByLabelText("Active for Mei Lam"));
    fireEvent.click(screen.getByText("套用帳戶變更"));
    await waitFor(() =>
      expect(api.update).toHaveBeenCalledExactlyOnceWith({
        data: {
          userId: member.userId,
          expectedVersion: 7,
          role: "Staff",
          teamId: member.teamId,
          active: false,
        },
      }),
    );
    expect(await screen.findByText(/沒有自動重試/)).toBeTruthy();
  });
});
