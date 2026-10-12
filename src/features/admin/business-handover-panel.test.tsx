// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { afterEach, it, expect, vi } from "vitest";
import { BusinessHandoverPanel } from "./business-handover-panel";
const api = vi.hoisted(() => ({
  listStaff: vi.fn(),
  transferStaffBusinessHandover: vi.fn(),
  getStaffBusinessHandoverReceipt: vi.fn(),
}));
vi.mock("./server-fns", () => api);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("confirms a version-bound transfer and reconciles an unknown response before any new mutation", async () => {
  const userId = "11111111-1111-4111-8111-111111111111",
    recipientId = "22222222-2222-4222-8222-222222222222",
    blocked = vi.fn();
  api.listStaff.mockResolvedValue({
    staff: [
      {
        userId: recipientId,
        displayName: "陳同事",
        role: "Staff",
        active: true,
        stateMismatch: false,
      },
    ],
    nextCursor: null,
  });
  api.transferStaffBusinessHandover.mockRejectedValue(Error("SECRET SQL reset"));
  api.getStaffBusinessHandoverReceipt.mockResolvedValue({ state: "succeeded" });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <BusinessHandoverPanel
        userId={userId}
        expectedVersion={1}
        teamId={recipientId}
        actorScope="admin"
        items={[
          {
            id: recipientId,
            kind: "incorporation",
            label: "本案公司",
            status: "Intake",
            version: "a".repeat(32),
          },
        ]}
        onUnconfirmedChange={blocked}
      />
    </QueryClientProvider>,
  );
  await screen.findByRole("option", { name: "陳同事" });
  fireEvent.change(screen.getByLabelText("接手同事"), { target: { value: recipientId } });
  fireEvent.click(screen.getByRole("button", { name: "轉交 本案公司" }));
  await screen.findByRole("dialog", { name: "確認業務交接" });
  expect(api.transferStaffBusinessHandover).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "確認轉交這一項" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).not.toContain("SECRET");
  expect(blocked).toHaveBeenCalledWith(true);
  expect(api.transferStaffBusinessHandover).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "核對已保存回執" }));
  await waitFor(() => expect(blocked).toHaveBeenLastCalledWith(false));
  expect(api.transferStaffBusinessHandover).toHaveBeenCalledTimes(1);
  expect(api.getStaffBusinessHandoverReceipt).toHaveBeenCalledWith({
    data: expect.objectContaining({ userId, operationId: expect.any(String) }),
  });
});
it("a definite pre-write refusal permits a new preview without unknown reconciliation", async () => {
  api.listStaff.mockResolvedValue({
    staff: [
      {
        userId: "22222222-2222-4222-8222-222222222222",
        displayName: "陳同事",
        role: "Staff",
        active: true,
        stateMismatch: false,
      },
    ],
    nextCursor: null,
  });
  api.transferStaffBusinessHandover.mockResolvedValue({
    state: "rejected",
    operationId: "receipt",
    reason: "staff_version_conflict",
  });
  const blocked = vi.fn();
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <BusinessHandoverPanel
        userId="11111111-1111-4111-8111-111111111111"
        expectedVersion={1}
        teamId={null}
        actorScope="admin"
        items={[
          {
            id: "22222222-2222-4222-8222-222222222222",
            kind: "incorporation",
            label: "新預覽案",
            status: "Intake",
            version: "a".repeat(32),
          },
        ]}
        onUnconfirmedChange={blocked}
      />
    </QueryClientProvider>,
  );
  await screen.findByRole("option", { name: "陳同事" });
  fireEvent.change(screen.getByLabelText("接手同事"), {
    target: { value: "22222222-2222-4222-8222-222222222222" },
  });
  fireEvent.click(screen.getByRole("button", { name: "轉交 新預覽案" }));
  fireEvent.click(await screen.findByRole("button", { name: "確認轉交這一項" }));
  await screen.findByText(/這一項未套用/);
  expect(blocked).toHaveBeenLastCalledWith(false);
  expect(api.getStaffBusinessHandoverReceipt).not.toHaveBeenCalled();
  expect(
    (screen.getByRole("button", { name: "轉交 新預覽案" }) as HTMLButtonElement).disabled,
  ).toBe(false);
});
