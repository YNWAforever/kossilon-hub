import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  createDocumentUploadIntent,
  finalizeDocumentUpload,
  previewDocumentRecovery,
} from "./server-fns";

export function DocumentRecoveryPanel({
  documentId,
  onRecovered,
}: {
  documentId: string;
  onRecovered: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [intentId, setIntentId] = useState<string | null>(null);
  const preview = useMutation({
    mutationFn: () => previewDocumentRecovery({ data: { documentId } }),
    retry: false,
  });
  const upload = useMutation({
    retry: false,
    mutationFn: async () => {
      const source = preview.data;
      if (!source || !file || !reason.trim()) throw new Error("Preview, file and reason required.");
      if (file.size <= 0 || file.size > 10 * 1024 * 1024)
        throw new Error("File size is outside the allowed range.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const checksum = Array.from(new Uint8Array(digest), (value) =>
        value.toString(16).padStart(2, "0"),
      ).join("");
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 8192)
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      const intent = await createDocumentUploadIntent({
        data: {
          companyId: source.companyId,
          caseId: source.caseId ?? undefined,
          category: source.category,
          fileName: file.name,
          contentType: file.type,
          sizeBytes: file.size,
          checksum,
          recovery: {
            documentId: source.documentId,
            expectedToken: source.versionToken,
            reason: reason.trim(),
          },
        },
      });
      setIntentId(intent.id);
      if (intent.status !== "created")
        throw new Error("Recovery already received; reconcile before further upload.");
      return finalizeDocumentUpload({ data: { intentId: intent.id, bodyBase64: btoa(binary) } });
    },
    onSuccess: onRecovered,
  });
  if (upload.isSuccess)
    return (
      <p role="status" className="text-sm">
        已收取補傳檔案，等待掃描及覆核。
      </p>
    );
  if (upload.isError)
    return (
      <p role="alert" className="text-sm text-status-orange">
        補傳結果未確認。請先核對文件庫及上載記錄，避免重複補傳。
        {intentId ? ` 上載 ID：${intentId}` : ""}
      </p>
    );
  return (
    <div className="space-y-2 text-sm">
      {!preview.data ? (
        <button
          type="button"
          className="rounded-md border px-3 py-2"
          disabled={preview.isPending}
          onClick={() => preview.mutate()}
        >
          預覽受控補傳
        </button>
      ) : null}
      {preview.isError ? <p role="alert">無法取得已授權預覽，請重新核對權限及來源。</p> : null}
      {preview.data && preview.data.availability !== "available" ? (
        <div className="space-y-2 rounded-md border p-3">
          <p>保留舊登記；新檔案須重新掃描及覆核。</p>
          <p className="text-xs text-muted-foreground">
            來源：{preview.data.fileName} · 版本：{preview.data.currentVersionId ?? "未有版本來源"}
          </p>
          <label className="block">
            補傳檔案
            <input
              aria-label="補傳檔案"
              type="file"
              accept=".pdf,.png,.jpg,.jpeg"
              disabled={attempted}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="mt-1 block w-full"
            />
          </label>
          <label className="block">
            核對原因
            <textarea
              aria-label="核對原因"
              maxLength={500}
              value={reason}
              disabled={attempted}
              onChange={(event) => setReason(event.target.value)}
              className="mt-1 w-full rounded-md border bg-background p-2"
            />
          </label>
          <button
            type="button"
            className="rounded-md border px-3 py-2 disabled:opacity-50"
            disabled={!file || !reason.trim() || attempted}
            onClick={() => {
              setAttempted(true);
              upload.mutate();
            }}
          >
            批准並補傳
          </button>
        </div>
      ) : null}
      {preview.data?.availability === "available" ? (
        <p>
          {preview.data.objectAvailability === "present"
            ? "物件存在；請按正常覆核流程處理。"
            : "物件是否存在尚未核實，請儲存管理人先核對。"}
        </p>
      ) : null}
    </div>
  );
}
