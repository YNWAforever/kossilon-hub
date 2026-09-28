// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersistedWorkItem } from "./repository";

const serverFns = vi.hoisted(() => ({
  listWorkItemPolicyChoices: vi.fn(),
  previewWorkItemPolicyAttachment: vi.fn(),
  attachWorkItemPolicy: vi.fn(),
}));
vi.mock("./server-fns", () => serverFns);

import { PolicyAttachmentDialog } from "./policy-attachment-dialog";

const item = {
  id: "50000000-0000-4000-8000-000000000001",
  title: "Prepare annual return",
  version: 3,
  slaPolicyVersionId: null,
} as PersistedWorkItem;
const policyId = "40000000-0000-4000-8000-000000000001";
const preview = {
  workItemId: item.id,
  policyVersionId: policyId,
  expectedVersion: item.version,
  startedAt: "2026-09-28T01:00:00.000Z",
  warningAt: "2026-09-28T02:00:00.000Z",
  dueAt: "2026-09-28T03:00:00.000Z",
  previewHash: "a".repeat(64),
};

function renderDialog(onAttached = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <PolicyAttachmentDialog item={item} onClose={vi.fn()} onAttached={onAttached} />
    </QueryClientProvider>,
  );
  return onAttached;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("T05 Admin policy attachment preview", () => {
  it("requires an explicit selected-policy preview before applying the exact snapshot", async () => {
    serverFns.listWorkItemPolicyChoices.mockResolvedValue([
      {
        id: policyId,
        name: "Annual return SLA",
        version: 2,
        calendarName: "Hong Kong office",
        warningMinutes: 60,
        dueMinutes: 120,
      },
    ]);
    serverFns.previewWorkItemPolicyAttachment.mockResolvedValue(preview);
    serverFns.attachWorkItemPolicy.mockResolvedValue({ ...item, slaPolicyVersionId: policyId });
    const onAttached = renderDialog();
    const apply = screen.getByRole("button", { name: "確認套用" }) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    await screen.findByRole("option", { name: /Annual return SLA/ });
    fireEvent.change(screen.getByLabelText("政策版本"), { target: { value: policyId } });
    expect(apply.disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "預覽時限" }));
    await screen.findByLabelText("服務時限預覽");
    expect(serverFns.attachWorkItemPolicy).not.toHaveBeenCalled();
    expect(apply.disabled).toBe(false);
    fireEvent.click(apply);
    await waitFor(() =>
      expect(serverFns.attachWorkItemPolicy).toHaveBeenCalledWith({ data: preview }),
    );
    await waitFor(() => expect(onAttached).toHaveBeenCalledTimes(1));
  });

  it("requires a fresh preview after an apply error", async () => {
    serverFns.listWorkItemPolicyChoices.mockResolvedValue([
      {
        id: policyId,
        name: "Annual return SLA",
        version: 2,
        calendarName: "Hong Kong office",
        warningMinutes: 60,
        dueMinutes: 120,
      },
    ]);
    serverFns.previewWorkItemPolicyAttachment.mockResolvedValue(preview);
    serverFns.attachWorkItemPolicy.mockRejectedValue(new Error("stale"));
    renderDialog();
    await screen.findByRole("option", { name: /Annual return SLA/ });
    fireEvent.change(screen.getByLabelText("政策版本"), { target: { value: policyId } });
    fireEvent.click(screen.getByRole("button", { name: "預覽時限" }));
    await screen.findByLabelText("服務時限預覽");
    fireEvent.click(screen.getByRole("button", { name: "確認套用" }));
    await screen.findByText(/套用失敗/);
    expect((screen.getByRole("button", { name: "確認套用" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("keeps apply disabled when the selected policy cannot be previewed", async () => {
    serverFns.listWorkItemPolicyChoices.mockResolvedValue([
      {
        id: policyId,
        name: "Annual return SLA",
        version: 2,
        calendarName: "Hong Kong office",
        warningMinutes: 60,
        dueMinutes: 120,
      },
    ]);
    serverFns.previewWorkItemPolicyAttachment.mockRejectedValue(new Error("stale"));
    renderDialog();
    await screen.findByRole("option", { name: /Annual return SLA/ });
    fireEvent.change(screen.getByLabelText("政策版本"), { target: { value: policyId } });
    fireEvent.click(screen.getByRole("button", { name: "預覽時限" }));
    await screen.findByRole("alert");
    expect((screen.getByRole("button", { name: "確認套用" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(serverFns.attachWorkItemPolicy).not.toHaveBeenCalled();
  });
});
