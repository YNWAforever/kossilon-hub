export type DocumentStatus =
  | "created"
  | "uploaded"
  | "quarantined"
  | "available"
  | "rejected"
  | "expired"
  | "failed";

export type DocumentAvailability =
  | "available"
  | "metadata_only"
  | "missing_object"
  | "quarantined"
  | "unscanned"
  | "unsafe";

export const DOCUMENT_CATEGORIES = [
  "identity",
  "registry",
  "signature",
  "payment",
  "packet",
  "submission",
  "receipt",
  "other",
] as const;

export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number];

export type PutDocumentInput = {
  objectKey: string;
  body: Uint8Array | ArrayBuffer;
  checksum: string;
  contentType: string;
  sizeBytes: number;
};

export type StoredObjectMetadata = {
  objectKey: string;
  checksum: string;
  contentType: string;
  sizeBytes: number;
};

export type StoredObject = StoredObjectMetadata;
export type StoredObjectBody = StoredObjectMetadata & { body: ArrayBuffer };

export type DocumentStorage = {
  put(input: PutDocumentInput): Promise<StoredObject>;
  get(objectKey: string): Promise<StoredObjectBody | null>;
  delete(objectKey: string): Promise<void>;
  head(objectKey: string): Promise<StoredObjectMetadata | null>;
  inspect?(
    objectKey: string,
  ): Promise<
    { state: "missing" | "unknown" } | { state: "present"; metadata: StoredObjectMetadata | null }
  >;
};

export type DocumentScanResult =
  | {
      status: "clean";
      providerReference: string;
      /**
       * The hash of the bytes the scanner actually read, when it read them.
       *
       * Only a scanner that fetches the stored object can supply this. The
       * deterministic fixture scanner never does, which is why it is optional
       * and why a version with no verified hash is the normal state today. It
       * is the difference between the identity of a document and the client's
       * claim about it, and the package manifest depends on that difference.
       */
      verifiedChecksum?: string;
      verifiedByteSize?: number;
    }
  | { status: "rejected"; reason: string; providerReference: string }
  | { status: "failed"; retryable: boolean; errorCode: string };

export type DocumentScanInput = {
  objectKey: string;
  checksum: string;
  contentType: string;
  /**
   * Carried because a real provider records what it was asked about, and because
   * the local fixture scanner has nothing else reachable to key off: contentType
   * is constrained to pdf/png/jpeg by validateDocumentUploadRequest, so the two
   * magic content types the old fixture keyed on could never reach a persisted
   * intent and its rejected/retry branches were dead code.
   */
  fileName: string;
};

export type DocumentScanner = {
  scan(input: DocumentScanInput): Promise<DocumentScanResult>;
};

/**
 * Where a scan verdict came from.
 *
 * `deterministic` is the fixed-response test scanner, which returns "clean" for
 * every input but two magic content types. It was wired into live mode
 * unconditionally, so its verdicts are evidence of nothing.
 *
 * A missing value means the verdict predates this distinction and is equally
 * unverifiable. Both are unknown safety; only `provider` is verified safety.
 * The union has no "unknown" member on purpose -- absence is the honest
 * representation, and a named value would invite writing it as if it were a
 * finding (the reasoning migration 0022 recorded for notification_outbox.delivery).
 */
export type ScanVerdictSource = "provider" | "deterministic";

/**
 * A scanner that reports which of those it is, so the caller records what it was
 * handed instead of inferring it from the provider reference's shape.
 */
export type IdentifiedDocumentScanner = DocumentScanner & {
  readonly verdictSource: ScanVerdictSource;
};
