// @vitest-environment jsdom

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnnualReturnCase } from "../types";
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

function renderBoard(allowFixtureDiagnostics = false) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ProductionAnnualReturnCommandCenter
        search={{}}
        allowFixtureDiagnostics={allowFixtureDiagnostics}
      />
    </QueryClientProvider>,
  );
}

describe("production annual return command center", () => {
  beforeEach(() => {
    serverFns.listAnnualReturnCasePage.mockReset();
    serverFns.listWorkQueue.mockReset();
    serverFns.listWorkQueue.mockResolvedValue([]);
    serverFns.getAnnualReturnBoardTotals.mockResolvedValue({
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
