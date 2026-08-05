// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const serverFns = vi.hoisted(() => ({ getClient: vi.fn() }));

vi.mock("../server-fns", () => ({ getClient: serverFns.getClient }));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({ children }: { children: React.ReactNode }) => <a href="#">{children}</a>,
}));

import { ProductionClientProfile } from "./production-client-profile";
import type { ClientDetail } from "../types";

function detail(overrides: Partial<ClientDetail> = {}): ClientDetail {
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
    incorporationDate: "2021-07-01",
    annualReturnBasisDate: "2026-07-01",
    registeredOffice: "Room 1201, Central Plaza",
    companySecretary: "Kossilon Corporate Services Limited",
    contacts: [
      {
        id: "97300000-0000-0000-0000-000000000002",
        companyId: "97000000-0000-0000-0000-000000000001",
        name: "Zoe Ng",
        role: "Accountant",
        email: "zoe@example.hk",
        phone: null,
        isPrimary: false,
      },
      {
        id: "97300000-0000-0000-0000-000000000001",
        companyId: "97000000-0000-0000-0000-000000000001",
        name: "Alan Ho",
        role: "Director",
        email: null,
        phone: "+85290000001",
        isPrimary: true,
      },
    ],
    timeline: [],
    annualReturnHistory: [],
    documents: [],
    ...overrides,
  };
}

function renderProfile(props: Partial<Parameters<typeof ProductionClientProfile>[0]> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={queryClient}>
      <ProductionClientProfile
        clientId="97000000-0000-0000-0000-000000000001"
        onEditClient={() => {}}
        onAddContact={() => {}}
        onEditContact={() => {}}
        onRemoveContact={() => {}}
        removingContactId={null}
        {...props}
      />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProductionClientProfile", () => {
  it("marks the primary contact", async () => {
    serverFns.getClient.mockResolvedValue(detail());

    renderProfile();

    expect(await screen.findByText("Alan Ho")).toBeTruthy();
    expect(screen.getByText("Primary")).toBeTruthy();
  });

  it("shows a company with no case and no contacts without looking broken", async () => {
    serverFns.getClient.mockResolvedValue(
      detail({ arDueDate: null, paymentStatus: null, invoiceAmount: null, contacts: [] }),
    );

    renderProfile();

    expect(await screen.findByText("No contacts recorded for this company.")).toBeTruthy();
    expect(screen.getByText("No case")).toBeTruthy();
    expect(screen.getByText("Not invoiced")).toBeTruthy();
  });

  it("renders a not-found state for an unknown id", async () => {
    serverFns.getClient.mockResolvedValue(null);

    renderProfile();

    expect(await screen.findByText("Client not found")).toBeTruthy();
  });

  it("offers a retry when the query fails", async () => {
    serverFns.getClient.mockRejectedValue(new Error("connection lost"));

    renderProfile();

    expect(await screen.findByText("This client is temporarily unavailable.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("shows contact controls to any staff member", async () => {
    serverFns.getClient.mockResolvedValue(detail());

    renderProfile();

    expect(await screen.findByRole("button", { name: /Add contact/ })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Remove" }).length).toBe(2);
  });
});
