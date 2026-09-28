// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PersistedWorkItem } from "@/features/work-items/repository";

const workItemFns = vi.hoisted(() => ({
  listWorkItemPolicyChoices: vi.fn(),
  previewWorkItemPolicyBackfill: vi.fn(),
}));
const bulkFns = vi.hoisted(() => ({
  previewBulkOperation: vi.fn(),
  commitBulkOperation: vi.fn(),
}));
vi.mock("@/features/work-items/server-fns", () => workItemFns);
vi.mock("./server-fns", () => bulkFns);

import { WorkQueueBulkPolicyDialog } from "./work-queue-bulk-policy-dialog";

const ids = ["50000000-0000-4000-8000-000000000001", "50000000-0000-4000-8000-000000000002"];
const policyId = "40000000-0000-4000-8000-000000000001";
const items = ids.map((id, index) => ({
  id,
  title: `Work ${index + 1}`,
  version: index + 2,
  workType: "annual_return",
  slaPolicyVersionId: null,
})) as PersistedWorkItem[];
const snapshot = {
  workItemId: ids[0],
  policyVersionId: policyId,
  expectedVersion: items[0].version,
  startedAt: "2026-09-28T01:00:00.000Z",
  warningAt: "2026-09-28T02:00:00.000Z",
  dueAt: "2026-09-28T03:00:00.000Z",
  previewHash: "a".repeat(64),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("T05 durable bulk SLA policy control", () => {
  it("requires exact per-item server snapshots, durable dry-run, then explicit approval", async () => {
    workItemFns.listWorkItemPolicyChoices.mockResolvedValue([
      {
        id: policyId,
        name: "Annual return SLA",
        version: 2,
        calendarName: "Hong Kong office",
        warningMinutes: 60,
        dueMinutes: 120,
      },
    ]);
    workItemFns.previewWorkItemPolicyBackfill.mockResolvedValue([
      { workItemId: ids[0], state: "eligible", reasonCode: null, preview: snapshot },
      { workItemId: ids[1], state: "conflict", reasonCode: "REVISION_CHANGED", preview: null },
    ]);
    bulkFns.previewBulkOperation.mockResolvedValue({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      previewHash: "b".repeat(64),
      selectionCount: 1,
      eligibleCount: 1,
      skippedCount: 0,
      conflictCount: 0,
      expiresAt: "2030-01-01T00:00:00.000Z",
      itemsPreview: [{ resourceId: ids[0], revision: 2, state: "eligible", reasonCode: null }],
    });
    bulkFns.commitBulkOperation.mockResolvedValue({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" });
    const onCommitted = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <WorkQueueBulkPolicyDialog items={items} onClose={vi.fn()} onCommitted={onCommitted} />
      </QueryClientProvider>,
    );
    const approve = screen.getByRole("button", { name: "批准批量套用" }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    await screen.findByRole("option", { name: /Annual return SLA/ });
    fireEvent.change(screen.getByLabelText("政策版本"), { target: { value: policyId } });
    fireEvent.click(screen.getByRole("button", { name: "預覽批量時限" }));
    await waitFor(() => expect(bulkFns.previewBulkOperation).toHaveBeenCalledTimes(1));
    expect(workItemFns.previewWorkItemPolicyBackfill).toHaveBeenCalledWith({
      data: {
        policyVersionId: policyId,
        items: items.map((item) => ({ workItemId: item.id, expectedVersion: item.version })),
      },
    });
    expect(bulkFns.previewBulkOperation).toHaveBeenCalledWith({
      data: {
        action: "attachSlaPolicies",
        selection: { kind: "ids", ids: [ids[0]] },
        parameters: {
          policyVersionId: policyId,
          items: [
            {
              workItemId: ids[0],
              expectedVersion: snapshot.expectedVersion,
              startedAt: snapshot.startedAt,
              warningAt: snapshot.warningAt,
              dueAt: snapshot.dueAt,
              previewHash: snapshot.previewHash,
            },
          ],
        },
      },
    });
    expect(screen.getByText(/REVISION_CHANGED/)).toBeTruthy();
    expect(bulkFns.commitBulkOperation).not.toHaveBeenCalled();
    fireEvent.click(approve);
    await waitFor(() =>
      expect(onCommitted).toHaveBeenCalledWith("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
    );
    expect(bulkFns.commitBulkOperation).toHaveBeenCalledWith({
      data: {
        previewId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        previewHash: "b".repeat(64),
        idempotencyKey: expect.any(String),
      },
    });
  });

  it("does not enable approval when every selected item conflicts", async () => {
    workItemFns.listWorkItemPolicyChoices.mockResolvedValue([
      {
        id: policyId,
        name: "Annual return SLA",
        version: 2,
        calendarName: "Hong Kong office",
        warningMinutes: 60,
        dueMinutes: 120,
      },
    ]);
    workItemFns.previewWorkItemPolicyBackfill.mockResolvedValue(
      ids.map((workItemId) => ({
        workItemId,
        state: "conflict",
        reasonCode: "WORK_ITEM_NOT_ELIGIBLE",
        preview: null,
      })),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <WorkQueueBulkPolicyDialog items={items} onClose={vi.fn()} onCommitted={vi.fn()} />
      </QueryClientProvider>,
    );
    await screen.findByRole("option", { name: /Annual return SLA/ });
    fireEvent.change(screen.getByLabelText("政策版本"), { target: { value: policyId } });
    fireEvent.click(screen.getByRole("button", { name: "預覽批量時限" }));
    await screen.findAllByText(/WORK_ITEM_NOT_ELIGIBLE/);
    expect(bulkFns.previewBulkOperation).not.toHaveBeenCalled();
    expect(
      (screen.getByRole("button", { name: "批准批量套用" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
