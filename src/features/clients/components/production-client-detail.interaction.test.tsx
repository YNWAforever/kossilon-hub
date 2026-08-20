// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "sonner";

import type { ClientAssignmentOptions, ClientDetail } from "../types";
import { ProductionClientDetail } from "./production-client-detail";

const serverFns = vi.hoisted(() => ({
  getClient: vi.fn(),
  listClientAssignmentOptions: vi.fn(),
  removeClientContact: vi.fn(),
}));

vi.mock("../server-fns", () => ({
  getClient: serverFns.getClient,
  listClientAssignmentOptions: serverFns.listClientAssignmentOptions,
  removeClientContact: serverFns.removeClientContact,
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/clients">{children}</a>,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const clientId = "11111111-1111-4111-8111-111111111111";

function makeClient(overrides: Partial<ClientDetail> = {}): ClientDetail {
  return {
    id: clientId,
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
    incorporationDate: "2020-01-15",
    annualReturnBasisDate: "2020-01-15",
    registeredOffice: "1 Harbour Road, Hong Kong",
    companySecretary: "Kossilon Secretaries Ltd",
    contacts: [],
    timeline: [],
    annualReturnHistory: [],
    documents: [],
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
    packages: [],
  };
}

function renderDetail() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ProductionClientDetail clientId={clientId} />
    </QueryClientProvider>,
  );
}

describe("production client detail", () => {
  beforeEach(() => {
    serverFns.getClient.mockReset();
    serverFns.listClientAssignmentOptions.mockReset();
    serverFns.removeClientContact.mockReset();
    serverFns.listClientAssignmentOptions.mockResolvedValue(makeOptions());
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders the company overview once the query resolves", async () => {
    serverFns.getClient.mockResolvedValue(makeClient());
    renderDetail();

    expect(await screen.findByText("Acme Company Limited")).toBeTruthy();
    expect(screen.getByText("1 Harbour Road, Hong Kong")).toBeTruthy();
  });

  it("shows a not-found state when the client does not exist", async () => {
    serverFns.getClient.mockResolvedValue(null);
    renderDetail();

    expect(await screen.findByText("Client not found")).toBeTruthy();
  });

  it("shows a fixed message on failure and never the raw server error", async () => {
    serverFns.getClient.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.4:5432"));
    renderDetail();

    const alert = await screen.findByRole("alert");

    expect(alert.textContent).toContain("Client data is unavailable.");
    expect(alert.textContent).not.toContain("ECONNREFUSED");
  });

  it("renders each contact and removes one on click", async () => {
    serverFns.getClient.mockResolvedValue(
      makeClient({
        contacts: [
          {
            id: "66666666-6666-4666-8666-666666666666",
            companyId: clientId,
            name: "Ivy Wong",
            role: "Director",
            email: "ivy@example.com",
            phone: null,
            isPrimary: true,
          },
        ],
      }),
    );
    serverFns.removeClientContact.mockResolvedValue(undefined);
    renderDetail();

    await screen.findByText("Ivy Wong");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(serverFns.removeClientContact).toHaveBeenCalledWith({
        data: { companyId: clientId, contactId: "66666666-6666-4666-8666-666666666666" },
      }),
    );
  });

  it("shows a fixed error toast and never the raw server error when contact removal fails", async () => {
    serverFns.getClient.mockResolvedValue(
      makeClient({
        contacts: [
          {
            id: "66666666-6666-4666-8666-666666666666",
            companyId: clientId,
            name: "Ivy Wong",
            role: "Director",
            email: "ivy@example.com",
            phone: null,
            isPrimary: true,
          },
        ],
      }),
    );
    serverFns.removeClientContact.mockRejectedValue(
      new Error("connect ECONNREFUSED 10.0.0.4:5432"),
    );
    renderDetail();

    await screen.findByText("Ivy Wong");
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));

    const [message] = vi.mocked(toast.error).mock.calls[0];
    expect(message).not.toContain("ECONNREFUSED");
    expect(message).toBe("Unable to remove the contact. Try again.");
    // The contact remains, since the removal failed.
    expect(screen.getByText("Ivy Wong")).toBeTruthy();
  });

  it("links each annual-return history row to its case", async () => {
    serverFns.getClient.mockResolvedValue(
      makeClient({
        annualReturnHistory: [
          {
            id: "77777777-7777-4777-8777-777777777777",
            returnYear: 2026,
            madeUpDate: "2026-01-15",
            filingDueDate: "2026-02-26",
            currentStatus: "Upcoming",
          },
        ],
      }),
    );
    renderDetail();

    expect(await screen.findByText("Return year 2026")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open case" })).toBeTruthy();
  });

  it("shows a status message when assignment options fail to load, and Edit stays hidden", async () => {
    serverFns.getClient.mockResolvedValue(makeClient());
    serverFns.listClientAssignmentOptions.mockRejectedValue(new Error("boom"));
    renderDetail();

    await screen.findByText("Acme Company Limited");
    const status = await screen.findByRole("status");
    expect(status.textContent).toMatch(/options are unavailable/i);
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});
