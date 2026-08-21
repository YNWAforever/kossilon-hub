// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OfficerFormDialog } from "./officer-form-dialog";

const serverFns = vi.hoisted(() => ({
  appointClientOfficer: vi.fn(),
}));

vi.mock("@/features/clients/server-fns", () => ({
  appointClientOfficer: serverFns.appointClientOfficer,
}));

describe("OfficerFormDialog", () => {
  beforeEach(() => {
    serverFns.appointClientOfficer.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("appoints a director with the entered fields", async () => {
    serverFns.appointClientOfficer.mockResolvedValue({ id: "client-1" });
    const onSaved = vi.fn();

    render(
      <OfficerFormDialog open onOpenChange={() => {}} companyId="company-1" onSaved={onSaved} />,
    );

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jane Director" } });
    fireEvent.change(screen.getByLabelText("Appointment date"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Appoint officer" }));

    await waitFor(() =>
      expect(serverFns.appointClientOfficer).toHaveBeenCalledWith({
        data: {
          companyId: "company-1",
          officerType: "director",
          name: "Jane Director",
          identificationType: null,
          identificationNumber: null,
          address: null,
          appointmentDate: "2026-01-01",
        },
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it("appoints a Designated Representative when that type is selected", async () => {
    serverFns.appointClientOfficer.mockResolvedValue({ id: "client-1" });
    const onSaved = vi.fn();

    render(
      <OfficerFormDialog open onOpenChange={() => {}} companyId="company-1" onSaved={onSaved} />,
    );

    fireEvent.change(screen.getByLabelText("Type"), {
      target: { value: "designated_representative" },
    });
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jane DR" } });
    fireEvent.change(screen.getByLabelText("Appointment date"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Appoint officer" }));

    await waitFor(() =>
      expect(serverFns.appointClientOfficer).toHaveBeenCalledWith({
        data: {
          companyId: "company-1",
          officerType: "designated_representative",
          name: "Jane DR",
          identificationType: null,
          identificationNumber: null,
          address: null,
          appointmentDate: "2026-01-01",
        },
      }),
    );
    expect(onSaved).toHaveBeenCalled();
  });

  it("shows an error and does not close when the server call fails", async () => {
    serverFns.appointClientOfficer.mockRejectedValue(
      new Error("Officer not found for this company."),
    );

    render(
      <OfficerFormDialog open onOpenChange={() => {}} companyId="company-1" onSaved={() => {}} />,
    );

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Jane Director" } });
    fireEvent.change(screen.getByLabelText("Appointment date"), {
      target: { value: "2026-01-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Appoint officer" }));

    expect(await screen.findByText("Officer not found for this company.")).toBeTruthy();
  });
});
