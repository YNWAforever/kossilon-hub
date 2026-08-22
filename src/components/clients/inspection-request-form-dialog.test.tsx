// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InspectionRequestFormDialog } from "./inspection-request-form-dialog";

const serverFns = vi.hoisted(() => ({
  recordClientInspectionRequest: vi.fn(),
}));

vi.mock("@/features/clients/server-fns", () => ({
  recordClientInspectionRequest: serverFns.recordClientInspectionRequest,
}));

describe("InspectionRequestFormDialog", () => {
  beforeEach(() => {
    serverFns.recordClientInspectionRequest.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("records an inspection request with the entered fields", async () => {
    serverFns.recordClientInspectionRequest.mockResolvedValue({ id: "client-1" });
    const onSaved = vi.fn();

    render(
      <InspectionRequestFormDialog
        open
        onOpenChange={() => {}}
        companyId="company-1"
        onSaved={onSaved}
      />,
    );

    fireEvent.change(screen.getByLabelText("Requester name"), {
      target: { value: "Officer Lee" },
    });
    fireEvent.change(screen.getByLabelText("Requester authority"), {
      target: { value: "Companies Registry" },
    });
    fireEvent.change(screen.getByLabelText("Request date"), {
      target: { value: "2026-01-15" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record request" }));

    await waitFor(() =>
      expect(serverFns.recordClientInspectionRequest).toHaveBeenCalledWith({
        data: {
          companyId: "company-1",
          requesterName: "Officer Lee",
          requesterAuthority: "Companies Registry",
          requestDate: "2026-01-15",
        },
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it("shows an error and does not close when the server call fails", async () => {
    serverFns.recordClientInspectionRequest.mockRejectedValue(new Error("Client not found."));

    render(
      <InspectionRequestFormDialog
        open
        onOpenChange={() => {}}
        companyId="company-1"
        onSaved={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText("Requester name"), {
      target: { value: "Officer Lee" },
    });
    fireEvent.change(screen.getByLabelText("Requester authority"), {
      target: { value: "Companies Registry" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record request" }));

    expect(await screen.findByText("Client not found.")).toBeTruthy();
  });
});
