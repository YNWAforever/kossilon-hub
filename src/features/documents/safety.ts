import type { AuthenticatedActor } from "@/features/auth/types";
import type { DocumentAvailability, DocumentStatus, ScanVerdictSource } from "./types";

/**
 * File safety, as a dimension of its own.
 *
 * It is deliberately not the same axis as business review. A document can be
 * safe and unapproved (the normal state a reviewer needs to open), or approved
 * long ago and of unknown safety (every file the deterministic scanner ever
 * passed). Collapsing the two is what let a fake "clean" become permission to
 * serve bytes.
 */
export type DocumentSafety =
  /** A real provider inspected these exact bytes and passed them. */
  | "verified"
  /** Received, no verdict yet, or a retryable failure. Not yet openable. */
  | "pending"
  /** A provider found malware. */
  | "unsafe"
  /**
   * Either the deterministic test scanner produced the verdict, or the verdict
   * predates the distinction. Neither is evidence. Held apart from "pending"
   * because the remedy differs: pending resolves itself when the queue drains,
   * unknown needs a genuine re-scan that only a configured provider can give.
   */
  | "unknown";

export function documentSafetyOf(input: {
  uploadStatus: DocumentStatus | null;
  scanVerdictSource: ScanVerdictSource | null;
  availability?: DocumentAvailability;
}): DocumentSafety {
  if (input.uploadStatus === "rejected") return "unsafe";
  if (
    input.availability === "metadata_only" ||
    input.availability === "missing_object" ||
    input.availability === "unscanned" ||
    input.uploadStatus === null
  )
    return "unknown";
  if (input.uploadStatus !== "available") return "pending";
  return input.scanVerdictSource === "provider" ? "verified" : "unknown";
}

/**
 * Whether these bytes may be served to this actor.
 *
 * Ordinary preview/download requires a genuine current scan for every role.
 * Unknown files remain visible as metadata for recovery and retain their bytes.
 */
export function canServeDocumentBytes(actor: AuthenticatedActor, safety: DocumentSafety): boolean {
  return actor.active && safety === "verified";
}

export function assertDocumentServable(actor: AuthenticatedActor, safety: DocumentSafety): void {
  if (canServeDocumentBytes(actor, safety)) return;
  if (safety === "unsafe") {
    throw new Error("Document was rejected by malware scanning.");
  }
  if (safety === "unknown") {
    throw new Error(
      "Document safety is unverified. Verify its upload lineage and obtain a genuine scan before approval.",
    );
  }
  throw new Error("Document is quarantined pending a malware scan.");
}

/**
 * Whether a business approval may be recorded against this file.
 *
 * Business review requires the same verified safety as ordinary serving.
 */
export function canApproveDocument(safety: DocumentSafety): boolean {
  return safety === "verified";
}
