// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResolveInspectionRequestDialog } from "./resolve-inspection-request-dialog";

const serverFns = vi.hoisted(() => ({
  resolveClientInspectionRequest: vi.fn(),
}));

vi.mock("@/features/clients/server-fns", () => ({
  resolveClientInspectionRequest: serverFns.resolveClientInspectionRequest,
}));

describe("ResolveInspectionRequestDialog", () => {
  beforeEach(() => {
    serverFns.resolveClientInspectionRequest.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("resolves the request with the entered note", async () => {
    serverFns.resolveClientInspectionRequest.mockResolvedValue({ id: "client-1" });
    const onSaved = vi.fn();

    render(
      <ResolveInspectionRequestDialog
        open
        onOpenChange={() => {}}
        companyId="company-1"
        inspectionRequestId="request-1"
        onSaved={onSaved}
      />,
    );

    fireEvent.change(screen.getByLabelText("Resolution note"), {
      target: { value: "Shown to Officer Lee on site." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));

    await waitFor(() =>
      expect(serverFns.resolveClientInspectionRequest).toHaveBeenCalledWith({
        data: {
          companyId: "company-1",
          inspectionRequestId: "request-1",
          resolutionNote: "Shown to Officer Lee on site.",
        },
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it("shows an error and does not close when the server call fails", async () => {
    serverFns.resolveClientInspectionRequest.mockRejectedValue(new Error("Client not found."));

    render(
      <ResolveInspectionRequestDialog
        open
        onOpenChange={() => {}}
        companyId="company-1"
        inspectionRequestId="request-1"
        onSaved={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText("Resolution note"), {
      target: { value: "Shown to Officer Lee on site." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Resolve" }));

    expect(await screen.findByText("Client not found.")).toBeTruthy();
  });
});
