// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShareholdingFormDialog } from "./shareholding-form-dialog";

const serverFns = vi.hoisted(() => ({
  recordClientShareholding: vi.fn(),
}));

vi.mock("@/features/clients/server-fns", () => ({
  recordClientShareholding: serverFns.recordClientShareholding,
}));

describe("ShareholdingFormDialog", () => {
  beforeEach(() => {
    serverFns.recordClientShareholding.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("records a shareholding with the entered fields", async () => {
    serverFns.recordClientShareholding.mockResolvedValue({ id: "client-1" });
    const onSaved = vi.fn();

    render(
      <ShareholdingFormDialog
        open
        onOpenChange={() => {}}
        companyId="company-1"
        onSaved={onSaved}
      />,
    );

    fireEvent.change(screen.getByLabelText("Shareholder name"), {
      target: { value: "Jane Shareholder" },
    });
    fireEvent.change(screen.getByLabelText("Number of shares"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Allotment date"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record shareholding" }));

    await waitFor(() =>
      expect(serverFns.recordClientShareholding).toHaveBeenCalledWith({
        data: {
          companyId: "company-1",
          shareholderName: "Jane Shareholder",
          shareholderAddress: null,
          shareClass: "Ordinary",
          numberOfShares: 100,
          allotmentDate: "2026-01-01",
        },
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it("shows an error and does not close when the server call fails", async () => {
    serverFns.recordClientShareholding.mockRejectedValue(new Error("Client not found."));

    render(
      <ShareholdingFormDialog
        open
        onOpenChange={() => {}}
        companyId="company-1"
        onSaved={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText("Shareholder name"), {
      target: { value: "Jane Shareholder" },
    });
    fireEvent.change(screen.getByLabelText("Number of shares"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("Allotment date"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record shareholding" }));

    expect(await screen.findByText("Client not found.")).toBeTruthy();
  });

  it("rejects a malformed share count without calling the server", async () => {
    render(
      <ShareholdingFormDialog
        open
        onOpenChange={() => {}}
        companyId="company-1"
        onSaved={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText("Shareholder name"), {
      target: { value: "Jane Shareholder" },
    });
    fireEvent.change(screen.getByLabelText("Number of shares"), { target: { value: "5e2" } });
    fireEvent.change(screen.getByLabelText("Allotment date"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record shareholding" }));

    expect(
      await screen.findByText("Enter a whole number of shares greater than zero."),
    ).toBeTruthy();
    expect(serverFns.recordClientShareholding).not.toHaveBeenCalled();
  });
});
