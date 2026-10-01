// @vitest-environment jsdom

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnnualReturnCase } from "../types";
import type { AnnualReturnBoardSearch } from "../board-filters";
import { ProductionAnnualReturnCommandCenter } from "./production-command-center";

const serverFns = vi.hoisted(() => ({
  // The board reads a page and a totals aggregate now: `q` is a SQL predicate
  // and the tiles are counted across the actor's scope rather than over the rows
  // that happened to load.
  listAnnualReturnCasePage: vi.fn(),
  getAnnualReturnBoardTotals: vi.fn(),
  listAssignableStaff: vi.fn(),
  listCompaniesEligibleForCase: vi.fn(),
  listWorkQueue: vi.fn(),
  listActiveAnnualReturnTemplates: vi.fn(),
  listClientAssignmentOptions: vi.fn(),
}));

vi.mock("../server-fns", () => ({
  listAnnualReturnCasePage: serverFns.listAnnualReturnCasePage,
  getAnnualReturnBoardTotals: serverFns.getAnnualReturnBoardTotals,
  listAssignableStaff: serverFns.listAssignableStaff,
  listCompaniesEligibleForCase: serverFns.listCompaniesEligibleForCase,
}));
vi.mock("@/features/work-items/server-fns", () => ({ listWorkQueue: serverFns.listWorkQueue }));
vi.mock("@/features/checklist-templates/server-fns", () => ({
  listActiveAnnualReturnTemplates: serverFns.listActiveAnnualReturnTemplates,
}));
vi.mock("@/features/clients/server-fns", () => ({
  listClientAssignmentOptions: serverFns.listClientAssignmentOptions,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/annual-returns">{children}</a>,
}));

const caseId = "11111111-1111-4111-8111-111111111111";

function makeCase(overrides: Partial<AnnualReturnCase> = {}): AnnualReturnCase {
  return {
    id: caseId,
    companyId: "22222222-2222-4222-8222-222222222222",
    companyTeamId: "33333333-3333-4333-8333-333333333333",
    companyName: "Acme Company Limited",
    returnYear: 2026,
    madeUpDate: "2026-06-30",
    filingDueDate: "2026-08-11",
    currentStatus: "Upcoming",
    riskLevel: "green",
    ownerId: "44444444-4444-4444-8444-444444444444",
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

function renderBoard(
  allowFixtureDiagnostics = false,
  search: AnnualReturnBoardSearch = {},
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }),
) {
  return render(
    <QueryClientProvider client={client}>
      <ProductionAnnualReturnCommandCenter
        search={search}
        allowFixtureDiagnostics={allowFixtureDiagnostics}
      />
    </QueryClientProvider>,
  );
}

describe("production annual return command center", () => {
  it("does not retain a delayed former actor staff directory in the new owner picker", async () => {
    let oldResponse!: (rows: { id: string; name: string }[]) => void;
    serverFns.listAssignableStaff
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            oldResponse = resolve;
          }),
      )
      .mockResolvedValue([]);
    serverFns.listAnnualReturnCasePage.mockResolvedValue({ cases: [], nextCursor: null });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderBoard(false, {}, client);
    await waitFor(() => expect(serverFns.listAssignableStaff).toHaveBeenCalledTimes(1));
    view.rerender(
      <QueryClientProvider client={client}>
        <ProductionAnnualReturnCommandCenter
          search={{}}
          actorScope={{
            authUserId: "staff-auth",
            userId: "staff",
            role: "Staff",
            teamId: "new-team",
            active: true,
          }}
        />
      </QueryClientProvider>,
    );
    oldResponse([{ id: crypto.randomUUID(), name: "Former Admin private employee" }]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(screen.queryByRole("option", { name: "Former Admin private employee" })).toBeNull();
    expect(serverFns.listAssignableStaff).toHaveBeenCalledTimes(2);
  });
  it("does not show unavailable whole-scope totals as zero while keeping readable rows", async () => {
    serverFns.getAnnualReturnBoardTotals.mockRejectedValueOnce(new Error("private db error"));
    serverFns.listAnnualReturnCasePage.mockResolvedValueOnce({
      cases: [makeCase({ companyName: "Readable scoped case" })],
      nextCursor: null,
    });
    renderBoard();
    await screen.findByText("Readable scoped case");
    expect(
      await screen.findByText("未取得當前範圍統計。請重新載入；已讀取案件仍可查閱。"),
    ).toBeTruthy();
    expect(screen.getByText("Cases in scope").parentElement?.textContent).toContain("—");
    expect(screen.queryByText("private db error")).toBeNull();
  });
  beforeEach(() => {
    serverFns.listAnnualReturnCasePage.mockReset();
    serverFns.listWorkQueue.mockReset();
    serverFns.listWorkQueue.mockResolvedValue([]);
    serverFns.getAnnualReturnBoardTotals.mockResolvedValue({
      businessDate: "2026-10-01",
      activeCases: 1,
      overdueCases: 0,
      highRisk: 0,
      missingDocumentCount: 0,
      casesWithMissingDocuments: 0,
      assignedToMe: 1,
      total: 1,
      overdue: 0,
      dueIn7: 0,
      dueIn30: 1,
      missingDocuments: 0,
      paymentPending: 0,
    });
    serverFns.listAssignableStaff.mockResolvedValue([]);
    serverFns.listCompaniesEligibleForCase.mockResolvedValue([]);
    serverFns.listActiveAnnualReturnTemplates.mockResolvedValue([]);
    serverFns.listClientAssignmentOptions.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders a row per case", async () => {
    serverFns.listAnnualReturnCasePage.mockResolvedValue({ cases: [makeCase()], nextCursor: null });
    renderBoard();

    expect(await screen.findByText("Acme Company Limited")).toBeTruthy();
  });

  it("shows a fixed message on failure and never the raw server error", async () => {
    serverFns.listAnnualReturnCasePage.mockRejectedValue(
      new Error("connect ECONNREFUSED 10.0.0.4:5432"),
    );
    renderBoard();

    const alert = await screen.findByRole("alert");

    expect(alert.textContent).toContain("Annual return data is unavailable.");
    expect(alert.textContent).not.toContain("ECONNREFUSED");
    expect(screen.queryByText(/10\.0\.0\.4/)).toBeNull();
  });

  it("does not render the empty state and the error at the same time", async () => {
    // payments.tsx:83 and :160 do exactly this: on error `data` is undefined so the
    // list is empty and isLoading is false, so the screen says both "unavailable"
    // and "nothing to review".
    serverFns.listAnnualReturnCasePage.mockRejectedValue(new Error("boom"));
    renderBoard();

    await screen.findByRole("alert");

    expect(screen.queryByText("No annual return cases match these filters.")).toBeNull();
  });

  it("shows the empty state when the query succeeds with no cases", async () => {
    serverFns.listAnnualReturnCasePage.mockResolvedValue({ cases: [], nextCursor: null });
    renderBoard();

    expect(await screen.findByText("No annual return cases match these filters.")).toBeTruthy();
  });

  it("surfaces a work queue failure as a banner instead of silent per-row text", async () => {
    serverFns.listAnnualReturnCasePage.mockResolvedValue({ cases: [makeCase()], nextCursor: null });
    serverFns.listWorkQueue.mockRejectedValue(
      new Error("Forbidden: staff actor has no assigned team."),
    );
    renderBoard();

    await waitFor(() =>
      expect(
        screen
          .getAllByRole("status")
          .map((node) => node.textContent ?? "")
          .join(" "),
      ).toContain("Assignment and SLA data is unavailable."),
    );
  });

  // The warning used to be gated on `cases.length === 200`, an exact-equality
  // guess. The `risk` filter is applied after hydration, so a truncated query
  // could return fewer than 200 rows and the warning would not appear at all.
  // The server now says whether another page exists.
  it("says there is more when the server returns a cursor", async () => {
    serverFns.listAnnualReturnCasePage.mockResolvedValue({
      cases: [makeCase()],
      nextCursor: "next-page",
    });
    renderBoard();

    expect(await screen.findByRole("status")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "載入更多" })).toBeTruthy();
  });

  it("says nothing about more pages when the server returns no cursor", async () => {
    serverFns.listAnnualReturnCasePage.mockResolvedValue({
      cases: Array.from({ length: 200 }, (_, index) =>
        makeCase({ id: `case-${index}`, companyName: `Company ${index}` }),
      ),
      nextCursor: null,
    });
    renderBoard();

    await screen.findByText("Company 0");
    expect(screen.queryByRole("button", { name: "載入更多" })).toBeNull();
  });

  it("loads the next page and appends it rather than replacing the first", async () => {
    serverFns.listAnnualReturnCasePage.mockResolvedValueOnce({
      cases: [makeCase({ id: "case-a", companyName: "Alpha Limited" })],
      nextCursor: "cursor-1",
    });
    renderBoard();
    await screen.findByText("Alpha Limited");

    serverFns.listAnnualReturnCasePage.mockResolvedValueOnce({
      cases: [makeCase({ id: "case-b", companyName: "Beta Limited" })],
      nextCursor: null,
    });
    fireEvent.click(await screen.findByRole("button", { name: "載入更多" }));

    expect(await screen.findByText("Beta Limited")).toBeTruthy();
    expect(screen.getByText("Alpha Limited")).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: "載入更多" })).toBeNull());
    expect(serverFns.listAnnualReturnCasePage).toHaveBeenCalledTimes(2);
  });

  it.each([201, 400, 401])("terminates %i records at the actual final cursor", async (total) => {
    serverFns.listAnnualReturnCasePage.mockImplementation(
      ({ data }: { data: { cursor?: string } }) => {
        const offset = data.cursor ? Number(data.cursor) : 0;
        const end = Math.min(offset + 200, total);
        return Promise.resolve({
          cases: Array.from({ length: end - offset }, (_, i) =>
            makeCase({ id: `row-${offset + i}`, companyName: `Boundary ${offset + i}` }),
          ),
          nextCursor: end < total ? String(end) : null,
        });
      },
    );
    renderBoard();
    await screen.findByText("Boundary 0");
    for (let offset = 200; offset < total; offset += 200) {
      fireEvent.click(await screen.findByRole("button", { name: "載入更多" }));
      await screen.findByText(`Boundary ${offset}`);
    }
    await waitFor(() => expect(screen.queryByRole("button", { name: "載入更多" })).toBeNull());
    expect(serverFns.listAnnualReturnCasePage).toHaveBeenCalledTimes(Math.ceil(total / 200));
    expect(screen.getAllByText(`Boundary ${total - 1}`).length).toBe(1);
  });
  it("retries only a failed next page and retains prior rows without exposing server errors", async () => {
    serverFns.listAnnualReturnCasePage.mockResolvedValueOnce({
      cases: [makeCase({ companyName: "First row" })],
      nextCursor: "next",
    });
    renderBoard();
    await screen.findByText("First row");
    serverFns.listAnnualReturnCasePage.mockRejectedValueOnce(new Error("private database URL"));
    fireEvent.click(await screen.findByRole("button", { name: "載入更多" }));
    await screen.findByText("未能載入下一頁，請重試。");
    expect(screen.queryByText("private database URL")).toBeNull();
    expect(screen.getByText("First row")).toBeTruthy();
    serverFns.listAnnualReturnCasePage.mockResolvedValueOnce({
      cases: [makeCase({ id: "second", companyName: "Second row" })],
      nextCursor: null,
    });
    fireEvent.click(await screen.findByRole("button", { name: "重試下一頁" }));
    await screen.findByText("Second row");
    expect(serverFns.listAnnualReturnCasePage.mock.calls[2][0].data.cursor).toBe("next");
  });
  it("deduplicates an overlapping record across pages using its latest value", async () => {
    serverFns.listAnnualReturnCasePage.mockResolvedValueOnce({
      cases: [makeCase({ id: "overlap", companyName: "Before overlap" })],
      nextCursor: "next",
    });
    renderBoard();
    await screen.findByText("Before overlap");
    serverFns.listAnnualReturnCasePage.mockResolvedValueOnce({
      cases: [
        makeCase({ id: "overlap", companyName: "After overlap" }),
        makeCase({ id: "extra", companyName: "Extra row" }),
      ],
      nextCursor: null,
    });
    fireEvent.click(await screen.findByRole("button", { name: "載入更多" }));
    await screen.findByText("Extra row");
    expect(screen.getAllByText("After overlap")).toHaveLength(1);
    expect(screen.queryByText("Before overlap")).toBeNull();
  });
  it("does not reuse previous actor pages on an actor scope change", async () => {
    serverFns.listAnnualReturnCasePage.mockResolvedValueOnce({
      cases: [makeCase({ companyName: "Actor one private row" })],
      nextCursor: "next",
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderBoard(false, {}, client);
    await screen.findByText("Actor one private row");
    serverFns.listAnnualReturnCasePage.mockResolvedValueOnce({
      cases: [makeCase({ id: "new-actor-row", companyName: "Actor two row" })],
      nextCursor: null,
    });
    view.rerender(
      <QueryClientProvider client={client}>
        <ProductionAnnualReturnCommandCenter
          search={{}}
          actorScope={{
            authUserId: "actor-two",
            userId: "staff-two",
            teamId: "team-two",
            role: "Staff",
            active: true,
          }}
        />
      </QueryClientProvider>,
    );
    await screen.findByText("Actor two row");
    expect(screen.queryByText("Actor one private row")).toBeNull();
    expect(screen.queryByRole("button", { name: "載入更多" })).toBeNull();
  });
  it("does not append an old slow page after changing filters", async () => {
    let finishOld!: (page: { cases: AnnualReturnCase[]; nextCursor: null }) => void;
    serverFns.listAnnualReturnCasePage.mockImplementation(
      ({ data }: { data: { cursor?: string; q?: string } }) => {
        if (data.q === "new")
          return Promise.resolve({
            cases: [makeCase({ id: "new", companyName: "New scope" })],
            nextCursor: null,
          });
        if (data.cursor)
          return new Promise((resolve) => {
            finishOld = resolve;
          });
        return Promise.resolve({
          cases: [makeCase({ companyName: "Old scope" })],
          nextCursor: "old-cursor",
        });
      },
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderBoard(false, {}, client);
    await screen.findByText("Old scope");
    const more = await screen.findByRole("button", { name: "載入更多" });
    fireEvent.click(more);
    fireEvent.click(more);
    await waitFor(() => expect(serverFns.listAnnualReturnCasePage).toHaveBeenCalledTimes(2));
    view.rerender(
      <QueryClientProvider client={client}>
        <ProductionAnnualReturnCommandCenter search={{ q: "new" }} />
      </QueryClientProvider>,
    );
    await screen.findByText("New scope");
    finishOld({
      cases: [makeCase({ id: "old-extra", companyName: "Old late page" })],
      nextCursor: null,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText("Old scope")).toBeNull();
    expect(screen.queryByText("Old late page")).toBeNull();
  });

  it("requests the capped page size", async () => {
    serverFns.listAnnualReturnCasePage.mockResolvedValue({ cases: [], nextCursor: null });
    renderBoard();

    await waitFor(() =>
      expect(serverFns.listAnnualReturnCasePage).toHaveBeenCalledWith({
        data: { limit: 200, includeFixtures: false },
      }),
    );
  });

  it("labels origins and keeps diagnostic scope opt-in for an Admin", async () => {
    serverFns.listAnnualReturnCasePage.mockResolvedValue({
      cases: [makeCase({ dataOrigin: "historical" })],
      nextCursor: null,
    });
    renderBoard(true);
    expect(await screen.findByText("歷史資料（不外發）")).toBeTruthy();
    const toggle = screen.getByRole("checkbox", { name: "包含測試資料（Admin 診斷）" });
    expect((toggle as HTMLInputElement).checked).toBe(false);
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(serverFns.listAnnualReturnCasePage).toHaveBeenCalledWith({
        data: { limit: 200, includeFixtures: true },
      }),
    );
  });

  it("does not offer fixture diagnostics without the Admin capability", async () => {
    serverFns.listAnnualReturnCasePage.mockResolvedValue({ cases: [], nextCursor: null });
    renderBoard();
    await screen.findByText("No annual return cases match these filters.");
    expect(screen.queryByRole("checkbox", { name: "包含測試資料（Admin 診斷）" })).toBeNull();
  });
});
