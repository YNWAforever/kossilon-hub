// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentRecoveryPanel } from "./document-recovery-panel";
const rpc = vi.hoisted(() => ({
  previewDocumentRecovery: vi.fn(),
  createDocumentUploadIntent: vi.fn(),
  finalizeDocumentUpload: vi.fn(),
}));
vi.mock("./server-fns", () => rpc);
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function setup() {
  rpc.previewDocumentRecovery.mockResolvedValue({
    documentId: "old",
    companyId: "company",
    caseId: "case",
    category: "identity",
    fileName: "legacy.pdf",
    versionToken: "a".repeat(32),
    availability: "metadata_only",
    action: "additive_reupload",
  });
  rpc.createDocumentUploadIntent.mockResolvedValue({ id: "new-intent", status: "created" });
  rpc.finalizeDocumentUpload.mockResolvedValue({ id: "new-document" });
  const onRecovered = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DocumentRecoveryPanel documentId="old" onRecovered={onRecovered} />
    </QueryClientProvider>,
  );
  return onRecovered;
}
async function chooseFile() {
  const file = new File([new Uint8Array([1, 2, 3, 4])], "recovery.pdf", {
    type: "application/pdf",
  });
  Object.defineProperty(file, "arrayBuffer", {
    value: async () => new Uint8Array([1, 2, 3, 4]).buffer,
  });
  fireEvent.change(screen.getByLabelText("補傳檔案"), { target: { files: [file] } });
  fireEvent.change(screen.getByLabelText("核對原因"), {
    target: { value: "Confirmed source gap" },
  });
}
describe("controlled document recovery", () => {
  it("offers approved additive upload when a controlled inspection confirms missing object", async () => {
    setup();
    rpc.previewDocumentRecovery.mockResolvedValueOnce({
      documentId: "old",
      companyId: "company",
      caseId: "case",
      category: "identity",
      fileName: "legacy.pdf",
      versionToken: "a".repeat(32),
      availability: "missing_object",
      objectAvailability: "missing",
      action: "additive_reupload",
    });
    fireEvent.click(screen.getByRole("button", { name: "預覽受控補傳" }));
    await screen.findByText("保留舊登記；新檔案須重新掃描及覆核。");
    expect(screen.getByRole("button", { name: "批准並補傳" })).toBeTruthy();
    expect(rpc.createDocumentUploadIntent).not.toHaveBeenCalled();
  });
  it("offers a missing-object recovery and explains unknown inspection without asserting no recovery is needed", async () => {
    setup();
    rpc.previewDocumentRecovery.mockResolvedValueOnce({
      documentId: "old",
      companyId: "company",
      caseId: "case",
      category: "identity",
      fileName: "legacy.pdf",
      versionToken: "a".repeat(32),
      availability: "available",
      objectAvailability: "unknown",
      action: "additive_reupload",
    });
    fireEvent.click(screen.getByRole("button", { name: "預覽受控補傳" }));
    await screen.findByText("物件是否存在尚未核實，請儲存管理人先核對。");
    expect(screen.queryByText("來源及掃描鏈完整；無需補傳。")).toBeNull();
    expect(screen.queryByRole("button", { name: "批准並補傳" })).toBeNull();
  });
  it("previews before explicit approval and uses the existing upload and finalise services once", async () => {
    const onRecovered = setup();
    fireEvent.click(screen.getByRole("button", { name: "預覽受控補傳" }));
    await screen.findByText("保留舊登記；新檔案須重新掃描及覆核。");
    expect(rpc.createDocumentUploadIntent).not.toHaveBeenCalled();
    await chooseFile();
    fireEvent.click(screen.getByRole("button", { name: "批准並補傳" }));
    await screen.findByText("已收取補傳檔案，等待掃描及覆核。");
    expect(rpc.createDocumentUploadIntent).toHaveBeenCalledTimes(1);
    expect(rpc.createDocumentUploadIntent).toHaveBeenCalledWith({
      data: expect.objectContaining({
        recovery: {
          documentId: "old",
          expectedToken: "a".repeat(32),
          reason: "Confirmed source gap",
        },
      }),
    });
    expect(rpc.finalizeDocumentUpload).toHaveBeenCalledWith({
      data: { intentId: "new-intent", bodyBase64: "AQIDBA==" },
    });
    expect(onRecovered).toHaveBeenCalledTimes(1);
  });
  it("retains the intent and refuses automatic retry after an unknown finalise outcome", async () => {
    setup();
    rpc.finalizeDocumentUpload.mockRejectedValue(new Error("private SQL error"));
    fireEvent.click(screen.getByRole("button", { name: "預覽受控補傳" }));
    await screen.findByText("保留舊登記；新檔案須重新掃描及覆核。");
    await chooseFile();
    fireEvent.click(screen.getByRole("button", { name: "批准並補傳" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("new-intent"));
    expect(screen.getByRole("alert").textContent).toContain("請先核對");
    expect(screen.queryByRole("button", { name: "批准並補傳" })).toBeNull();
    expect(rpc.finalizeDocumentUpload).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("private SQL error")).toBeNull();
  });
});
