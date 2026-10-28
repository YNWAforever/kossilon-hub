import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import {
  createDocumentUploadIntent,
  finalizeDocumentUpload,
  previewDocumentRecovery,
  readDocumentUploadReceipt,
  readOpenDocumentRecovery,
  type OpenDocumentRecoveryLookup,
} from "./server-fns";

export function DocumentRecoveryPanel({
  documentId,
  onRecovered,
}: {
  documentId: string;
  onRecovered: () => void;
}) {
  return (
    <DocumentRecoverySession key={documentId} documentId={documentId} onRecovered={onRecovered} />
  );
}

type LookupPhase =
  | { phase: "reading" }
  | { phase: "failed" }
  | { phase: "absent" }
  | { phase: "blocked" }
  | { phase: "open"; intentId: string };

async function fileFingerprint(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const checksum = Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return {
    bytes,
    binary,
    fileName: file.name,
    contentType: file.type,
    sizeBytes: file.size,
    checksum,
  };
}

function DocumentRecoverySession({
  documentId,
  onRecovered,
}: {
  documentId: string;
  onRecovered: () => void;
}) {
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const readingReceipt = useRef(false);
  const [checkingReceipt, setCheckingReceipt] = useState(false);
  const [receiptState, setReceiptState] = useState<"unconfirmed" | "received" | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [reason, setReason] = useState("");
  const [attempted, setAttempted] = useState(false);
  const admitted = useRef(false);
  const writeStarted = useRef(false);
  const intentIdRef = useRef<string | null>(null);
  const [preparationFailed, setPreparationFailed] = useState(false);
  const [intentId, setIntentId] = useState<string | null>(null);
  const [lookup, setLookup] = useState<LookupPhase>({ phase: "reading" });
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeAttempted, setResumeAttempted] = useState(false);
  const [resumeInputKey, setResumeInputKey] = useState(0);
  const resumeAdmitted = useRef(false);
  const resumeWriteStarted = useRef(false);
  const [resumeHold, setResumeHold] = useState<
    null | "prepare" | "lookup" | "mismatch" | "uncertain" | "done"
  >(null);

  function rememberIntent(id: string) {
    intentIdRef.current = id;
    setIntentId(id);
  }

  function applyLookup(result: OpenDocumentRecoveryLookup) {
    if (!active.current) return;
    if (result.state === "open") {
      rememberIntent(result.intentId);
      setLookup({ phase: "open", intentId: result.intentId });
      return;
    }
    if (result.state === "blocked") {
      setLookup({ phase: "blocked" });
      return;
    }
    setLookup({ phase: "absent" });
    intentIdRef.current = null;
    setIntentId(null);
    setReceiptState(null);
    admitted.current = false;
    writeStarted.current = false;
    setAttempted(false);
  }

  async function reconcile(fileFields?: {
    fileName: string;
    contentType: string;
    sizeBytes: number;
    checksum: string;
  }) {
    setLookup({ phase: "reading" });
    try {
      const result = await readOpenDocumentRecovery({
        data: { documentId, ...fileFields },
      });
      applyLookup(result);
      return result;
    } catch {
      if (active.current) setLookup({ phase: "failed" });
      return null;
    }
  }

  useEffect(() => {
    void reconcile();
    // Reload has the source document id and no selected file. The lookup is the
    // read that has to finish before another create is offered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

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
      const fingerprint = await fileFingerprint(file);
      const found = await readOpenDocumentRecovery({
        data: {
          documentId: source.documentId,
          fileName: fingerprint.fileName,
          contentType: fingerprint.contentType,
          sizeBytes: fingerprint.sizeBytes,
          checksum: fingerprint.checksum,
        },
      });
      if (found.state !== "absent") return { kind: "lookup" as const, found };
      // Once this boundary is crossed, a rejected response may hide a saved write.
      writeStarted.current = true;
      const intent = await createDocumentUploadIntent({
        data: {
          companyId: source.companyId,
          caseId: source.caseId ?? undefined,
          category: source.category,
          fileName: fingerprint.fileName,
          contentType: fingerprint.contentType,
          sizeBytes: fingerprint.sizeBytes,
          checksum: fingerprint.checksum,
          recovery: {
            documentId: source.documentId,
            expectedToken: source.versionToken,
            reason: reason.trim(),
          },
        },
      });
      rememberIntent(intent.id);
      if (intent.status !== "created")
        throw new Error("Recovery already received; reconcile before further upload.");
      await finalizeDocumentUpload({
        data: { intentId: intent.id, bodyBase64: btoa(fingerprint.binary) },
      });
      return { kind: "uploaded" as const };
    },
    onSuccess: (result) => {
      if (result.kind === "lookup") {
        applyLookup(result.found);
        admitted.current = false;
        setAttempted(false);
        return;
      }
      if (active.current) onRecovered();
    },
    onError: () => {
      if (!writeStarted.current) {
        admitted.current = false;
        setAttempted(false);
        setPreparationFailed(true);
        return;
      }
      if (intentIdRef.current) return;
      setLookup({ phase: "reading" });
      void (async () => {
        try {
          const fingerprint = file ? await fileFingerprint(file) : null;
          await reconcile(
            fingerprint
              ? {
                  fileName: fingerprint.fileName,
                  contentType: fingerprint.contentType,
                  sizeBytes: fingerprint.sizeBytes,
                  checksum: fingerprint.checksum,
                }
              : undefined,
          );
        } catch {
          if (active.current) setLookup({ phase: "failed" });
        }
      })();
    },
  });

  const resume = useMutation({
    retry: false,
    mutationFn: async (source: File) => {
      const currentIntentId = intentIdRef.current;
      if (!currentIntentId || source.size <= 0 || source.size > 10 * 1024 * 1024)
        return { kind: "prepare" as const };
      let fingerprint: Awaited<ReturnType<typeof fileFingerprint>>;
      try {
        fingerprint = await fileFingerprint(source);
      } catch {
        return { kind: "prepare" as const };
      }
      let found: OpenDocumentRecoveryLookup;
      try {
        found = await readOpenDocumentRecovery({
          data: {
            documentId,
            fileName: fingerprint.fileName,
            contentType: fingerprint.contentType,
            sizeBytes: fingerprint.sizeBytes,
            checksum: fingerprint.checksum,
          },
        });
      } catch {
        return { kind: "lookup" as const };
      }
      if (found.state === "blocked") return { kind: "mismatch" as const };
      if (
        found.state !== "open" ||
        found.intentId !== currentIntentId ||
        found.receiptState !== "unconfirmed"
      ) {
        return { kind: "refresh" as const, found };
      }
      resumeWriteStarted.current = true;
      await finalizeDocumentUpload({
        data: { intentId: found.intentId, bodyBase64: btoa(fingerprint.binary) },
      });
      return { kind: "finalized" as const };
    },
    onSuccess: (result) => {
      if (!active.current) return;
      if (result.kind === "prepare" || result.kind === "lookup" || result.kind === "mismatch") {
        resumeAdmitted.current = false;
        setResumeAttempted(false);
        if (result.kind === "mismatch") {
          setResumeFile(null);
          setResumeInputKey((key) => key + 1);
        }
        setResumeHold(result.kind);
        return;
      }
      if (result.kind === "refresh") {
        resumeAdmitted.current = false;
        setResumeAttempted(false);
        if (result.found.state === "open" && result.found.receiptState === "received") {
          setReceiptState("received");
          onRecovered();
          return;
        }
        applyLookup(result.found);
        return;
      }
      setResumeHold("done");
      onRecovered();
    },
    onError: () => {
      if (!active.current) return;
      if (!resumeWriteStarted.current) {
        resumeAdmitted.current = false;
        setResumeAttempted(false);
        setResumeHold("prepare");
        return;
      }
      setResumeHold("uncertain");
    },
  });

  const openIntentId = lookup.phase === "open" ? lookup.intentId : null;
  useEffect(() => {
    if (!openIntentId) return;
    void checkReceipt(openIntentId);
    // checkReceipt is stable enough for one intent id; a new id runs again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openIntentId]);

  async function checkReceipt(id = intentIdRef.current) {
    if (!id || readingReceipt.current) return;
    readingReceipt.current = true;
    setCheckingReceipt(true);
    setReceiptState(null);
    try {
      const receipt = await readDocumentUploadReceipt({ data: { intentId: id } });
      if (!active.current) return;
      if (receipt?.intentId !== id || receipt.state !== "received" || !receipt.documentId) {
        setReceiptState("unconfirmed");
        return;
      }
      setReceiptState("received");
      onRecovered();
    } catch {
      if (active.current) setReceiptState("unconfirmed");
    } finally {
      readingReceipt.current = false;
      if (active.current) setCheckingReceipt(false);
    }
  }

  if (resumeHold === "done")
    return (
      <p role="status" className="text-sm">
        已收取補傳檔案，等待掃描及覆核。
      </p>
    );
  if (receiptState === "received")
    return <p role="status">已核實補傳登記。請在文件庫查看目前掃描及覆核狀態。</p>;
  if (lookup.phase === "blocked")
    return (
      <p role="alert" className="text-sm text-status-orange-text">
        已有其他補傳進行中，未能顯示該記錄。請勿再批准新的補傳。
      </p>
    );
  if (lookup.phase === "failed")
    return (
      <div className="space-y-2 text-sm">
        <p role="alert">未能核對補傳記錄。請先重試核對，不要批准新的補傳。</p>
        <Button type="button" onClick={() => void reconcile()}>
          重新核對補傳
        </Button>
      </div>
    );
  if (lookup.phase === "open")
    return (
      <div className="space-y-2 text-sm">
        <p role="status">
          已有未完成補傳。請先核對結果，不要再批准新的補傳。
          {openIntentId ? ` 上載 ID：${openIntentId}` : ""}
        </p>
        {resumeHold === "uncertain" ? (
          <>
            <p role="alert" className="text-status-orange-text">
              補傳結果未確認。請先核對文件庫及上載記錄，避免重複補傳。
              {openIntentId ? ` 上載 ID：${openIntentId}` : ""}
            </p>
            <Button
              type="button"
              disabled={checkingReceipt}
              onClick={() => void checkReceipt(openIntentId)}
            >
              核對補傳結果
            </Button>
            {receiptState === "unconfirmed" ? (
              <p role="status">尚未核實補傳登記。請勿重複補傳；可稍後再次核對。</p>
            ) : null}
          </>
        ) : (
          <>
            <Button
              type="button"
              disabled={checkingReceipt}
              onClick={() => void checkReceipt(openIntentId)}
            >
              核對補傳結果
            </Button>
            {receiptState === "unconfirmed" ? (
              <>
                <p role="status">
                  尚未核實補傳登記。不要批准新的補傳。若仍持有原檔，可選擇該檔以完成這次補傳。
                </p>
                {resumeHold === "prepare" ? (
                  <p role="alert">無法準備檔案，尚未提交上載。請重新選擇檔案後重試。</p>
                ) : null}
                {resumeHold === "lookup" ? (
                  <p role="alert">未能核對所選檔案。請先重試核對，不要批准新的補傳。</p>
                ) : null}
                {resumeHold === "mismatch" ? (
                  <p role="alert">所選檔案未能繼續這次補傳。請勿再批准新的補傳。</p>
                ) : null}
                <label className="block">
                  原補傳檔案
                  <input
                    key={resumeInputKey}
                    aria-label="原補傳檔案"
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg"
                    disabled={resumeAttempted}
                    onChange={(event) => setResumeFile(event.target.files?.[0] ?? null)}
                    className="mt-1 block w-full"
                  />
                </label>
                <Button
                  type="button"
                  variant="primary"
                  disabled={!resumeFile || resumeAttempted || checkingReceipt}
                  onClick={() => {
                    if (
                      resumeAdmitted.current ||
                      resumeWriteStarted.current ||
                      !resumeFile ||
                      checkingReceipt
                    )
                      return;
                    resumeAdmitted.current = true;
                    setResumeAttempted(true);
                    setResumeHold(null);
                    resume.mutate(resumeFile);
                  }}
                >
                  以所選檔案完成補傳
                </Button>
              </>
            ) : null}
          </>
        )}
      </div>
    );
  if (upload.isSuccess && upload.data.kind === "uploaded")
    return (
      <p role="status" className="text-sm">
        已收取補傳檔案，等待掃描及覆核。
      </p>
    );
  if (upload.isError && !preparationFailed && intentId)
    return (
      <div className="space-y-2 text-sm">
        <p role="alert" className="text-status-orange-text">
          補傳結果未確認。請先核對文件庫及上載記錄，避免重複補傳。
          {intentId ? ` 上載 ID：${intentId}` : ""}
        </p>
        <Button type="button" disabled={checkingReceipt} onClick={() => void checkReceipt()}>
          核對補傳結果
        </Button>
        {receiptState === "unconfirmed" ? (
          <p role="status">尚未核實補傳登記。請勿重複補傳；可稍後再次核對。</p>
        ) : null}
      </div>
    );
  if (upload.isError && !preparationFailed && lookup.phase === "reading")
    return <p role="status">正在核對未完成補傳。</p>;

  return (
    <div className="space-y-2 text-sm">
      {preparationFailed ? (
        <p role="alert">無法準備檔案，尚未提交上載。請重新選擇檔案後重試。</p>
      ) : null}
      {upload.isError && lookup.phase === "absent" ? (
        <p role="status">先前的補傳沒有登記。可重新批准。</p>
      ) : null}
      {!preview.data ? (
        <Button type="button" disabled={preview.isPending} onClick={() => preview.mutate()}>
          預覽受控補傳
        </Button>
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
              disabled={attempted || lookup.phase !== "absent"}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="mt-1 block w-full"
            />
          </label>
          <label className="block">
            核對原因
            <Textarea
              aria-label="核對原因"
              maxLength={500}
              value={reason}
              disabled={attempted || lookup.phase !== "absent"}
              onChange={(event) => setReason(event.target.value)}
              className="mt-1 w-full"
            />
          </label>
          <Button
            type="button"
            variant="primary"
            disabled={!file || !reason.trim() || attempted || lookup.phase !== "absent"}
            onClick={() => {
              if (admitted.current || lookup.phase !== "absent") return;
              admitted.current = true;
              setPreparationFailed(false);
              setAttempted(true);
              upload.mutate();
            }}
          >
            批准並補傳
          </Button>
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
