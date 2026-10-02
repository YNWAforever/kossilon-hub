// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CaseHandoff } from "./case-handoff";
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  command: vi.fn(),
  export: vi.fn(),
  documents: vi.fn(),
}));
vi.mock("../handoff-server-fns", () => ({
  getCaseHandoffs: mocks.get,
  runHandoffCommand: mocks.command,
  exportApprovedHandoff: mocks.export,
}));
vi.mock("@/features/documents/server-fns", () => ({ listDocuments: mocks.documents }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("human package approval and manual submission UI", () => {
  it("accepts second-precision actual submission within the approval minute", async () => {
    mocks.get.mockResolvedValue({
      preview: {
        readyForApproval: true,
        sourceVersion: "v1",
        manifestSha256: "a".repeat(64),
        blockers: [],
      },
      handoffs: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          manifestSha256: "a".repeat(64),
          status: "prepared",
          deliveryFact: "exported",
          exportedAt: "2026-10-02T03:45:10Z",
          createdAt: "2026-10-02T03:45:05Z",
        },
      ],
      returns: [],
      connectorConfigured: false,
    });
    mocks.documents.mockResolvedValue([]);
    mocks.command.mockResolvedValue({});
    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
          })
        }
      >
        <CaseHandoff caseId="11111111-1111-4111-8111-111111111111" locked={false} />
      </QueryClientProvider>,
    );
    const time = await screen.findByLabelText("實際提交時間");
    expect((time as HTMLInputElement).step).toBe("1");
    fireEvent.change(time, { target: { value: "2026-10-02T11:45:30" } });
    fireEvent.change(screen.getByLabelText("人工提交參考"), {
      target: { value: "Synthetic within-minute" },
    });
    fireEvent.change(screen.getByLabelText("操作說明"), {
      target: { value: "No actual external submission claimed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "記錄人工提交（無系統收據）" }));
    await waitFor(() =>
      expect(mocks.command).toHaveBeenCalledWith({
        data: expect.objectContaining({
          command: "manual_submission",
          occurredAt: new Date("2026-10-02T11:45:30").toISOString(),
        }),
      }),
    );
  });
  it("requires current manifest confirmation and keeps empty manual records distinct from connector health", async () => {
    mocks.get.mockResolvedValue({
      preview: {
        readyForApproval: true,
        sourceVersion: "v1",
        manifestSha256: "a".repeat(64),
        blockers: [],
      },
      handoffs: [],
      returns: [],
      connectorConfigured: false,
    });
    mocks.documents.mockResolvedValue([]);
    mocks.command.mockResolvedValue({ id: "package" });
    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
          })
        }
      >
        <CaseHandoff caseId="11111111-1111-4111-8111-111111111111" locked={false} />
      </QueryClientProvider>,
    );
    const button = await screen.findByRole("button", { name: "批准當前套件" });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/未配置外部交件連接器/)).toBeTruthy();
    expect(screen.getByText(/未有人工交件或回件紀錄/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: /已核對當前文件/ }));
    fireEvent.click(button);
    await waitFor(() =>
      expect(mocks.command).toHaveBeenCalledWith({
        data: {
          command: "approve",
          caseId: "11111111-1111-4111-8111-111111111111",
          expectedVersion: "v1",
          manifestSha256: "a".repeat(64),
        },
      }),
    );
    expect(mocks.export).not.toHaveBeenCalled();
  });
});
