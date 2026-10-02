import { useEffect, useState } from "react";
import { downloadDocument } from "./server-fns";
import { canApproveDocument, documentSafetyOf } from "./safety";
import type { DocumentSummary } from "./repository";
/** Reuses the authorised private byte route; no storage URL reaches the UI. */
export function SafeDocumentPreview({
  document,
  label = "預覽當前付款憑證",
  title = "付款憑證預覽",
}: {
  document: Pick<
    DocumentSummary,
    "id" | "currentVersionId" | "uploadStatus" | "scanVerdictSource" | "availability"
  >;
  label?: string;
  title?: string;
}) {
  const [source, setSource] = useState<{ url: string; type: string } | null>(null),
    [error, setError] = useState(false),
    [pending, setPending] = useState(false);
  useEffect(
    () => () => {
      if (source) URL.revokeObjectURL(source.url);
    },
    [source],
  );
  if (!document.currentVersionId || !canApproveDocument(documentSafetyOf(document)))
    return <p>當前文件安全或版本證據待核對，不能預覽。</p>;
  async function preview() {
    setPending(true);
    setError(false);
    try {
      const response = await downloadDocument({
        data: { documentId: document.id, expectedVersionId: document.currentVersionId! },
      });
      if (!response.ok) throw new Error("Preview unavailable");
      const blob = await response.blob();
      if (!["application/pdf", "image/png", "image/jpeg"].includes(blob.type))
        throw new Error("Unsupported preview type");
      setSource({ url: URL.createObjectURL(blob), type: blob.type });
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <div>
      <button
        type="button"
        className="rounded border px-3 py-2"
        disabled={pending}
        onClick={() => void preview()}
      >
        {pending ? "載入中…" : label}
      </button>
      {error ? <p role="alert">預覽未能載入或版本已更新，請重新載入案件。</p> : null}
      {source ? (
        source.type === "application/pdf" ? (
          <iframe title={title} sandbox="" src={source.url} className="mt-2 h-80 w-full border" />
        ) : (
          <img alt={title} src={source.url} className="mt-2 max-h-80" />
        )
      ) : null}
    </div>
  );
}
