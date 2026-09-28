// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResourceTagDialog } from "./resource-tag-dialog";

const serverFns = vi.hoisted(() => ({
  previewBulkOperation: vi.fn(),
  commitBulkOperation: vi.fn(),
}));
vi.mock("./server-fns", () => serverFns);

describe("T22 tag approval dialog", () => {
  beforeEach(() => {
    serverFns.previewBulkOperation.mockReset();
    serverFns.commitBulkOperation.mockReset();
    serverFns.previewBulkOperation.mockResolvedValue({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      previewHash: "a".repeat(64),
      selectionCount: 1,
      eligibleCount: 1,
      skippedCount: 0,
      conflictCount: 0,
      expiresAt: "2030-01-01T00:00:00.000Z",
      itemsPreview: [
        {
          resourceId: "11111111-1111-4111-8111-111111111111",
          revision: 1,
          state: "eligible",
          reasonCode: null,
        },
      ],
    });
    serverFns.commitBulkOperation.mockResolvedValue({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });
  });
  afterEach(cleanup);

  it("requires a fresh read-only preview before explicit tag approval", async () => {
    const onCommitted = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ResourceTagDialog
          selection={{
            kind: "ids",
            resource: "clients",
            ids: ["11111111-1111-4111-8111-111111111111"],
          }}
          onClose={vi.fn()}
          onCommitted={onCommitted}
        />
      </QueryClientProvider>,
    );
    expect(
      (screen.getByRole("button", { name: "Queue approved tags" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("Tag"), { target: { value: "Urgent" } });
    expect(serverFns.commitBulkOperation).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Preview tags" }));
    await screen.findByText(/1 selected/);
    expect(serverFns.previewBulkOperation).toHaveBeenCalledWith({
      data: {
        action: "tag",
        selection: {
          kind: "ids",
          resource: "clients",
          ids: ["11111111-1111-4111-8111-111111111111"],
        },
        parameters: { tag: "Urgent", mode: "add" },
      },
    });
    fireEvent.change(screen.getByLabelText("Tag"), { target: { value: "Revised" } });
    expect(
      (screen.getByRole("button", { name: "Queue approved tags" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Preview tags" }));
    await waitFor(() => expect(serverFns.previewBulkOperation).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Queue approved tags" }));
    await waitFor(() =>
      expect(onCommitted).toHaveBeenCalledWith("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
    );
    expect(serverFns.commitBulkOperation).toHaveBeenCalledTimes(1);
  });
});
