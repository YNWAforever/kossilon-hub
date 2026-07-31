// @vitest-environment jsdom

import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnnualReturnCase } from "../types";
import { ProductionAnnualReturnCommandCenter } from "./production-command-center";

const serverFns = vi.hoisted(() => ({
  listAnnualReturnCases: vi.fn(),
  listWorkQueue: vi.fn(),
}));

vi.mock("../server-fns", () => ({ listAnnualReturnCases: serverFns.listAnnualReturnCases }));
vi.mock("@/features/work-items/server-fns", () => ({ listWorkQueue: serverFns.listWorkQueue }));
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

function renderBoard() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ProductionAnnualReturnCommandCenter search={{}} />
    </QueryClientProvider>,
  );
}

describe("production annual return command center", () => {
  beforeEach(() => {
    serverFns.listAnnualReturnCases.mockReset();
    serverFns.listWorkQueue.mockReset();
    serverFns.listWorkQueue.mockResolvedValue([]);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders a row per case", async () => {
    serverFns.listAnnualReturnCases.mockResolvedValue([makeCase()]);
    renderBoard();

    expect(await screen.findByText("Acme Company Limited")).toBeTruthy();
  });

  it("shows a fixed message on failure and never the raw server error", async () => {
    serverFns.listAnnualReturnCases.mockRejectedValue(
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
    serverFns.listAnnualReturnCases.mockRejectedValue(new Error("boom"));
    renderBoard();

    await screen.findByRole("alert");

    expect(screen.queryByText("No annual return cases match these filters.")).toBeNull();
  });

  it("shows the empty state when the query succeeds with no cases", async () => {
    serverFns.listAnnualReturnCases.mockResolvedValue([]);
    renderBoard();

    expect(await screen.findByText("No annual return cases match these filters.")).toBeTruthy();
  });

  it("surfaces a work queue failure as a banner instead of silent per-row text", async () => {
    serverFns.listAnnualReturnCases.mockResolvedValue([makeCase()]);
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

  it("warns when the result is capped", async () => {
    serverFns.listAnnualReturnCases.mockResolvedValue(
      Array.from({ length: 200 }, (_, index) =>
        makeCase({ id: `case-${index}`, companyName: `Company ${index}` }),
      ),
    );
    renderBoard();

    expect(
      await screen.findByText("Showing the first 200 cases — narrow the filters."),
    ).toBeTruthy();
  });

  it("requests the capped page size", async () => {
    serverFns.listAnnualReturnCases.mockResolvedValue([]);
    renderBoard();

    await waitFor(() =>
      expect(serverFns.listAnnualReturnCases).toHaveBeenCalledWith({ data: { limit: 200 } }),
    );
  });
});
