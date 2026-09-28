// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ManualReturnPanel } from "./manual-return-panel";

const server = vi.hoisted(() => ({
  getAnnualReturnReturnIntakes: vi.fn(),
  listAnnualReturnSubmissionProofs: vi.fn(),
  recordAnnualReturnReturnIntake: vi.fn(),
  reconcileAnnualReturnReturn: vi.fn(),
}));
vi.mock("../package-server-fns", () => server);

const caseId = "11111111-1111-4111-8111-111111111111";
const proofVersionId = "22222222-2222-4222-8222-222222222222";
const returnId = "33333333-3333-4333-8333-333333333333";
const submissionId = "44444444-4444-4444-8444-444444444444";
function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ManualReturnPanel caseId={caseId} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  server.getAnnualReturnReturnIntakes.mockResolvedValue([]);
  server.listAnnualReturnSubmissionProofs.mockResolvedValue([
    { versionId: proofVersionId, fileName: "registry-response.pdf", category: "receipt" },
  ]);
  server.recordAnnualReturnReturnIntake.mockResolvedValue({ id: returnId });
  server.reconcileAnnualReturnReturn.mockResolvedValue({ id: returnId });
});
afterEach(cleanup);

describe("T16 production manual return panel", () => {
  it("records a reviewed receipt as a claim without inventing a manifest hash", async () => {
    renderPanel();
    const proof = await screen.findByLabelText("已覆核回執");
    fireEvent.change(screen.getByLabelText("回件外部參考編號"), {
      target: { value: "NAR1-2026-001" },
    });
    fireEvent.change(screen.getByLabelText("回件聲稱結果"), {
      target: { value: "partial" },
    });
    fireEvent.change(proof, { target: { value: proofVersionId } });
    fireEvent.click(screen.getByRole("button", { name: "登記回件主張" }));
    await waitFor(() =>
      expect(server.recordAnnualReturnReturnIntake).toHaveBeenCalledWith({
        data: {
          caseId,
          externalReference: "NAR1-2026-001",
          manifestHash: null,
          outcome: "partial",
          detail: null,
          source: { kind: "manual", proofVersionId },
        },
      }),
    );
  });

  it("requires an explicit reviewer action for a candidate and preserves partial status", async () => {
    server.getAnnualReturnReturnIntakes.mockResolvedValue([
      {
        id: returnId,
        caseId,
        sourceKind: "manual",
        sourceSha256: "a".repeat(64),
        externalReference: "NAR1-2026-001",
        manifestHash: null,
        outcome: "partial",
        matchState: "candidate",
        candidateHandoffIds: [submissionId],
        handoffId: submissionId,
        revision: 1,
        receivedAt: "2026-09-27T08:00:00Z",
        reconciledAt: null,
        open: true,
        duplicate: false,
      },
    ]);
    renderPanel();
    await screen.findByText(/部分接納/);
    expect(await screen.findByText(/待核對/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("核對原因：NAR1-2026-001"), {
      target: { value: "Matched reference to the external portal receipt" },
    });
    fireEvent.click(screen.getByRole("button", { name: "確認對應" }));
    await waitFor(() =>
      expect(server.reconcileAnnualReturnReturn).toHaveBeenCalledWith({
        data: {
          returnId,
          submissionId,
          expectedRevision: 1,
          decision: "confirm",
          reason: "Matched reference to the external portal receipt",
        },
      }),
    );
  });
});
