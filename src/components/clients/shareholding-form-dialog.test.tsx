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

    fireEvent.change(screen.getByLabelText("股東名稱"), {
      target: { value: "Jane Shareholder" },
    });
    fireEvent.change(screen.getByLabelText("股數"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("配發日期"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "記錄股權" }));

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

    fireEvent.change(screen.getByLabelText("股東名稱"), {
      target: { value: "Jane Shareholder" },
    });
    fireEvent.change(screen.getByLabelText("股數"), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText("配發日期"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "記錄股權" }));

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

    fireEvent.change(screen.getByLabelText("股東名稱"), {
      target: { value: "Jane Shareholder" },
    });
    fireEvent.change(screen.getByLabelText("股數"), { target: { value: "5e2" } });
    fireEvent.change(screen.getByLabelText("配發日期"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "記錄股權" }));

    expect(await screen.findByText("請輸入大於零的整數股數。")).toBeTruthy();
    const shares = screen.getByLabelText("股數");
    expect(shares.getAttribute("aria-invalid")).toBe("true");
    expect(shares.getAttribute("aria-describedby")).toBe("shareholding-form-error");
    expect(serverFns.recordClientShareholding).not.toHaveBeenCalled();
  });
});
