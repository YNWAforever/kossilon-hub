// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const serverFns = vi.hoisted(() => ({ listClients: vi.fn() }));

vi.mock("../server-fns", () => ({ listClients: serverFns.listClients }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));

import { ProductionClientDirectory } from "./production-client-directory";
import type { ClientRegisterSearch } from "../board-filters";
import type { ClientSummary } from "../types";

function client(overrides: Partial<ClientSummary> = {}): ClientSummary {
  return {
    id: "97000000-0000-0000-0000-000000000001",
    companyName: "Harbour Trading Ltd",
    crNumber: "1200001",
    brNumber: "60000001",
    status: "active",
    packageId: "30000000-0000-0000-0000-000000000002",
    packageName: "Standard",
    ownerId: "20000000-0000-0000-0000-000000000001",
    ownerName: "Amy Chan",
    ownerInitials: "AC",
    teamId: "10000000-0000-0000-0000-000000000001",
    teamName: "Annual Return Control",
    arDueDate: "2026-08-12",
    paymentStatus: "Payment pending",
    invoiceAmount: 3800,
    ...overrides,
  };
}

const defaultSearch: ClientRegisterSearch = { status: "active" };

function renderDirectory(props: Partial<Parameters<typeof ProductionClientDirectory>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={queryClient}>
      <ProductionClientDirectory
        search={defaultSearch}
        onSearchChange={() => {}}
        canManage={false}
        onAddClient={() => {}}
        {...props}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProductionClientDirectory", () => {
  it("renders a company with no annual return case as 'No case'", async () => {
    serverFns.listClients.mockResolvedValue([
      client({
        companyName: "Dormant Holdings Ltd",
        arDueDate: null,
        paymentStatus: null,
        invoiceAmount: null,
      }),
    ]);

    renderDirectory();

    expect(await screen.findByText("Dormant Holdings Ltd")).toBeTruthy();
    expect(screen.getByText("No case")).toBeTruthy();
    expect(screen.getByText("Not invoiced")).toBeTruthy();
  });

  it("narrows the list by the status filter", async () => {
    serverFns.listClients.mockResolvedValue([
      client(),
      client({
        id: "97000000-0000-0000-0000-000000000002",
        companyName: "Retired Ltd",
        status: "inactive",
      }),
    ]);

    renderDirectory();

    expect(await screen.findByText("Harbour Trading Ltd")).toBeTruthy();
    expect(screen.queryByText("Retired Ltd")).toBeNull();
  });

  it("narrows the list by the search term", async () => {
    serverFns.listClients.mockResolvedValue([
      client(),
      client({ id: "97000000-0000-0000-0000-000000000003", companyName: "Kowloon Textiles Ltd" }),
    ]);

    renderDirectory({ search: { status: "active", q: "kowloon" } });

    expect(await screen.findByText("Kowloon Textiles Ltd")).toBeTruthy();
    expect(screen.queryByText("Harbour Trading Ltd")).toBeNull();
  });

  it("offers a retry instead of an empty table when the query fails", async () => {
    serverFns.listClients.mockRejectedValue(new Error("connection lost"));

    renderDirectory();

    expect(await screen.findByText("The client register is temporarily unavailable.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText("No clients match the current filters.")).toBeNull();
  });

  it("hides Add client from a staff member and shows it to a manager", async () => {
    serverFns.listClients.mockResolvedValue([client()]);

    const { unmount } = renderDirectory({ canManage: false });
    await waitFor(() => expect(screen.getByText("Harbour Trading Ltd")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /Add client/ })).toBeNull();
    unmount();

    renderDirectory({ canManage: true });
    await waitFor(() => expect(screen.getByText("Harbour Trading Ltd")).toBeTruthy());
    expect(screen.getByRole("button", { name: /Add client/ })).toBeTruthy();
  });
});
