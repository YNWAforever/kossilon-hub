// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const serverFns = vi.hoisted(() => ({
  listAnnualReturnCases: vi.fn(),
  listDocuments: vi.fn(),
  reviewAnnualReturnEvidenceAction: vi.fn(),
}));

vi.mock("../features/annual-return/server-fns", () => ({
  listAnnualReturnCases: serverFns.listAnnualReturnCases,
}));

vi.mock("../features/documents/server-fns", () => ({
  listDocuments: serverFns.listDocuments,
}));

vi.mock("../features/annual-return/evidence-server-fns", () => ({
  reviewAnnualReturnEvidenceAction: serverFns.reviewAnnualReturnEvidenceAction,
}));

// Only createFileRoute is replaced: payments.tsx calls it at module scope, and the
// real one wants a registered route tree. Everything else comes from the library.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  createFileRoute: () => () => ({ useRouteContext: () => ({ dataMode: "production" }) }),
}));

import { ProductionPaymentsRoute } from "./payments";

function renderPayments() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ProductionPaymentsRoute />
    </QueryClientProvider>,
  );
}

describe("production payments route", () => {
  beforeEach(() => {
    serverFns.listAnnualReturnCases.mockReset();
    serverFns.listDocuments.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("does not claim there is nothing to review when the query failed", async () => {
    // On error `data` is undefined so the filtered list is empty, and isLoading is
    // false because the status is `error`. Without an isError guard the screen
    // renders "unavailable" and "nothing to review" at the same time.
    serverFns.listAnnualReturnCases.mockRejectedValue(new Error("boom"));
    serverFns.listDocuments.mockRejectedValue(new Error("boom"));
    renderPayments();

    await screen.findByRole("alert");

    expect(screen.queryByText("No production payment evidence is awaiting review.")).toBeNull();
  });

  it("still shows the empty state when the queries succeed with nothing to review", async () => {
    serverFns.listAnnualReturnCases.mockResolvedValue([]);
    serverFns.listDocuments.mockResolvedValue([]);
    renderPayments();

    expect(
      await screen.findByText("No production payment evidence is awaiting review."),
    ).toBeTruthy();
  });
});
