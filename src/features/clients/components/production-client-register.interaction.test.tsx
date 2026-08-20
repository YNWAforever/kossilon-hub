// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ClientAssignmentOptions, ClientSummary } from "../types";
import { ProductionClientRegister } from "./production-client-register";

const serverFns = vi.hoisted(() => ({
  listClients: vi.fn(),
  listClientAssignmentOptions: vi.fn(),
}));

vi.mock("../server-fns", () => ({
  listClients: serverFns.listClients,
  listClientAssignmentOptions: serverFns.listClientAssignmentOptions,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/clients">{children}</a>,
}));

function makeClient(overrides: Partial<ClientSummary> = {}): ClientSummary {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    companyName: "Acme Company Limited",
    crNumber: "CR1234567",
    brNumber: "BR7654321",
    status: "active",
    packageId: null,
    packageName: "Standard",
    ownerId: "22222222-2222-4222-8222-222222222222",
    ownerName: "Ada Chan",
    ownerInitials: "AC",
    teamId: "33333333-3333-4333-8333-333333333333",
    teamName: "Team Alpha",
    arDueDate: "2026-09-11",
    paymentStatus: "Payment pending",
    invoiceAmount: 3000,
    ...overrides,
  };
}

function makeOptions(): ClientAssignmentOptions {
  return {
    owners: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Ada Chan",
        teamId: "33333333-3333-4333-8333-333333333333",
      },
    ],
    teams: [{ id: "33333333-3333-4333-8333-333333333333", name: "Team Alpha" }],
    packages: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        name: "Standard",
        defaultFee: 3000,
        currency: "HKD",
        active: true,
        sortOrder: 0,
      },
    ],
  };
}

function renderRegister() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ProductionClientRegister />
    </QueryClientProvider>,
  );
}

describe("production client register", () => {
  beforeEach(() => {
    serverFns.listClients.mockReset();
    serverFns.listClientAssignmentOptions.mockReset();
    serverFns.listClientAssignmentOptions.mockResolvedValue(makeOptions());
  });

  afterEach(() => {
    cleanup();
  });

  it("renders a row per client", async () => {
    serverFns.listClients.mockResolvedValue([makeClient()]);
    renderRegister();

    expect(await screen.findByText("Acme Company Limited")).toBeTruthy();
  });

  it("shows a fixed message on failure and never the raw server error", async () => {
    serverFns.listClients.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.4:5432"));
    renderRegister();

    const alert = await screen.findByRole("alert");

    expect(alert.textContent).toContain("Client data is unavailable.");
    expect(alert.textContent).not.toContain("ECONNREFUSED");
  });

  it("shows the empty state when the query succeeds with no clients", async () => {
    serverFns.listClients.mockResolvedValue([]);
    renderRegister();

    expect(await screen.findByText("No clients match the current filters.")).toBeTruthy();
  });

  it("filters rows by the search box", async () => {
    serverFns.listClients.mockResolvedValue([
      makeClient(),
      makeClient({ id: "55555555-5555-4555-8555-555555555555", companyName: "Beta Holdings" }),
    ]);
    renderRegister();
    await screen.findByText("Acme Company Limited");

    const search = screen.getByPlaceholderText("Search company, CR or BR number");
    fireEvent.change(search, { target: { value: "Beta" } });

    await waitFor(() => expect(screen.queryByText("Acme Company Limited")).toBeNull());
    expect(screen.getByText("Beta Holdings")).toBeTruthy();
  });

  it("disables New client until assignment options resolve", async () => {
    serverFns.listClients.mockResolvedValue([]);
    let resolveOptions: (value: ClientAssignmentOptions) => void = () => {};
    serverFns.listClientAssignmentOptions.mockReturnValue(
      new Promise((resolve) => {
        resolveOptions = resolve;
      }),
    );
    renderRegister();

    const button = () => screen.getByRole("button", { name: "New client" }) as HTMLButtonElement;
    expect(button().disabled).toBe(true);

    resolveOptions(makeOptions());
    await waitFor(() => expect(button().disabled).toBe(false));
  });
});
