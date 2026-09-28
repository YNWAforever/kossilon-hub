// @vitest-environment jsdom

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnualReturnCase } from "../types";
import type { AnnualReturnBoardSearch } from "../board-filters";
import { ProductionAnnualReturnCommandCenter } from "./production-command-center";

const serverFns = vi.hoisted(() => ({
  listAnnualReturnCasePage: vi.fn(),
  getAnnualReturnBoardTotals: vi.fn(),
  listAssignableStaff: vi.fn(),
  listCompaniesEligibleForCase: vi.fn(),
  listWorkQueue: vi.fn(),
}));

vi.mock("../server-fns", () => ({
  listAnnualReturnCasePage: serverFns.listAnnualReturnCasePage,
  getAnnualReturnBoardTotals: serverFns.getAnnualReturnBoardTotals,
  listAssignableStaff: serverFns.listAssignableStaff,
  listCompaniesEligibleForCase: serverFns.listCompaniesEligibleForCase,
}));
vi.mock("@/features/work-items/server-fns", () => ({ listWorkQueue: serverFns.listWorkQueue }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/annual-returns">{children}</a>,
}));

function makeCase(index: number, overrides: Partial<AnnualReturnCase> = {}): AnnualReturnCase {
  return {
    id: "case-" + index,
    companyId: "company-" + index,
    companyTeamId: "team-1",
    companyName: "Company " + index,
    returnYear: 2026,
    madeUpDate: "2026-06-30",
    filingDueDate: "2026-08-11",
    currentStatus: "Upcoming",
    riskLevel: "green",
    ownerId: "owner-1",
    ownerName: "Ada Chan",
    reviewerId: null,
    reviewerName: null,
    remindersSent: 0,
    filingReference: null,
    confirmationDocumentId: null,
    lockedAt: null,
    completedAt: null,
    checklist: [],
    payment: null,
    ...overrides,
  };
}

function board(
  search: AnnualReturnBoardSearch = {},
  onSearchChange?: (next: AnnualReturnBoardSearch) => void,
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const renderBoard = (next: AnnualReturnBoardSearch) => (
    <QueryClientProvider client={client}>
      <ProductionAnnualReturnCommandCenter search={next} onSearchChange={onSearchChange} />
    </QueryClientProvider>
  );
  const result = render(renderBoard(search));
  return {
    ...result,
    rerenderSearch: (next: AnnualReturnBoardSearch) => result.rerender(renderBoard(next)),
  };
}

describe("T04 production board pagination", () => {
  beforeEach(() => {
    for (const fn of Object.values(serverFns)) fn.mockReset();
    serverFns.getAnnualReturnBoardTotals.mockResolvedValue({
      total: 401,
      overdue: 0,
      dueIn7: 0,
      dueIn30: 0,
      missingDocuments: 0,
      missingEvidenceItems: 0,
      paymentPending: 0,
    });
    serverFns.listAssignableStaff.mockResolvedValue([]);
    serverFns.listCompaniesEligibleForCase.mockResolvedValue([]);
    serverFns.listWorkQueue.mockResolvedValue([]);
  });
  afterEach(cleanup);

  it("debounces q for 300ms and keeps the latest owner filter", async () => {
    serverFns.listAnnualReturnCasePage.mockResolvedValue({ cases: [], nextCursor: null });
    const onSearchChange = vi.fn();
    const view = board({}, onSearchChange);
    await screen.findByText("No annual return cases match these filters.");
    vi.useFakeTimers();
    try {
      fireEvent.change(screen.getByLabelText("Search company"), { target: { value: "Alpha" } });
      view.rerenderSearch({ ownerId: "owner-2" });
      await act(async () => vi.advanceTimersByTime(299));
      expect(onSearchChange).not.toHaveBeenCalled();
      await act(async () => vi.advanceTimersByTime(1));
      expect(onSearchChange).toHaveBeenCalledWith({ ownerId: "owner-2", q: "Alpha" });
    } finally {
      vi.useRealTimers();
    }
  });
  it("t04_scenario_1 renders 401 cases as 200+200+1 once and hides the terminal button", async () => {
    serverFns.listAnnualReturnCasePage.mockImplementation(({ data }) => {
      if (!data.cursor)
        return Promise.resolve({
          cases: Array.from({ length: 200 }, (_, index) => makeCase(index + 1)),
          nextCursor: "cursor-200",
        });
      if (data.cursor === "cursor-200")
        return Promise.resolve({
          cases: Array.from({ length: 200 }, (_, index) => makeCase(index + 201)),
          nextCursor: "cursor-400",
        });
      if (data.cursor === "cursor-400")
        return Promise.resolve({ cases: [makeCase(401)], nextCursor: null });
      throw new Error("unexpected cursor");
    });
    board();
    await screen.findByText("Company 1");
    fireEvent.click(await screen.findByRole("button", { name: "載入更多" }));
    await screen.findByText("Company 400");
    fireEvent.click(screen.getByRole("button", { name: "載入更多" }));
    await screen.findByText("Company 401");
    expect(screen.getAllByText(/^Company \d+$/)).toHaveLength(401);
    await waitFor(() => expect(screen.queryByRole("button", { name: "載入更多" })).toBeNull());
    expect(
      serverFns.listAnnualReturnCasePage.mock.calls.map(([input]) => input.data.cursor ?? null),
    ).toEqual([null, "cursor-200", "cursor-400"]);
  });

  it("t04_scenario_2 continues through a risk-filtered empty page using the SQL cursor", async () => {
    serverFns.listAnnualReturnCasePage.mockImplementation(({ data }) => {
      if (!data.cursor)
        return Promise.resolve({
          cases: [makeCase(1, { riskLevel: "red" })],
          nextCursor: "sql-cursor-1",
        });
      if (data.cursor === "sql-cursor-1")
        return Promise.resolve({ cases: [], nextCursor: "sql-cursor-2" });
      if (data.cursor === "sql-cursor-2")
        return Promise.resolve({ cases: [makeCase(3, { riskLevel: "red" })], nextCursor: null });
      throw new Error("unexpected cursor");
    });
    board({ risk: "red" });
    await screen.findByText("Company 1");
    fireEvent.click(screen.getByRole("button", { name: "載入更多" }));
    await waitFor(() => expect(serverFns.listAnnualReturnCasePage).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "載入更多" }));
    await screen.findByText("Company 3");
    expect(
      serverFns.listAnnualReturnCasePage.mock.calls.map(([input]) => input.data.cursor ?? null),
    ).toEqual([null, "sql-cursor-1", "sql-cursor-2"]);
  });

  it("keeps loaded rows when a page fails and retries only the same cursor", async () => {
    let attempts = 0;
    serverFns.listAnnualReturnCasePage.mockImplementation(({ data }) => {
      if (!data.cursor) return Promise.resolve({ cases: [makeCase(1)], nextCursor: "after-one" });
      expect(data.cursor).toBe("after-one");
      attempts += 1;
      return attempts === 1
        ? Promise.reject(new Error("private SQL detail"))
        : Promise.resolve({ cases: [makeCase(2)], nextCursor: null });
    });
    board();
    await screen.findByText("Company 1");
    fireEvent.click(screen.getByRole("button", { name: "載入更多" }));
    await screen.findByText(/下一頁載入失敗/);
    expect(screen.getByText("Company 1")).toBeTruthy();
    expect(screen.queryByText("private SQL detail")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "重試載入更多" }));
    await screen.findByText("Company 2");
    expect(screen.getByText("Company 1")).toBeTruthy();
    expect(attempts).toBe(2);
    expect(screen.queryByRole("button", { name: "載入更多" })).toBeNull();
  });

  it("does not request one cursor twice while Load more is pending", async () => {
    let release!: (value: { cases: AnnualReturnCase[]; nextCursor: string | null }) => void;
    const pending = new Promise<{ cases: AnnualReturnCase[]; nextCursor: string | null }>(
      (resolve) => {
        release = resolve;
      },
    );
    serverFns.listAnnualReturnCasePage.mockImplementation(({ data }) =>
      data.cursor ? pending : Promise.resolve({ cases: [makeCase(1)], nextCursor: "after-one" }),
    );
    board();
    await screen.findByText("Company 1");
    const button = screen.getByRole("button", { name: "載入更多" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(serverFns.listAnnualReturnCasePage).toHaveBeenCalledTimes(2));
    await act(async () => release({ cases: [makeCase(2)], nextCursor: null }));
    await screen.findByText("Company 2");
    expect(screen.getAllByText(/^Company \d+$/)).toHaveLength(2);
    expect(serverFns.listAnnualReturnCasePage).toHaveBeenCalledTimes(2);
  });
  it("shows a duplicated server ID once without hiding the next page", async () => {
    serverFns.listAnnualReturnCasePage.mockImplementation(({ data }) =>
      data.cursor
        ? Promise.resolve({ cases: [makeCase(1), makeCase(2)], nextCursor: null })
        : Promise.resolve({ cases: [makeCase(1)], nextCursor: "after-one" }),
    );
    board();
    await screen.findByText("Company 1");
    fireEvent.click(screen.getByRole("button", { name: "載入更多" }));
    await screen.findByText("Company 2");
    expect(screen.getAllByText("Company 1")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "載入更多" })).toBeNull();
  });
  it("t04_scenario_3 discards an old page response after filters change", async () => {
    let releaseOldPage!: (value: { cases: AnnualReturnCase[]; nextCursor: string | null }) => void;
    const oldPage = new Promise<{ cases: AnnualReturnCase[]; nextCursor: string | null }>(
      (resolve) => {
        releaseOldPage = resolve;
      },
    );
    serverFns.listAnnualReturnCasePage.mockImplementation(({ data }) => {
      if (data.q === "Alpha" && !data.cursor)
        return Promise.resolve({
          cases: [makeCase(1, { companyName: "Alpha Company" })],
          nextCursor: "alpha-next",
        });
      if (data.q === "Alpha" && data.cursor === "alpha-next") return oldPage;
      if (data.q === "Beta" && !data.cursor)
        return Promise.resolve({
          cases: [makeCase(2, { companyName: "Beta Company" })],
          nextCursor: null,
        });
      throw new Error("unexpected filter/cursor");
    });
    const view = board({ q: "Alpha" });
    await screen.findByText("Alpha Company");
    fireEvent.click(screen.getByRole("button", { name: "載入更多" }));
    await waitFor(() => expect(serverFns.listAnnualReturnCasePage).toHaveBeenCalledTimes(2));
    view.rerenderSearch({ q: "Beta" });
    await screen.findByText("Beta Company");
    await act(async () =>
      releaseOldPage({ cases: [makeCase(9, { companyName: "Old Alpha Page" })], nextCursor: null }),
    );
    expect(screen.queryByText("Old Alpha Page")).toBeNull();
    expect(screen.getByText("Beta Company")).toBeTruthy();
  });
});
