// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ControllerFormDialog } from "./controller-form-dialog";
import type { SignificantController } from "@/features/clients/types";

const serverFns = vi.hoisted(() => ({
  recordClientController: vi.fn(),
  updateClientControllerParticulars: vi.fn(),
}));

vi.mock("@/features/clients/server-fns", () => ({
  recordClientController: serverFns.recordClientController,
  updateClientControllerParticulars: serverFns.updateClientControllerParticulars,
}));

describe("ControllerFormDialog", () => {
  beforeEach(() => {
    serverFns.recordClientController.mockReset();
    serverFns.updateClientControllerParticulars.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("records a controller with the entered fields", async () => {
    serverFns.recordClientController.mockResolvedValue({ id: "client-1" });
    const onSaved = vi.fn();

    render(
      <ControllerFormDialog open onOpenChange={() => {}} companyId="company-1" onSaved={onSaved} />,
    );

    fireEvent.change(screen.getByLabelText("Controller name"), {
      target: { value: "Jane Controller" },
    });
    fireEvent.click(screen.getByLabelText("Holds more than 25% of shares"));
    fireEvent.change(screen.getByLabelText("Registered date"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record controller" }));

    await waitFor(() =>
      expect(serverFns.recordClientController).toHaveBeenCalledWith({
        data: {
          companyId: "company-1",
          controllerName: "Jane Controller",
          identificationType: null,
          identificationNumber: null,
          address: null,
          controlBases: ["shares_over_25pct"],
          registeredDate: "2026-01-01",
          registerUpdateDueDate: null,
        },
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it("rejects submitting with no control basis selected, without calling the server", async () => {
    render(
      <ControllerFormDialog
        open
        onOpenChange={() => {}}
        companyId="company-1"
        onSaved={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText("Controller name"), {
      target: { value: "Jane Controller" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Record controller" }));

    expect(await screen.findByText("Select at least one control basis.")).toBeTruthy();
    expect(serverFns.recordClientController).not.toHaveBeenCalled();
  });

  it("edits an existing controller's particulars", async () => {
    serverFns.updateClientControllerParticulars.mockResolvedValue({ id: "client-1" });
    const onSaved = vi.fn();
    const controller: SignificantController = {
      id: "controller-1",
      companyId: "company-1",
      controllerName: "Jane Controller",
      identificationType: null,
      identificationNumber: null,
      address: "Old address",
      controlBases: ["shares_over_25pct"],
      registeredDate: "2020-01-15",
      cessationDate: null,
      registerUpdateDueDate: null,
    };

    render(
      <ControllerFormDialog
        open
        onOpenChange={() => {}}
        companyId="company-1"
        controller={controller}
        onSaved={onSaved}
      />,
    );

    expect(screen.queryByLabelText("Controller name")).toBeNull();
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "New address" } });
    fireEvent.click(screen.getByLabelText("Exercises significant influence or control"));
    fireEvent.click(screen.getByRole("button", { name: "Save particulars" }));

    await waitFor(() =>
      expect(serverFns.updateClientControllerParticulars).toHaveBeenCalledWith({
        data: {
          companyId: "company-1",
          controllerId: "controller-1",
          address: "New address",
          controlBases: ["shares_over_25pct", "significant_influence"],
          registerUpdateDueDate: null,
        },
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });
});
