import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { downloadDocument } from "./server-fns";
import { canApproveDocument, documentSafetyOf } from "./safety";
import type { DocumentSummary } from "./repository";
type SafeDocumentPreviewProps = {
  document: Pick<
    DocumentSummary,
    "id" | "currentVersionId" | "uploadStatus" | "scanVerdictSource" | "availability"
  >;
  label?: string;
  title?: string;
};
/** Reuses the authorised private byte route; no storage URL reaches the UI. */
export function SafeDocumentPreview(props: SafeDocumentPreviewProps) {
  const { document } = props;
  // New identity/version/safety evidence starts a new preview lifetime. Old
  // bytes must never appear as the newly selected document's current preview.
  return (
    <DocumentPreview
      key={JSON.stringify([
        document.id,
        document.currentVersionId,
        document.uploadStatus,
        document.scanVerdictSource,
        document.availability,
      ])}
      {...props}
    />
  );
}
function DocumentPreview({
  document,
  label = "預覽當前付款憑證",
  title = "付款憑證預覽",
}: SafeDocumentPreviewProps) {
  const active = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
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
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(false);
    setSource(null);
    try {
      const response = await downloadDocument({
        data: { documentId: document.id, expectedVersionId: document.currentVersionId! },
      });
      if (!response.ok) throw new Error("Preview unavailable");
      const blob = await response.blob();
      if (!active.current) return;
      if (!["application/pdf", "image/png", "image/jpeg"].includes(blob.type))
        throw new Error("Unsupported preview type");
      setSource({ url: URL.createObjectURL(blob), type: blob.type });
    } catch {
      if (active.current) setError(true);
    } finally {
      inFlight.current = false;
      if (active.current) setPending(false);
    }
  }
  return (
    <div>
      <Button type="button" disabled={pending} onClick={() => void preview()}>
        {pending ? "載入中…" : label}
      </Button>
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
