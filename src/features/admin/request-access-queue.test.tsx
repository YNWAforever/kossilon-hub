// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const listRequestAccessQueue = vi.hoisted(() => vi.fn());
const decideRequestAccess = vi.hoisted(() => vi.fn());

vi.mock("@/features/onboarding/server-fns", () => ({
  listRequestAccessQueue,
  decideRequestAccess,
}));

import { RequestAccessQueue } from "./request-access-queue";
import { formatDateTime } from "@/lib/format-date";

const row = {
  id: "11111111-1111-4111-8111-111111111111",
  createdAt: "2026-11-09T01:00:00.000Z",
  name: "Amy Chan",
  email: "amy@example.test",
  firm: "Example Secretarial Ltd",
  team: "Team A",
  message: "Please invite me.",
  status: "pending" as const,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RequestAccessQueue", () => {
  it("explains the pre-migration state instead of erroring", async () => {
    listRequestAccessQueue.mockResolvedValue({ available: false, rows: [] });

    render(<RequestAccessQueue />);

    expect(await screen.findByText(/尚未啟用（待資料庫遷移 0083）/)).toBeTruthy();
  });

  it("shows an empty state when the queue is enabled but empty", async () => {
    listRequestAccessQueue.mockResolvedValue({ available: true, rows: [] });

    render(<RequestAccessQueue />);

    expect(await screen.findByText("暫無待處理申請。")).toBeTruthy();
  });

  it("lists a pending request and records an approval", async () => {
    listRequestAccessQueue.mockResolvedValue({ available: true, rows: [row] });
    decideRequestAccess.mockResolvedValue({ ok: true });

    render(<RequestAccessQueue />);

    expect(await screen.findByText("Amy Chan")).toBeTruthy();
    expect(screen.getByText(/amy@example.test/)).toBeTruthy();
    expect(screen.getByText(/Example Secretarial Ltd/)).toBeTruthy();
    // Timestamps are the firm's Hong Kong day, not the running machine's zone.
    expect(screen.getByText(/提交於/).textContent).toContain(formatDateTime(row.createdAt));

    fireEvent.click(screen.getByRole("button", { name: "批准" }));

    await waitFor(() =>
      expect(decideRequestAccess).toHaveBeenCalledWith({
        data: { id: row.id, status: "approved" },
      }),
    );
    await waitFor(() => expect(screen.queryByRole("button", { name: "批准" })).toBeNull());
    const handoff = screen.getByRole("status");
    expect(handoff.textContent).toContain("已批准");
    expect(handoff.textContent).toContain("amy@example.test");
    expect(handoff.textContent).toContain("Neon Auth");
    expect(handoff.textContent).toContain("用戶管理");
  });

  it("reports a conflict and refreshes when another admin decided first", async () => {
    listRequestAccessQueue.mockResolvedValue({ available: true, rows: [row] });
    decideRequestAccess.mockResolvedValue({ ok: false, code: "not-found" });
    listRequestAccessQueue
      .mockResolvedValueOnce({ available: true, rows: [row] })
      .mockResolvedValueOnce({ available: true, rows: [] });

    render(<RequestAccessQueue />);
    fireEvent.click(await screen.findByRole("button", { name: "拒絕" }));

    expect((await screen.findByRole("alert")).textContent).toContain("已由其他管理員處理");
    await waitFor(() => expect(screen.getByText("暫無待處理申請。")).toBeTruthy());
  });
});
