// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateCorporateChangeRequestDialog } from "./create-corporate-change-request-dialog";

const serverFns = vi.hoisted(() => ({
  createCorporateChangeRequest: vi.fn(),
}));

vi.mock("@/features/corporate-changes/server-fns", () => ({
  createCorporateChangeRequest: serverFns.createCorporateChangeRequest,
}));

const companies = [{ id: "company-1", companyName: "Test Co Ltd" }];

describe("CreateCorporateChangeRequestDialog", () => {
  beforeEach(() => {
    serverFns.createCorporateChangeRequest.mockReset();
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
