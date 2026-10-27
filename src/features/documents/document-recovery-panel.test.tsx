// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentRecoveryPanel } from "./document-recovery-panel";
const rpc = vi.hoisted(() => ({
  previewDocumentRecovery: vi.fn(),
  createDocumentUploadIntent: vi.fn(),
  finalizeDocumentUpload: vi.fn(),
  readDocumentUploadReceipt: vi.fn(),
  readOpenDocumentRecovery: vi.fn(),
}));
vi.mock("./server-fns", () => rpc);
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function setup(
  lookup: { state: string; intentId?: string; receiptState?: string } = { state: "absent" },
) {
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
  rpc.readOpenDocumentRecovery.mockResolvedValue(lookup);
  const onRecovered = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DocumentRecoveryPanel documentId="old" onRecovered={onRecovered} />
    </QueryClientProvider>,
  );
  return onRecovered;
}
function recoveryFile() {
  const file = new File([new Uint8Array([1, 2, 3, 4])], "recovery.pdf", {
    type: "application/pdf",
  });
  Object.defineProperty(file, "arrayBuffer", {
    configurable: true,
    value: async () => new Uint8Array([1, 2, 3, 4]).buffer,
  });
  return file;
}
async function chooseFile() {
  fireEvent.change(screen.getByLabelText("補傳檔案"), { target: { files: [recoveryFile()] } });
  fireEvent.change(screen.getByLabelText("核對原因"), {
    target: { value: "Confirmed source gap" },
  });
}
async function chooseResumeFile(file = recoveryFile()) {
  fireEvent.change(screen.getByLabelText("原補傳檔案"), { target: { files: [file] } });
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
  it("allows retry after local file preparation fails without issuing writes", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "預覽受控補傳" }));
    await screen.findByText("保留舊登記；新檔案須重新掃描及覆核。");
    await chooseFile();
    const input = screen.getByLabelText("補傳檔案") as HTMLInputElement;
    Object.defineProperty(input.files![0], "arrayBuffer", {
      configurable: true,
      value: vi.fn().mockRejectedValue(new Error("local read failed")),
    });
    fireEvent.click(screen.getByRole("button", { name: "批准並補傳" }));
    await screen.findByText("無法準備檔案，尚未提交上載。請重新選擇檔案後重試。");
    expect(rpc.createDocumentUploadIntent).not.toHaveBeenCalled();
    expect(rpc.finalizeDocumentUpload).not.toHaveBeenCalled();
    await chooseFile();
    fireEvent.click(screen.getByRole("button", { name: "批准並補傳" }));
    await screen.findByText("已收取補傳檔案，等待掃描及覆核。");
    expect(rpc.createDocumentUploadIntent).toHaveBeenCalledTimes(1);
  });
  it("admits only one same-turn submission", async () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "預覽受控補傳" }));
    await screen.findByText("保留舊登記；新檔案須重新掃描及覆核。");
    await chooseFile();
    const submit = screen.getByRole("button", { name: "批准並補傳" });
    act(() => {
      submit.click();
      submit.click();
    });
    await screen.findByText("已收取補傳檔案，等待掃描及覆核。");
    expect(rpc.createDocumentUploadIntent).toHaveBeenCalledTimes(1);
    expect(rpc.finalizeDocumentUpload).toHaveBeenCalledTimes(1);
  });
  it("looks up a lost create before offering another explicit approve", async () => {
    setup();
    rpc.createDocumentUploadIntent.mockRejectedValue(new Error("lost response"));
    fireEvent.click(screen.getByRole("button", { name: "預覽受控補傳" }));
    await screen.findByText("保留舊登記；新檔案須重新掃描及覆核。");
    await chooseFile();
    fireEvent.click(screen.getByRole("button", { name: "批准並補傳" }));
    await screen.findByText("先前的補傳沒有登記。可重新批准。");
    expect(screen.getByRole("button", { name: "批准並補傳" })).toBeTruthy();
    expect(rpc.createDocumentUploadIntent).toHaveBeenCalledTimes(1);
    expect(rpc.finalizeDocumentUpload).not.toHaveBeenCalled();
    expect(rpc.readDocumentUploadReceipt).not.toHaveBeenCalled();
    expect(rpc.readOpenDocumentRecovery).toHaveBeenCalledWith({
      data: expect.objectContaining({ documentId: "old", fileName: "recovery.pdf" }),
    });
    expect(JSON.stringify(rpc.readOpenDocumentRecovery.mock.calls)).not.toContain(
      "uploadRequestId",
    );
  });
  it("reads an open recovery after a lost create and does not create again", async () => {
    setup();
    rpc.readOpenDocumentRecovery.mockResolvedValueOnce({ state: "absent" }).mockResolvedValueOnce({
      state: "open",
      intentId: "recovered-intent",
      receiptState: "unconfirmed",
    });
    rpc.createDocumentUploadIntent.mockRejectedValue(new Error("lost response"));
    rpc.readDocumentUploadReceipt.mockResolvedValue({
      intentId: "recovered-intent",
      state: "unconfirmed",
    });
    fireEvent.click(screen.getByRole("button", { name: "預覽受控補傳" }));
    await screen.findByText("保留舊登記；新檔案須重新掃描及覆核。");
    await chooseFile();
    fireEvent.click(screen.getByRole("button", { name: "批准並補傳" }));
    await screen.findByText(/recovered-intent/);
    expect(screen.queryByRole("button", { name: "批准並補傳" })).toBeNull();
    expect(rpc.createDocumentUploadIntent).toHaveBeenCalledTimes(1);
    expect(rpc.finalizeDocumentUpload).not.toHaveBeenCalled();
    expect(rpc.readDocumentUploadReceipt).toHaveBeenCalledWith({
      data: { intentId: "recovered-intent" },
    });
  });
  it("loads an open recovery on mount before offering a create", async () => {
    setup({ state: "open", intentId: "existing-intent", receiptState: "unconfirmed" });
    await screen.findByText(/existing-intent/);
    expect(screen.queryByRole("button", { name: "批准並補傳" })).toBeNull();
    expect(screen.queryByRole("button", { name: "預覽受控補傳" })).toBeNull();
    expect(rpc.createDocumentUploadIntent).not.toHaveBeenCalled();
    expect(rpc.finalizeDocumentUpload).not.toHaveBeenCalled();
    expect(rpc.readOpenDocumentRecovery).toHaveBeenCalledWith({ data: { documentId: "old" } });
    expect(rpc.readDocumentUploadReceipt).toHaveBeenCalledWith({
      data: { intentId: "existing-intent" },
    });
  });
  it("hides another actor's recovery without an intent id", async () => {
    setup({ state: "blocked" });
    await screen.findByText("已有其他補傳進行中，未能顯示該記錄。請勿再批准新的補傳。");
    expect(screen.queryByRole("button", { name: "批准並補傳" })).toBeNull();
    expect(screen.queryByText(/上載 ID/)).toBeNull();
    expect(rpc.createDocumentUploadIntent).not.toHaveBeenCalled();
  });
  it("checks a saved upload receipt without replaying either write", async () => {
    const onRecovered = setup();
    rpc.finalizeDocumentUpload.mockRejectedValue(new Error("lost response"));
    rpc.readDocumentUploadReceipt.mockResolvedValue({
      intentId: "new-intent",
      state: "received",
      documentId: "new-document",
    });
    fireEvent.click(screen.getByRole("button", { name: "預覽受控補傳" }));
    await screen.findByText("保留舊登記；新檔案須重新掃描及覆核。");
    await chooseFile();
    fireEvent.click(screen.getByRole("button", { name: "批准並補傳" }));
    fireEvent.click(await screen.findByRole("button", { name: "核對補傳結果" }));
    await screen.findByText("已核實補傳登記。請在文件庫查看目前掃描及覆核狀態。");
    expect(rpc.readDocumentUploadReceipt.mock.calls[0][0]).toEqual({
      data: { intentId: "new-intent" },
    });
    expect(onRecovered).toHaveBeenCalledTimes(1);
    expect(rpc.createDocumentUploadIntent).toHaveBeenCalledTimes(1);
    expect(rpc.finalizeDocumentUpload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "批准並補傳" })).toBeNull();
  });
  it.each([
    null,
    { intentId: "other", state: "received", documentId: "new-document" },
    { intentId: "new-intent", state: "unconfirmed" },
    { intentId: "new-intent", state: "received" },
  ])("keeps unconfirmed or mismatched receipt closed: %j", async (receipt) => {
    const onRecovered = setup();
    rpc.finalizeDocumentUpload.mockRejectedValue(new Error("lost response"));
    rpc.readDocumentUploadReceipt.mockResolvedValue(receipt);
    fireEvent.click(screen.getByRole("button", { name: "預覽受控補傳" }));
    await screen.findByText("保留舊登記；新檔案須重新掃描及覆核。");
    await chooseFile();
    fireEvent.click(screen.getByRole("button", { name: "批准並補傳" }));
    fireEvent.click(await screen.findByRole("button", { name: "核對補傳結果" }));
    await screen.findByText("尚未核實補傳登記。請勿重複補傳；可稍後再次核對。");
    expect(onRecovered).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "批准並補傳" })).toBeNull();
    expect(rpc.finalizeDocumentUpload).toHaveBeenCalledTimes(1);
  });
  it("deduplicates receipt reads and allows a read retry after denial", async () => {
    const onRecovered = setup();
    rpc.finalizeDocumentUpload.mockRejectedValue(new Error("lost response"));
    let rejectRead!: (error: Error) => void;
    rpc.readDocumentUploadReceipt.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectRead = reject;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "預覽受控補傳" }));
    await screen.findByText("保留舊登記；新檔案須重新掃描及覆核。");
    await chooseFile();
    fireEvent.click(screen.getByRole("button", { name: "批准並補傳" }));
    const check = await screen.findByRole("button", { name: "核對補傳結果" });
    act(() => {
      check.click();
      check.click();
    });
    await waitFor(() => expect(rpc.readDocumentUploadReceipt).toHaveBeenCalledTimes(1));
    expect((check as HTMLButtonElement).disabled).toBe(true);
    await act(async () => rejectRead(new Error("private read error")));
    await screen.findByText("尚未核實補傳登記。請勿重複補傳；可稍後再次核對。");
    expect(screen.queryByText("private read error")).toBeNull();
    rpc.readDocumentUploadReceipt.mockResolvedValue({
      intentId: "new-intent",
      state: "received",
      documentId: "new-document",
    });
    fireEvent.click(check);
    await screen.findByText("已核實補傳登記。請在文件庫查看目前掃描及覆核狀態。");
    expect(onRecovered).toHaveBeenCalledTimes(1);
    expect(rpc.finalizeDocumentUpload).toHaveBeenCalledTimes(1);
  });
  it("discards a receipt arriving after the panel unmounts", async () => {
    const onRecovered = setup();
    rpc.finalizeDocumentUpload.mockRejectedValue(new Error("lost response"));
    let resolveRead!: (value: unknown) => void;
    rpc.readDocumentUploadReceipt.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
    );
    fireEvent.click(screen.getByRole("button", { name: "預覽受控補傳" }));
    await screen.findByText("保留舊登記；新檔案須重新掃描及覆核。");
    await chooseFile();
    fireEvent.click(screen.getByRole("button", { name: "批准並補傳" }));
    fireEvent.click(await screen.findByRole("button", { name: "核對補傳結果" }));
    await waitFor(() => expect(rpc.readDocumentUploadReceipt).toHaveBeenCalledTimes(1));
    cleanup();
    await act(async () =>
      resolveRead({ intentId: "new-intent", state: "received", documentId: "new-document" }),
    );
    expect(onRecovered).not.toHaveBeenCalled();
    expect(rpc.finalizeDocumentUpload).toHaveBeenCalledTimes(1);
  });
  it("staff recovery resume: finalizes only after the original file is re-selected", async () => {
    const onRecovered = setup({
      state: "open",
      intentId: "existing-intent",
      receiptState: "unconfirmed",
    });
    const resume = await screen.findByRole("button", { name: "以所選檔案完成補傳" });
    expect((resume as HTMLButtonElement).disabled).toBe(true);
    expect(rpc.finalizeDocumentUpload).not.toHaveBeenCalled();
    expect(rpc.createDocumentUploadIntent).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "批准並補傳" })).toBeNull();
    await chooseResumeFile();
    fireEvent.click(screen.getByRole("button", { name: "以所選檔案完成補傳" }));
    await screen.findByText("已收取補傳檔案，等待掃描及覆核。");
    expect(rpc.finalizeDocumentUpload).toHaveBeenCalledTimes(1);
    expect(rpc.finalizeDocumentUpload).toHaveBeenCalledWith({
      data: { intentId: "existing-intent", bodyBase64: "AQIDBA==" },
    });
    expect(rpc.createDocumentUploadIntent).not.toHaveBeenCalled();
    expect(onRecovered).toHaveBeenCalledTimes(1);
    const lookups = JSON.stringify(rpc.readOpenDocumentRecovery.mock.calls);
    expect(lookups).toContain("recovery.pdf");
    expect(lookups).not.toContain("uploadRequestId");
  });
  it("staff recovery resume: does not finalize when the re-selected file is blocked", async () => {
    setup({ state: "open", intentId: "existing-intent", receiptState: "unconfirmed" });
    await screen.findByRole("button", { name: "以所選檔案完成補傳" });
    rpc.readOpenDocumentRecovery.mockResolvedValue({ state: "blocked" });
    await chooseResumeFile();
    fireEvent.click(screen.getByRole("button", { name: "以所選檔案完成補傳" }));
    const blocked = await screen.findByRole("alert");
    expect(blocked.textContent).toBe("所選檔案未能繼續這次補傳。請勿再批准新的補傳。");
    expect(blocked.textContent).not.toMatch(/[0-9a-f]{64}/);
    expect(screen.getByText(/existing-intent/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "批准並補傳" })).toBeNull();
    expect(rpc.finalizeDocumentUpload).not.toHaveBeenCalled();
    expect(rpc.createDocumentUploadIntent).not.toHaveBeenCalled();
    expect(JSON.stringify(rpc.readOpenDocumentRecovery.mock.calls)).not.toContain(
      "uploadRequestId",
    );
  });
  it("staff recovery resume: does not retry finalize after an uncertain response", async () => {
    setup({ state: "open", intentId: "existing-intent", receiptState: "unconfirmed" });
    rpc.finalizeDocumentUpload.mockRejectedValue(new Error("lost response"));
    rpc.readDocumentUploadReceipt.mockResolvedValue({
      intentId: "existing-intent",
      state: "unconfirmed",
    });
    await screen.findByRole("button", { name: "以所選檔案完成補傳" });
    await chooseResumeFile();
    fireEvent.click(screen.getByRole("button", { name: "以所選檔案完成補傳" }));
    await screen.findByText(/補傳結果未確認/);
    expect(screen.queryByRole("button", { name: "以所選檔案完成補傳" })).toBeNull();
    expect(screen.queryByText("lost response")).toBeNull();
    expect(rpc.finalizeDocumentUpload).toHaveBeenCalledTimes(1);
    expect(rpc.createDocumentUploadIntent).not.toHaveBeenCalled();
    rpc.readDocumentUploadReceipt.mockResolvedValue({
      intentId: "existing-intent",
      state: "received",
      documentId: "new-document",
    });
    fireEvent.click(screen.getByRole("button", { name: "核對補傳結果" }));
    await screen.findByText("已核實補傳登記。請在文件庫查看目前掃描及覆核狀態。");
    expect(rpc.finalizeDocumentUpload).toHaveBeenCalledTimes(1);
  });
  it("staff recovery resume: allows another explicit attempt after local preparation fails", async () => {
    setup({ state: "open", intentId: "existing-intent", receiptState: "unconfirmed" });
    await screen.findByRole("button", { name: "以所選檔案完成補傳" });
    const file = recoveryFile();
    Object.defineProperty(file, "arrayBuffer", {
      configurable: true,
      value: vi.fn().mockRejectedValue(new Error("local read failed")),
    });
    await chooseResumeFile(file);
    fireEvent.click(screen.getByRole("button", { name: "以所選檔案完成補傳" }));
    await screen.findByText("無法準備檔案，尚未提交上載。請重新選擇檔案後重試。");
    expect(rpc.finalizeDocumentUpload).not.toHaveBeenCalled();
    expect(rpc.createDocumentUploadIntent).not.toHaveBeenCalled();
    await chooseResumeFile();
    fireEvent.click(screen.getByRole("button", { name: "以所選檔案完成補傳" }));
    await screen.findByText("已收取補傳檔案，等待掃描及覆核。");
    expect(rpc.finalizeDocumentUpload).toHaveBeenCalledTimes(1);
    expect(rpc.createDocumentUploadIntent).not.toHaveBeenCalled();
  });
  it("staff recovery resume: admits only one finalize from the same turn", async () => {
    setup({ state: "open", intentId: "existing-intent", receiptState: "unconfirmed" });
    await screen.findByRole("button", { name: "以所選檔案完成補傳" });
    await chooseResumeFile();
    const resume = screen.getByRole("button", { name: "以所選檔案完成補傳" });
    act(() => {
      resume.click();
      resume.click();
    });
    await screen.findByText("已收取補傳檔案，等待掃描及覆核。");
    expect(rpc.finalizeDocumentUpload).toHaveBeenCalledTimes(1);
    expect(rpc.createDocumentUploadIntent).not.toHaveBeenCalled();
  });
  it("staff recovery resume: does not offer finalize when the receipt is already received", async () => {
    rpc.readDocumentUploadReceipt.mockResolvedValue({
      intentId: "existing-intent",
      state: "received",
      documentId: "new-document",
    });
    const onRecovered = setup({
      state: "open",
      intentId: "existing-intent",
      receiptState: "received",
    });
    await screen.findByText("已核實補傳登記。請在文件庫查看目前掃描及覆核狀態。");
    expect(screen.queryByRole("button", { name: "以所選檔案完成補傳" })).toBeNull();
    expect(screen.queryByLabelText("原補傳檔案")).toBeNull();
    expect(rpc.finalizeDocumentUpload).not.toHaveBeenCalled();
    expect(rpc.createDocumentUploadIntent).not.toHaveBeenCalled();
    expect(onRecovered).toHaveBeenCalledTimes(1);
  });
  it("staff recovery resume: does not finalize when a fresh lookup says the recovery is gone", async () => {
    const onRecovered = setup({
      state: "open",
      intentId: "existing-intent",
      receiptState: "unconfirmed",
    });
    await screen.findByRole("button", { name: "以所選檔案完成補傳" });
    rpc.readOpenDocumentRecovery.mockResolvedValueOnce({ state: "absent" });
    await chooseResumeFile();
    fireEvent.click(screen.getByRole("button", { name: "以所選檔案完成補傳" }));
    await screen.findByRole("button", { name: "預覽受控補傳" });
    expect(rpc.finalizeDocumentUpload).not.toHaveBeenCalled();
    expect(rpc.createDocumentUploadIntent).not.toHaveBeenCalled();
    expect(onRecovered).not.toHaveBeenCalled();
  });
  it("staff recovery resume: treats a fresh received lookup as a receipt and does not finalize", async () => {
    const onRecovered = setup({
      state: "open",
      intentId: "existing-intent",
      receiptState: "unconfirmed",
    });
    await screen.findByRole("button", { name: "以所選檔案完成補傳" });
    rpc.readOpenDocumentRecovery.mockResolvedValueOnce({
      state: "open",
      intentId: "existing-intent",
      receiptState: "received",
      documentId: "new-document",
    });
    await chooseResumeFile();
    fireEvent.click(screen.getByRole("button", { name: "以所選檔案完成補傳" }));
    await screen.findByText("已核實補傳登記。請在文件庫查看目前掃描及覆核狀態。");
    expect(rpc.finalizeDocumentUpload).not.toHaveBeenCalled();
    expect(rpc.createDocumentUploadIntent).not.toHaveBeenCalled();
    expect(onRecovered).toHaveBeenCalledTimes(1);
  });
  it("staff recovery resume: keeps a failed file check closed without revealing the error", async () => {
    setup({ state: "open", intentId: "existing-intent", receiptState: "unconfirmed" });
    await screen.findByRole("button", { name: "以所選檔案完成補傳" });
    rpc.readOpenDocumentRecovery.mockRejectedValueOnce(new Error("private SQL error"));
    await chooseResumeFile();
    fireEvent.click(screen.getByRole("button", { name: "以所選檔案完成補傳" }));
    await screen.findByText("未能核對所選檔案。請先重試核對，不要批准新的補傳。");
    expect(screen.queryByText("private SQL error")).toBeNull();
    expect(screen.getByText(/existing-intent/)).toBeTruthy();
    expect(rpc.finalizeDocumentUpload).not.toHaveBeenCalled();
    expect(rpc.createDocumentUploadIntent).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "以所選檔案完成補傳" })).toBeTruthy();
  });
  it("staff recovery resume: discards a late finalize after the panel unmounts", async () => {
    const onRecovered = setup({
      state: "open",
      intentId: "existing-intent",
      receiptState: "unconfirmed",
    });
    let resolveFinalize!: (value: unknown) => void;
    rpc.finalizeDocumentUpload.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFinalize = resolve;
        }),
    );
    await screen.findByRole("button", { name: "以所選檔案完成補傳" });
    await chooseResumeFile();
    fireEvent.click(screen.getByRole("button", { name: "以所選檔案完成補傳" }));
    await waitFor(() => expect(rpc.finalizeDocumentUpload).toHaveBeenCalledTimes(1));
    cleanup();
    await act(async () => resolveFinalize({ id: "new-document" }));
    expect(onRecovered).not.toHaveBeenCalled();
    expect(rpc.createDocumentUploadIntent).not.toHaveBeenCalled();
  });
});
