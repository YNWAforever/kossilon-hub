import { z } from "zod";
import type { DocumentScannerConfig } from "@/server/runtime-env";
import type { DocumentScanResult, DocumentStorage, IdentifiedDocumentScanner } from "./types";
import { sniffContentType } from "./analysis-checks";
import { extractPdfText } from "./text-extraction";

/**
 * A real malware scanner: it fetches the exact stored bytes and submits them.
 *
 * The scanner it replaces in live mode inspected nothing -- it returned "clean"
 * for every input but two magic content types, and `loadDefaultDocumentContext`
 * handed it to live unconditionally. Every property below exists because the
 * absence of it is what made that dangerous:
 *
 * - It reads the object, so the verdict is about the content actually in R2 and
 *   not about metadata a caller asserted.
 * - It re-derives the checksum of what it read and refuses to proceed if the
 *   stored bytes do not match the intent. A scanner that reports on different
 *   bytes than the ones a staff member will later download is worse than none.
 * - It records the provider's own reference, so a verdict is traceable to the
 *   vendor's record rather than to a locally minted string.
 * - Every non-verdict outcome is `failed`, never `clean`. Unreachable, timing
 *   out, rate-limited, malformed, unauthorized: all of them leave the document
 *   quarantined for retry. There is no path through this function that turns an
 *   infrastructure problem into permission to release a file.
 *
 * BLOCKED_INTEGRATION: malware-scanner-provider. No provider has been named or
 * configured for this deployment, so `getDocumentScannerConfig` returns null and
 * live document uploads stay disabled. The contract below is exercised against a
 * stub transport in live-scanner.test.ts; it has never run against a real vendor
 * and must not be described as verified until it has.
 */

const responseSchema = z
  .object({
    verdict: z.enum(["clean", "infected"]),
    reference: z.string().trim().min(1).max(200),
    // What the provider says it found. Recorded verbatim on a rejection so the
    // reason a file was refused is the vendor's, not our paraphrase.
    signature: z.string().trim().max(200).optional(),
  })
  .strict();

const SCAN_TIMEOUT_MS = 60_000;
const MAX_RESPONSE_BYTES = 16_384;
const MAX_OBJECT_BYTES = 10 * 1024 * 1024;

export type LiveDocumentScannerOptions = {
  config: DocumentScannerConfig;
  storage: DocumentStorage;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

async function sha256Hex(body: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", body);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function boundedResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new Error("Missing scan response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (true) {
      signal.throwIfAborted();
      const next = await reader.read();
      signal.throwIfAborted();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("Oversized scan response");
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

export function createLiveDocumentScanner(
  options: LiveDocumentScannerOptions,
): IdentifiedDocumentScanner {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? SCAN_TIMEOUT_MS;

  return {
    verdictSource: "provider",

    async scan(input): Promise<DocumentScanResult> {
      if (!z.string().uuid().safeParse(input.documentVersionId).success)
        return { status: "failed", retryable: false, errorCode: "document-version-missing" };
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout>;
      const deadline = new Promise<DocumentScanResult>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({ status: "failed", retryable: true, errorCode: "timeout" });
        }, timeoutMs);
      });
      const perform = async (): Promise<DocumentScanResult> => {
        const stored = await options.storage.get(input.objectKey);
        controller.signal.throwIfAborted();
        if (!stored) {
          // Retryable: an object that is not readable right now may be an eventual
          // consistency window or a transient storage fault. It is emphatically not
          // evidence that the file is safe.
          return { status: "failed", retryable: true, errorCode: "stored-object-unreadable" };
        }

        if (stored.body.byteLength === 0)
          return { status: "failed", retryable: false, errorCode: "stored-object-empty" };
        if (
          stored.body.byteLength > MAX_OBJECT_BYTES ||
          stored.body.byteLength !== stored.sizeBytes
        )
          return { status: "failed", retryable: false, errorCode: "stored-size-mismatch" };

        const actualChecksum = await sha256Hex(stored.body);
        controller.signal.throwIfAborted();
        if (actualChecksum !== input.checksum) {
          // Not retryable: the bytes in storage are not the bytes this intent
          // describes, and retrying cannot reconcile that. It needs a human.
          return { status: "failed", retryable: false, errorCode: "stored-checksum-mismatch" };
        }
        const bytes = new Uint8Array(stored.body);
        if (sniffContentType(bytes.subarray(0, 16)) !== input.contentType)
          return { status: "failed", retryable: false, errorCode: "stored-content-type-mismatch" };
        if (
          input.contentType === "application/pdf" &&
          !new TextDecoder()
            .decode(bytes.subarray(Math.max(0, bytes.length - 2048)))
            .includes("%%EOF")
        )
          return { status: "failed", retryable: false, errorCode: "pdf-incomplete" };
        let response: Response;
        try {
          response = await fetchImpl(options.config.endpoint, {
            method: "POST",
            headers: {
              authorization: `Bearer ${options.config.apiKey}`,
              "content-type": "application/octet-stream",
              // Sent so the provider can record what it was asked about; the
              // verdict is still computed over the body, not over these.
              "x-document-checksum-sha256": input.checksum,
              "x-document-content-type": input.contentType,
              // Encoded: a file name can carry non-ASCII, and a raw header value
              // would either throw or be silently mangled.
              "x-document-file-name": encodeURIComponent(input.fileName),
            },
            body: stored.body,
            signal: controller.signal,
          });
        } catch (error) {
          // Includes the abort. Transport failures are retryable and are reported
          // by class, not by message: a vendor error string can carry content we
          // have no business persisting.
          return {
            status: "failed",
            retryable: true,
            errorCode:
              error instanceof Error && error.name === "AbortError" ? "timeout" : "transport",
          };
        }
        controller.signal.throwIfAborted();

        if (!response.ok) {
          // 4xx is a configuration or contract problem a retry cannot fix; 5xx and
          // 429 are worth retrying. Neither is ever clean.
          const retryable = response.status >= 500 || response.status === 429;
          return { status: "failed", retryable, errorCode: `http-${response.status}` };
        }

        let parsed: z.infer<typeof responseSchema>;
        try {
          parsed = responseSchema.parse(await boundedResponse(response, controller.signal));
        } catch {
          if (controller.signal.aborted)
            return { status: "failed", retryable: true, errorCode: "timeout" };
          return { status: "failed", retryable: false, errorCode: "malformed-response" };
        }

        // Parse only after a positive provider verdict. A clean malware response
        // does not make encrypted/corrupt PDF content inspectable. Image-only PDFs
        // remain valid scan evidence, with no invented text or OCR approval.
        if (input.contentType === "application/pdf") {
          const readable = await extractPdfText({
            body: stored.body,
            contentType: input.contentType,
          });
          controller.signal.throwIfAborted();
          if (readable.method === "unreadable")
            return { status: "failed", retryable: false, errorCode: "pdf-unreadable" };
        }

        if (parsed.verdict === "infected") {
          return {
            status: "rejected",
            reason: parsed.signature ?? "provider-reported-infected",
            providerReference: parsed.reference,
          };
        }

        // The identity of the document, carried out of the one place that has it.
        // This scanner already read the object and hashed it to check it against
        // the intent, so the version row can finally record what the bytes are
        // rather than what the uploader said they would be.
        return {
          status: "clean",
          providerReference: parsed.reference,
          verifiedChecksum: actualChecksum,
          verifiedByteSize: stored.body.byteLength,
          documentVersionId: input.documentVersionId,
        };
      };
      try {
        // The deadline covers storage, hashing, fetch, response body and safe
        // parsing, including a transport that ignores AbortSignal. Late work
        // checks the signal before proceeding and cannot publish a verdict.
        return await Promise.race([
          perform().catch(
            () =>
              ({
                status: "failed",
                retryable: true,
                errorCode: controller.signal.aborted ? "timeout" : "transport",
              }) as const,
          ),
          deadline,
        ]);
      } finally {
        clearTimeout(timer!);
      }
    },
  };
}
