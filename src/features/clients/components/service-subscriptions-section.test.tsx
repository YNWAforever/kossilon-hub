// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toast } from "sonner";

import type { ServiceSubscription } from "@/features/service-subscriptions/types";
import { ServiceSubscriptionsSection } from "./service-subscriptions-section";

const serverFns = vi.hoisted(() => ({
  listServiceSubscriptions: vi.fn(),
  addServiceSubscription: vi.fn(),
  renewServiceSubscription: vi.fn(),
  cancelServiceSubscription: vi.fn(),
}));

vi.mock("@/features/service-subscriptions/server-fns", () => ({
  listServiceSubscriptions: serverFns.listServiceSubscriptions,
  addServiceSubscription: serverFns.addServiceSubscription,
  renewServiceSubscription: serverFns.renewServiceSubscription,
  cancelServiceSubscription: serverFns.cancelServiceSubscription,
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const companyId = "11111111-1111-4111-8111-111111111111";

const secretarySubscription: ServiceSubscription = {
  id: "22222222-2222-4222-8222-222222222222",
  companyId,
  serviceType: "secretary",
  fee: 2800,
  status: "Active",
  renewalDate: "2027-01-01",
  cancelledAt: null,
};

const registeredOfficeSubscription: ServiceSubscription = {
  id: "33333333-3333-4333-8333-333333333333",
  companyId,
  serviceType: "registered_office",
  fee: 2800,
  status: "Active",
  renewalDate: "2027-02-01",
  cancelledAt: null,
};

function renderSection() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ServiceSubscriptionsSection companyId={companyId} />
    </QueryClientProvider>,
  );
}

describe("ServiceSubscriptionsSection", () => {
  beforeEach(() => {
    serverFns.listServiceSubscriptions.mockReset();
    serverFns.addServiceSubscription.mockReset();
    serverFns.renewServiceSubscription.mockReset();
    serverFns.cancelServiceSubscription.mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders each subscription with its fee and renewal date", async () => {
    serverFns.listServiceSubscriptions.mockResolvedValue([secretarySubscription]);

    renderSection();

    expect(await screen.findByText("Company Secretary")).toBeTruthy();
    expect(screen.getByText("HKD 2,800")).toBeTruthy();
  });

  it("offers only service types without an active subscription in the add dialog", async () => {
    serverFns.listServiceSubscriptions.mockResolvedValue([secretarySubscription]);

    renderSection();

    await screen.findByText("Company Secretary");
    fireEvent.click(screen.getByRole("button", { name: "Add subscription" }));

    const select = screen.getByLabelText("Service") as HTMLSelectElement;
    const options = Array.from(select.querySelectorAll("option")).map(
      (option) => option.textContent,
    );

    expect(options).not.toContain("Company Secretary");
    expect(options).toContain("Registered Office");
  });

  it("calls renewServiceSubscription when Mark renewed is clicked", async () => {
    serverFns.listServiceSubscriptions.mockResolvedValue([secretarySubscription]);
    serverFns.renewServiceSubscription.mockResolvedValue({
      ...secretarySubscription,
      renewalDate: "2028-01-01",
    });

    renderSection();

    await screen.findByText("Company Secretary");
    fireEvent.click(screen.getByRole("button", { name: "Mark renewed" }));

    await waitFor(() =>
      expect(serverFns.renewServiceSubscription).toHaveBeenCalledWith({
        data: { subscriptionId: secretarySubscription.id, companyId },
      }),
    );
  });

  it("calls cancelServiceSubscription when Cancel is clicked", async () => {
    serverFns.listServiceSubscriptions.mockResolvedValue([secretarySubscription]);
    serverFns.cancelServiceSubscription.mockResolvedValue({
      ...secretarySubscription,
      status: "Cancelled",
      cancelledAt: "2026-08-23T00:00:00.000Z",
    });

    renderSection();

    await screen.findByText("Company Secretary");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(serverFns.cancelServiceSubscription).toHaveBeenCalledWith({
        data: { subscriptionId: secretarySubscription.id, companyId },
      }),
    );
  });

  it("clears the add-subscription form on reopen after dismissing without submitting", async () => {
    serverFns.listServiceSubscriptions.mockResolvedValue([secretarySubscription]);

    renderSection();
    await screen.findByText("Company Secretary");

    fireEvent.click(screen.getByRole("button", { name: "Add subscription" }));
    fireEvent.change(screen.getByLabelText("Fee (HKD)"), { target: { value: "9999" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    fireEvent.click(screen.getByRole("button", { name: "Add subscription" }));

    expect((screen.getByLabelText("Fee (HKD)") as HTMLInputElement).value).toBe("");
  });

  it("only disables the row being acted on, not every subscription's buttons", async () => {
    serverFns.listServiceSubscriptions.mockResolvedValue([
      secretarySubscription,
      registeredOfficeSubscription,
    ]);
    let resolveRenew: (() => void) | undefined;
    serverFns.renewServiceSubscription.mockReturnValue(
      new Promise((resolve) => {
        resolveRenew = () => resolve({ ...secretarySubscription, renewalDate: "2028-01-01" });
      }),
    );

    renderSection();
    await screen.findByText("Company Secretary");

    fireEvent.click(screen.getAllByRole("button", { name: "Mark renewed" })[0]);

    await waitFor(() =>
      expect(serverFns.renewServiceSubscription).toHaveBeenCalledWith({
        data: { subscriptionId: secretarySubscription.id, companyId },
      }),
    );
    await waitFor(() => {
      const [first, second] = screen.getAllByRole("button", {
        name: "Mark renewed",
      }) as HTMLButtonElement[];
      expect(first.disabled).toBe(true);
      expect(second.disabled).toBe(false);
    });

    resolveRenew?.();
  });
});
