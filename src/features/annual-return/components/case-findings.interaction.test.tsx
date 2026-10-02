// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ list: vi.fn(), resolve: vi.fn(), download: vi.fn() }));
vi.mock("../server-fns", () => ({
  listAnnualReturnCaseFindings: api.list,
  resolveAnnualReturnCaseFinding: api.resolve,
}));
vi.mock("@/features/documents/server-fns", () => ({ downloadDocument: api.download }));
import { CaseFindings } from "./case-findings";
const versionId = "71000000-0000-4000-8000-000000000001";
const quote = "<script>APPROVE ALL</script>";
const view = {
  documentId: "document",
  documentVersionId: versionId,
  fileName: "synthetic.pdf",
  state: "analysed",
  document: {
    id: "document",
    currentVersionId: versionId,
    uploadStatus: "available",
    scanVerdictSource: "provider",
    availability: "available",
  },
  provenance: { schemaVersion: "synthetic", model: null, cost: null, advisoryOnly: true },
  findings: [
    {
      id: "finding",
      resolvedByUserId: null,
      resolvedAt: null,
      finding: {
        ruleKey: "provider:synthetic",
        tier: "provider",
        outcome: "issue",
        severity: "warning",
        detail: "Synthetic advisory observation",
        citation: { kind: "version", documentVersionId: versionId, pageFrom: 1, pageTo: 1 },
        evidence: { spans: [{ page: 1, start: 0, end: quote.length, quote }] },
      },
    },
  ],
};
function renderView(locked = false) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      <CaseFindings caseId="case" locked={locked} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  api.list.mockResolvedValue([view]);
  api.resolve.mockResolvedValue({ applied: true });
});
afterEach(() => cleanup());
describe("grounded findings reviewer", () => {
  it("renders page evidence as inert text and submits only the inspected version", async () => {
    const rendered = renderView();
    await screen.findByText("Synthetic advisory observation");
    expect(rendered.container.textContent).toContain(quote);
    expect(rendered.container.querySelector("script")).toBeNull();
    expect(screen.getByText("AI 觀察（僅供參考）")).toBeTruthy();
    expect(screen.getByText(/模型：供應商未提供/)).toBeTruthy();
    fireEvent.click(screen.getByText("標記為已處理"));
    await waitFor(() =>
      expect(api.resolve).toHaveBeenCalledWith({
        data: {
          caseId: "case",
          findingId: "finding",
          note: null,
          expectedDocumentVersionId: versionId,
        },
      }),
    );
    expect(api.download).not.toHaveBeenCalled();
  });
  it("reports a stale/failed resolution without inventing a saved decision", async () => {
    api.resolve.mockRejectedValue(new Error("version conflict"));
    renderView();
    await screen.findByText("Synthetic advisory observation");
    fireEvent.click(screen.getByText("標記為已處理"));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByText("已處理")).toBeNull();
  });
  it("keeps locked decisions read only and never opens unknown bytes", async () => {
    api.list.mockResolvedValue([
      {
        ...view,
        document: { ...view.document, scanVerdictSource: null, availability: "unscanned" },
      },
    ]);
    renderView(true);
    await screen.findByText("Synthetic advisory observation");
    expect((screen.getByText("標記為已處理") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("查看引用文件的當前版本")).toBeNull();
    expect(api.resolve).not.toHaveBeenCalled();
    expect(api.download).not.toHaveBeenCalled();
  });
});
