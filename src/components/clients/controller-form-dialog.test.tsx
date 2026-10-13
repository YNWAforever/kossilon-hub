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

    fireEvent.change(screen.getByLabelText("重要控制人名稱"), {
      target: { value: "Jane Controller" },
    });
    fireEvent.click(screen.getByLabelText("持有超過 25% 股份"));
    fireEvent.change(screen.getByLabelText("登記日期"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "記錄重要控制人" }));

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

    fireEvent.change(screen.getByLabelText("重要控制人名稱"), {
      target: { value: "Jane Controller" },
    });
    fireEvent.click(screen.getByRole("button", { name: "記錄重要控制人" }));

    expect(await screen.findByText("請選擇最少一項控制條件。")).toBeTruthy();
    expect(serverFns.recordClientController).not.toHaveBeenCalled();
  });

  it("rejects a register update due date earlier than the registered date, without calling the server", async () => {
    render(
      <ControllerFormDialog
        open
        onOpenChange={() => {}}
        companyId="company-1"
        onSaved={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText("重要控制人名稱"), {
      target: { value: "Jane Controller" },
    });
    fireEvent.click(screen.getByLabelText("持有超過 25% 股份"));
    fireEvent.change(screen.getByLabelText("登記日期"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.change(screen.getByLabelText("登記冊更新到期日"), {
      target: { value: "2025-12-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "記錄重要控制人" }));

    expect(await screen.findByText("登記冊更新到期日不可早於登記日期。")).toBeTruthy();
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

    expect(screen.queryByLabelText("重要控制人名稱")).toBeNull();
    fireEvent.change(screen.getByLabelText("地址"), { target: { value: "New address" } });
    fireEvent.click(screen.getByLabelText("行使重大影響力或控制權"));
    fireEvent.click(screen.getByRole("button", { name: "儲存資料" }));

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

  it("shows an error and does not close when the server call fails", async () => {
    serverFns.recordClientController.mockRejectedValue(new Error("Client not found."));

    render(
      <ControllerFormDialog
        open
        onOpenChange={() => {}}
        companyId="company-1"
        onSaved={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText("重要控制人名稱"), {
      target: { value: "Jane Controller" },
    });
    fireEvent.click(screen.getByLabelText("持有超過 25% 股份"));
    fireEvent.change(screen.getByLabelText("登記日期"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "記錄重要控制人" }));

    expect(await screen.findByText("Client not found.")).toBeTruthy();
  });

  it("excludes a control basis that was checked and then unchecked", async () => {
    serverFns.recordClientController.mockResolvedValue({ id: "client-1" });
    const onSaved = vi.fn();

    render(
      <ControllerFormDialog open onOpenChange={() => {}} companyId="company-1" onSaved={onSaved} />,
    );

    fireEvent.change(screen.getByLabelText("重要控制人名稱"), {
      target: { value: "Jane Controller" },
    });
    fireEvent.click(screen.getByLabelText("持有超過 25% 股份"));
    fireEvent.click(screen.getByLabelText("持有超過 25% 股份"));
    fireEvent.click(screen.getByLabelText("行使重大影響力或控制權"));
    fireEvent.change(screen.getByLabelText("登記日期"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "記錄重要控制人" }));

    await waitFor(() =>
      expect(serverFns.recordClientController).toHaveBeenCalledWith({
        data: {
          companyId: "company-1",
          controllerName: "Jane Controller",
          identificationType: null,
          identificationNumber: null,
          address: null,
          controlBases: ["significant_influence"],
          registeredDate: "2026-01-01",
          registerUpdateDueDate: null,
        },
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });
});
