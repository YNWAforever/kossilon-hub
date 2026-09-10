import { z } from "zod";
import type { DocumentScannerConfig } from "@/server/runtime-env";
import type { DocumentScanResult, DocumentStorage, IdentifiedDocumentScanner } from "./types";

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

export function createLiveDocumentScanner(
  options: LiveDocumentScannerOptions,
): IdentifiedDocumentScanner {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? SCAN_TIMEOUT_MS;

  return {
    verdictSource: "provider",

    async scan(input): Promise<DocumentScanResult> {
      const stored = await options.storage.get(input.objectKey);
      if (!stored) {
        // Retryable: an object that is not readable right now may be an eventual
        // consistency window or a transient storage fault. It is emphatically not
        // evidence that the file is safe.
        return { status: "failed", retryable: true, errorCode: "stored-object-unreadable" };
      }

      const actualChecksum = await sha256Hex(stored.body);
      if (actualChecksum !== input.checksum) {
        // Not retryable: the bytes in storage are not the bytes this intent
        // describes, and retrying cannot reconcile that. It needs a human.
        return { status: "failed", retryable: false, errorCode: "stored-checksum-mismatch" };
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
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
      } finally {
        clearTimeout(timer);
      }

      if (!response.ok) {
        // 4xx is a configuration or contract problem a retry cannot fix; 5xx and
        // 429 are worth retrying. Neither is ever clean.
        const retryable = response.status >= 500 || response.status === 429;
        return { status: "failed", retryable, errorCode: `http-${response.status}` };
      }

      let parsed: z.infer<typeof responseSchema>;
      try {
        parsed = responseSchema.parse(await response.json());
      } catch {
        return { status: "failed", retryable: false, errorCode: "malformed-response" };
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
      };
    },
  };
}
