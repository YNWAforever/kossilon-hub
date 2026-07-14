export type DocumentStatus =
  | "created"
  | "uploaded"
  | "quarantined"
  | "available"
  | "rejected"
  | "expired"
  | "failed";

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
};

export type DocumentScanResult =
  | { status: "clean"; providerReference: string }
  | { status: "rejected"; reason: string; providerReference: string }
  | { status: "failed"; retryable: boolean; errorCode: string };

export type DocumentScanner = {
  scan(input: {
    objectKey: string;
    checksum: string;
    contentType: string;
  }): Promise<DocumentScanResult>;
};
