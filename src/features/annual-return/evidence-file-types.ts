import { DOCUMENT_CATEGORIES, type DocumentCategory } from "@/features/documents/types";

/**
 * The `documents.file_type` values each kind of annual-return evidence accepts.
 *
 * These guards used to match a single literal — "annual-return-evidence",
 * "payment-proof", "filing-confirmation" — that only the seed script ever wrote.
 * The upload pipeline writes a `DocumentCategory`, so every evidence lookup
 * matched zero rows against anything a user actually uploaded: required checklist
 * items could never be verified and a case could never be completed.
 *
 * Each set unions the seeded vocabulary with the upload categories that mean the
 * same thing, so seeded pilot data and real uploads both resolve. `file_type` is
 * a redundant check either way — the checklist item, the payment and the case all
 * reference the document by id — so the sets stay deliberately permissive rather
 * than rejecting evidence a user has explicitly attached.
 */
const LEGACY_CHECKLIST_EVIDENCE = "annual-return-evidence";
const LEGACY_PAYMENT_PROOF = "payment-proof";
const LEGACY_FILING_CONFIRMATION = "filing-confirmation";

/** A checklist item may require any kind of supporting document. */
const CHECKLIST_EVIDENCE_CATEGORIES = [
  "identity",
  "registry",
  "signature",
  "packet",
  "other",
] as const satisfies readonly DocumentCategory[];

/**
 * Disjoint on purpose. "receipt" was in both sets, which meant one uploaded
 * document satisfied the payment-proof guard AND the filing-confirmation guard —
 * so a client's payment receipt could be accepted as the Companies Registry's
 * acknowledgement of the NAR1, and a case could be completed without the filing
 * ever being evidenced. A receipt is money; a submission is the filing.
 */
const PAYMENT_PROOF_CATEGORIES = [
  "payment",
  "receipt",
] as const satisfies readonly DocumentCategory[];

const FILING_CONFIRMATION_CATEGORIES = [
  "submission",
] as const satisfies readonly DocumentCategory[];

export const CHECKLIST_EVIDENCE_FILE_TYPES: readonly string[] = [
  LEGACY_CHECKLIST_EVIDENCE,
  ...CHECKLIST_EVIDENCE_CATEGORIES,
];

export const PAYMENT_PROOF_FILE_TYPES: readonly string[] = [
  LEGACY_PAYMENT_PROOF,
  ...PAYMENT_PROOF_CATEGORIES,
];

export const FILING_CONFIRMATION_FILE_TYPES: readonly string[] = [
  LEGACY_FILING_CONFIRMATION,
  ...FILING_CONFIRMATION_CATEGORIES,
];

/** The seeded values, which are intentionally outside DOCUMENT_CATEGORIES. */
export const LEGACY_EVIDENCE_FILE_TYPES: readonly string[] = [
  LEGACY_CHECKLIST_EVIDENCE,
  LEGACY_PAYMENT_PROOF,
  LEGACY_FILING_CONFIRMATION,
];

export function isKnownEvidenceFileType(value: string): boolean {
  return (
    (DOCUMENT_CATEGORIES as readonly string[]).includes(value) ||
    LEGACY_EVIDENCE_FILE_TYPES.includes(value)
  );
}
