// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateCorporateChangeRequestDialog } from "./create-corporate-change-request-dialog";

const serverFns = vi.hoisted(() => ({
  createCorporateChangeRequest: vi.fn(),
}));

const clientServerFns = vi.hoisted(() => ({
  getClient: vi.fn(),
}));

vi.mock("@/features/corporate-changes/server-fns", () => ({
  createCorporateChangeRequest: serverFns.createCorporateChangeRequest,
}));

vi.mock("@/features/clients/server-fns", () => ({
  getClient: clientServerFns.getClient,
}));

const companies = [{ id: "company-1", companyName: "Test Co Ltd" }];

describe("CreateCorporateChangeRequestDialog", () => {
  beforeEach(() => {
    serverFns.createCorporateChangeRequest.mockReset();
    clientServerFns.getClient.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("submits an address_change request with the entered fields", async () => {
    serverFns.createCorporateChangeRequest.mockResolvedValue({ id: "new-request-id" });
    const onCreated = vi.fn();

    render(
      <CreateCorporateChangeRequestDialog
        open
        onOpenChange={() => {}}
        companies={companies}
        isLoading={false}
        hasError={false}
        onCreated={onCreated}
      />,
    );

    fireEvent.change(screen.getByLabelText(/company/i), { target: { value: "company-1" } });
    fireEvent.change(screen.getByLabelText(/change type/i), {
      target: { value: "address_change" },
    });
    fireEvent.change(screen.getByLabelText(/quoted fee/i), { target: { value: "2800" } });
    fireEvent.change(screen.getByLabelText(/new registered office/i), {
      target: { value: "88 New Road, Hong Kong" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create request/i }));

    await waitFor(() => {
      expect(serverFns.createCorporateChangeRequest).toHaveBeenCalledWith({
        data: expect.objectContaining({
          changeType: "address_change",
          companyId: "company-1",
          quotedFee: 2800,
          newRegisteredOffice: "88 New Road, Hong Kong",
        }),
      });
    });
    expect(onCreated).toHaveBeenCalledWith("new-request-id");
  });
});

describe("CreateCorporateChangeRequestDialog — share_transfer and officer_change", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    serverFns.createCorporateChangeRequest.mockReset();
    clientServerFns.getClient.mockReset();
    clientServerFns.getClient.mockResolvedValue({
      id: "company-1",
      officers: [
        {
          id: "officer-1",
          name: "Existing Director",
          officerType: "director",
          cessationDate: null,
        },
      ],
      shareholdings: [
        {
          id: "holding-1",
          shareholderName: "Existing Holder",
          numberOfShares: 1000,
          cessationDate: null,
        },
      ],
    });
  });

  it("submits a share_transfer to an existing shareholding, picked from the company's real register", async () => {
    serverFns.createCorporateChangeRequest.mockResolvedValue({ id: "new-request-id" });
    const onCreated = vi.fn();

    render(
      <CreateCorporateChangeRequestDialog
        open
        onOpenChange={() => {}}
        companies={companies}
        isLoading={false}
        hasError={false}
        onCreated={onCreated}
      />,
    );

    fireEvent.change(screen.getByLabelText(/company/i), { target: { value: "company-1" } });
    fireEvent.change(screen.getByLabelText(/change type/i), {
      target: { value: "share_transfer" },
    });

    await waitFor(() => {
      expect(clientServerFns.getClient).toHaveBeenCalledWith({ data: { id: "company-1" } });
    });
    await screen.findByRole("option", { name: /existing holder/i, hidden: true });

    fireEvent.change(screen.getByLabelText(/quoted fee/i), { target: { value: "2500" } });
    fireEvent.change(screen.getByLabelText(/transferor shareholding/i), {
      target: { value: "holding-1" },
    });
    fireEvent.click(screen.getByLabelText(/^new shareholder$/i));
    fireEvent.change(screen.getByLabelText(/new shareholder name/i), {
      target: { value: "New Holder" },
    });
    fireEvent.change(screen.getByLabelText(/shares transferred/i), { target: { value: "400" } });
    fireEvent.change(screen.getByLabelText(/consideration/i), { target: { value: "400000" } });
    fireEvent.change(screen.getByLabelText(/stamp duty/i), { target: { value: "800" } });
    fireEvent.click(screen.getByRole("button", { name: /create request/i }));

    await waitFor(() => {
      expect(serverFns.createCorporateChangeRequest).toHaveBeenCalledWith({
        data: expect.objectContaining({
          changeType: "share_transfer",
          transferorShareholdingId: "holding-1",
          transfereeShareholdingId: null,
          transfereeNewShareholderName: "New Holder",
          sharesTransferred: 400,
          consideration: 400000,
          stampDutyAmount: 800,
        }),
      });
    });
    expect(onCreated).toHaveBeenCalledWith("new-request-id");
  });

  it("submits an officer_change resign request against a real officer from the register", async () => {
    serverFns.createCorporateChangeRequest.mockResolvedValue({ id: "new-request-id" });
    const onCreated = vi.fn();

    render(
      <CreateCorporateChangeRequestDialog
        open
        onOpenChange={() => {}}
        companies={companies}
        isLoading={false}
        hasError={false}
        onCreated={onCreated}
      />,
    );

    fireEvent.change(screen.getByLabelText(/company/i), { target: { value: "company-1" } });
    fireEvent.change(screen.getByLabelText(/change type/i), {
      target: { value: "officer_change" },
    });

    await waitFor(() => {
      expect(clientServerFns.getClient).toHaveBeenCalledWith({ data: { id: "company-1" } });
    });

    fireEvent.change(screen.getByLabelText(/quoted fee/i), { target: { value: "1200" } });
    fireEvent.change(screen.getByLabelText(/officer action/i), { target: { value: "resign" } });
    await screen.findByRole("option", { name: /existing director/i, hidden: true });
    fireEvent.change(screen.getByLabelText(/^officer$/i), { target: { value: "officer-1" } });
    fireEvent.change(screen.getByLabelText(/effective date/i), {
      target: { value: "2026-09-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create request/i }));

    await waitFor(() => {
      expect(serverFns.createCorporateChangeRequest).toHaveBeenCalledWith({
        data: expect.objectContaining({
          changeType: "officer_change",
          officerAction: "resign",
          officerId: "officer-1",
          effectiveDate: "2026-09-01",
        }),
      });
    });
    expect(onCreated).toHaveBeenCalledWith("new-request-id");
  });

  it("clears the previously selected transferor shareholding when the company is switched", async () => {
    const onCreated = vi.fn();
    const twoCompanies = [
      { id: "company-1", companyName: "Test Co Ltd" },
      { id: "company-2", companyName: "Second Co Ltd" },
    ];

    render(
      <CreateCorporateChangeRequestDialog
        open
        onOpenChange={() => {}}
        companies={twoCompanies}
        isLoading={false}
        hasError={false}
        onCreated={onCreated}
      />,
    );

    fireEvent.change(screen.getByLabelText(/company/i), { target: { value: "company-1" } });
    fireEvent.change(screen.getByLabelText(/change type/i), {
      target: { value: "share_transfer" },
    });

    await waitFor(() => {
      expect(clientServerFns.getClient).toHaveBeenCalledWith({ data: { id: "company-1" } });
    });
    await screen.findByRole("option", { name: /existing holder/i, hidden: true });

    fireEvent.change(screen.getByLabelText(/quoted fee/i), { target: { value: "2500" } });
    fireEvent.change(screen.getByLabelText(/transferor shareholding/i), {
      target: { value: "holding-1" },
    });
    fireEvent.change(screen.getByLabelText(/new shareholder name/i), {
      target: { value: "New Holder" },
    });
    fireEvent.change(screen.getByLabelText(/shares transferred/i), { target: { value: "400" } });
    fireEvent.change(screen.getByLabelText(/consideration/i), { target: { value: "400000" } });
    fireEvent.change(screen.getByLabelText(/stamp duty/i), { target: { value: "800" } });

    expect(
      (screen.getByRole("button", { name: /create request/i }) as HTMLButtonElement).disabled,
    ).toBe(false);

    // Switching companies must clear the shareholding selected against the previous company's
    // register — otherwise the form could submit companyId: company-2 paired with a
    // shareholding id that actually belongs to company-1.
    fireEvent.change(screen.getByLabelText(/company/i), { target: { value: "company-2" } });

    await waitFor(() => {
      expect((screen.getByLabelText(/transferor shareholding/i) as HTMLSelectElement).value).toBe(
        "",
      );
    });
    expect(
      (screen.getByRole("button", { name: /create request/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(serverFns.createCorporateChangeRequest).not.toHaveBeenCalled();
  });

  it("keeps Create request disabled for an officer_change detail_change with no updated name entered", async () => {
    const onCreated = vi.fn();

    render(
      <CreateCorporateChangeRequestDialog
        open
        onOpenChange={() => {}}
        companies={companies}
        isLoading={false}
        hasError={false}
        onCreated={onCreated}
      />,
    );

    fireEvent.change(screen.getByLabelText(/company/i), { target: { value: "company-1" } });
    fireEvent.change(screen.getByLabelText(/change type/i), {
      target: { value: "officer_change" },
    });

    await waitFor(() => {
      expect(clientServerFns.getClient).toHaveBeenCalledWith({ data: { id: "company-1" } });
    });

    fireEvent.change(screen.getByLabelText(/quoted fee/i), { target: { value: "1200" } });
    fireEvent.change(screen.getByLabelText(/officer action/i), {
      target: { value: "detail_change" },
    });
    await screen.findByRole("option", { name: /existing director/i, hidden: true });
    fireEvent.change(screen.getByLabelText(/^officer$/i), { target: { value: "officer-1" } });
    fireEvent.change(screen.getByLabelText(/effective date/i), {
      target: { value: "2026-09-01" },
    });

    // An officer is selected and the effective date is filled, but the "Updated name" field
    // (required by the JSX for both appoint and detail_change) is still empty.
    expect(
      (screen.getByRole("button", { name: /create request/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(serverFns.createCorporateChangeRequest).not.toHaveBeenCalled();
  });
});
