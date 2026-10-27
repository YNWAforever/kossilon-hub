// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const download = vi.hoisted(() => vi.fn());
vi.mock("./server-fns", () => ({ downloadDocument: download }));
import { SafeDocumentPreview } from "./safe-preview";
const document = {
  id: "document-a",
  currentVersionId: "version-a",
  uploadStatus: "available" as const,
  scanVerdictSource: "provider" as const,
};
const createUrl = vi.fn(),
  revokeUrl = vi.fn();
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("URL", { createObjectURL: createUrl, revokeObjectURL: revokeUrl });
  createUrl.mockReturnValue("blob:old-proof");
  download.mockImplementation(
    async () => new Response("pdf", { headers: { "content-type": "application/pdf" } }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it.each(["version", "document", "safety"])(
  "clears displayed bytes and revokes their URL on %s change",
  async (change) => {
    const view = render(<SafeDocumentPreview document={document} />);
    fireEvent.click(screen.getByRole("button", { name: "預覽當前付款憑證" }));
    expect((await screen.findByTitle("付款憑證預覽")).getAttribute("src")).toBe("blob:old-proof");
    const changed =
      change === "version"
        ? { ...document, currentVersionId: "version-b" }
        : change === "document"
          ? { ...document, id: "document-b" }
          : { ...document, uploadStatus: "rejected" as const };
    view.rerender(<SafeDocumentPreview document={changed} />);
    expect(screen.queryByTitle("付款憑證預覽")).toBeNull();
    await waitFor(() => expect(revokeUrl).toHaveBeenCalledWith("blob:old-proof"));
    if (change !== "safety") {
      createUrl.mockReturnValue("blob:fresh-proof");
      fireEvent.click(screen.getByRole("button", { name: "預覽當前付款憑證" }));
      expect((await screen.findByTitle("付款憑證預覽")).getAttribute("src")).toBe(
        "blob:fresh-proof",
      );
      expect(download).toHaveBeenLastCalledWith({
        data: { documentId: changed.id, expectedVersionId: changed.currentVersionId },
      });
    } else expect(screen.queryByRole("button")).toBeNull();
  },
);

it("discards a late old-version result while a fresh preview remains available", async () => {
  let finishOld!: (value: Response) => void;
  download.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finishOld = resolve;
      }),
  );
  const view = render(<SafeDocumentPreview document={document} />);
  fireEvent.click(screen.getByRole("button", { name: "預覽當前付款憑證" }));
  view.rerender(<SafeDocumentPreview document={{ ...document, currentVersionId: "version-b" }} />);
  const button = screen.getByRole("button", { name: "預覽當前付款憑證" });
  expect((button as HTMLButtonElement).disabled).toBe(false);
  createUrl.mockReturnValue("blob:fresh-proof");
  fireEvent.click(button);
  await screen.findByTitle("付款憑證預覽");
  await act(async () => {
    finishOld(new Response("old", { headers: { "content-type": "application/pdf" } }));
  });
  expect(createUrl).toHaveBeenCalledTimes(1);
  expect(screen.getByTitle("付款憑證預覽").getAttribute("src")).toBe("blob:fresh-proof");
  expect(download).toHaveBeenLastCalledWith({
    data: { documentId: document.id, expectedVersionId: "version-b" },
  });
});

it("does not allocate a URL when download finishes after unmount", async () => {
  let finish!: (value: Response) => void;
  download.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<SafeDocumentPreview document={document} />);
  fireEvent.click(screen.getByRole("button", { name: "預覽當前付款憑證" }));
  view.unmount();
  await act(async () => {
    finish(new Response("pdf", { headers: { "content-type": "application/pdf" } }));
  });
  expect(createUrl).not.toHaveBeenCalled();
});

it("removes old bytes before a failed retry and allows a subsequent explicit retry", async () => {
  render(<SafeDocumentPreview document={document} />);
  fireEvent.click(screen.getByRole("button", { name: "預覽當前付款憑證" }));
  await screen.findByTitle("付款憑證預覽");
  download.mockRejectedValueOnce(new Error("version changed"));
  fireEvent.click(screen.getByRole("button", { name: "預覽當前付款憑證" }));
  await screen.findByRole("alert");
  expect(screen.queryByTitle("付款憑證預覽")).toBeNull();
  expect(revokeUrl).toHaveBeenCalledWith("blob:old-proof");
  expect(download).toHaveBeenCalledTimes(2);
  createUrl.mockReturnValue("blob:retry-proof");
  fireEvent.click(screen.getByRole("button", { name: "預覽當前付款憑證" }));
  expect((await screen.findByTitle("付款憑證預覽")).getAttribute("src")).toBe("blob:retry-proof");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(download).toHaveBeenCalledTimes(3);
});

it("discards bytes that finish reading after the preview is unmounted", async () => {
  let finishBlob!: (blob: Blob) => void;
  download.mockResolvedValueOnce({
    ok: true,
    blob: () =>
      new Promise<Blob>((resolve) => {
        finishBlob = resolve;
      }),
  });
  const view = render(<SafeDocumentPreview document={document} />);
  fireEvent.click(screen.getByRole("button", { name: "預覽當前付款憑證" }));
  await waitFor(() => expect(finishBlob).toBeTypeOf("function"));
  view.unmount();
  await act(async () => {
    finishBlob(new Blob(["pdf"], { type: "application/pdf" }));
  });
  expect(createUrl).not.toHaveBeenCalled();
});

it("admits only one pending download for same-turn preview clicks", async () => {
  let finish!: (value: Response) => void;
  download.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  render(<SafeDocumentPreview document={document} />);
  const button = screen.getByRole("button", { name: "預覽當前付款憑證" });
  act(() => {
    button.click();
    button.click();
  });
  expect(download).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish(new Response("pdf", { headers: { "content-type": "application/pdf" } }));
  });
  await screen.findByTitle("付款憑證預覽");
  expect(createUrl).toHaveBeenCalledTimes(1);
});
