// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateIncorporationCaseDialog } from "./create-incorporation-case-dialog";

const serverFns = vi.hoisted(() => ({
  createIncorporationCase: vi.fn(),
}));

vi.mock("@/features/incorporation/server-fns", () => ({
  createIncorporationCase: serverFns.createIncorporationCase,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const owners = [{ id: "owner-1", name: "Amy Chan", teamId: "team-1" }];
const teams = [{ id: "team-1", name: "Team Alpha" }];

describe("CreateIncorporationCaseDialog", () => {
  beforeEach(() => {
    serverFns.createIncorporationCase.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("creates a case with the entered fields", async () => {
    serverFns.createIncorporationCase.mockResolvedValue({ id: "case-1" });
    const onCreated = vi.fn();

    render(
      <CreateIncorporationCaseDialog
        open
        onOpenChange={() => {}}
        owners={owners}
        teams={teams}
        isLoading={false}
        hasError={false}
        onCreated={onCreated}
      />,
    );

    fireEvent.change(screen.getByLabelText("擬用名稱（英文）"), {
      target: { value: "New Venture Limited" },
    });
    fireEvent.change(screen.getByLabelText("擬用註冊辦事處"), {
      target: { value: "1 Test Street, Hong Kong" },
    });
    fireEvent.change(screen.getByLabelText("業務性質"), {
      target: { value: "Trading" },
    });
    fireEvent.change(screen.getByLabelText("目標完成日期"), {
      target: { value: "2026-09-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "開始公司註冊" }));

    await waitFor(() =>
      expect(serverFns.createIncorporationCase).toHaveBeenCalledWith({
        data: {
          proposedCompanyNameEn: "New Venture Limited",
          proposedCompanyNameZh: null,
          proposedRegisteredOffice: "1 Test Street, Hong Kong",
          proposedCompanySecretary: "Kossilon Secretaries Ltd",
          registeredCapital: 10000,
          businessNature: "Trading",
          ownerId: "owner-1",
          teamId: "team-1",
          targetCompletionDate: "2026-09-01",
        },
      }),
    );
    expect(onCreated).toHaveBeenCalledWith("case-1");
  });

  it("rejects a malformed registered capital without calling the server", async () => {
    render(
      <CreateIncorporationCaseDialog
        open
        onOpenChange={() => {}}
        owners={owners}
        teams={teams}
        isLoading={false}
        hasError={false}
        onCreated={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText("擬用名稱（英文）"), {
      target: { value: "New Venture Limited" },
    });
    fireEvent.change(screen.getByLabelText("擬用註冊辦事處"), {
      target: { value: "1 Test Street, Hong Kong" },
    });
    fireEvent.change(screen.getByLabelText("業務性質"), {
      target: { value: "Trading" },
    });
    fireEvent.change(screen.getByLabelText("註冊資本（HKD）"), {
      target: { value: "5e2" },
    });
    fireEvent.change(screen.getByLabelText("目標完成日期"), {
      target: { value: "2026-09-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "開始公司註冊" }));

    expect(await screen.findByText("註冊資本須為大於零的整數金額。")).toBeTruthy();
    expect(serverFns.createIncorporationCase).not.toHaveBeenCalled();
  });

  it("shows an error and does not close when the server call fails", async () => {
    serverFns.createIncorporationCase.mockRejectedValue(new Error("Owner not found or inactive."));

    render(
      <CreateIncorporationCaseDialog
        open
        onOpenChange={() => {}}
        owners={owners}
        teams={teams}
        isLoading={false}
        hasError={false}
        onCreated={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText("擬用名稱（英文）"), {
      target: { value: "New Venture Limited" },
    });
    fireEvent.change(screen.getByLabelText("擬用註冊辦事處"), {
      target: { value: "1 Test Street, Hong Kong" },
    });
    fireEvent.change(screen.getByLabelText("業務性質"), {
      target: { value: "Trading" },
    });
    fireEvent.change(screen.getByLabelText("目標完成日期"), {
      target: { value: "2026-09-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "開始公司註冊" }));

    expect(await screen.findByText("Owner not found or inactive.")).toBeTruthy();
  });
});
