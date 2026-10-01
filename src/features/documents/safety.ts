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
 * `unknown` is readable by an Admin and by nobody else. That is a corrected,
 * narrower policy rather than a grandfathered permission: the fake verdict grants
 * nothing, the bytes and every historical staff decision are preserved, and an
 * operator retains the access they need to handle an incident or export the file
 * for a real scan. Everyone else waits for a genuine verdict.
 */
export function canServeDocumentBytes(actor: AuthenticatedActor, safety: DocumentSafety): boolean {
  if (safety === "verified") return true;
  if (safety === "unknown") return actor.role === "Admin";
  return false;
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
 * Stricter than serving: an Admin may open an unknown-safety file to deal with
 * it, but nobody may newly approve one, because an approval is what later
 * releases the document to a client and into a filing package.
 */
export function canApproveDocument(safety: DocumentSafety): boolean {
  return safety === "verified";
}
