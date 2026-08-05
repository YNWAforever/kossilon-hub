import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DOCUMENT_CATEGORIES } from "@/features/documents/types";
import {
  CHECKLIST_EVIDENCE_FILE_TYPES,
  FILING_CONFIRMATION_FILE_TYPES,
  isKnownEvidenceFileType,
  LEGACY_EVIDENCE_FILE_TYPES,
  PAYMENT_PROOF_FILE_TYPES,
} from "./evidence-file-types";

const EVIDENCE_SETS = {
  checklist: CHECKLIST_EVIDENCE_FILE_TYPES,
  payment: PAYMENT_PROOF_FILE_TYPES,
  filing: FILING_CONFIRMATION_FILE_TYPES,
};

/**
 * The regression: the evidence guards matched "annual-return-evidence",
 * "payment-proof" and "filing-confirmation", none of which the upload pipeline
 * can write. Every lookup matched zero rows, so required checklist items could
 * never be verified and no case could ever be completed — while the tests passed,
 * because the integration fixtures are seeded with the same dead vocabulary.
 */
describe("annual-return evidence file types", () => {
  it("accepts at least one category the upload pipeline can actually write", () => {
    for (const [kind, accepted] of Object.entries(EVIDENCE_SETS)) {
      const writable = accepted.filter((value) =>
        (DOCUMENT_CATEGORIES as readonly string[]).includes(value),
      );

      expect(writable, `${kind} evidence accepts no uploadable DocumentCategory`).not.toHaveLength(
        0,
      );
    }
  });

  it("still accepts the seeded vocabulary so existing pilot data resolves", () => {
    expect(CHECKLIST_EVIDENCE_FILE_TYPES).toContain("annual-return-evidence");
    expect(PAYMENT_PROOF_FILE_TYPES).toContain("payment-proof");
    expect(FILING_CONFIRMATION_FILE_TYPES).toContain("filing-confirmation");
  });

  it("keeps payment and filing evidence meaningfully distinct", () => {
    // Permissive is fine for generic checklist evidence, but a payment proof
    // should not be satisfied by, say, an identity document.
    expect(PAYMENT_PROOF_FILE_TYPES).not.toContain("identity");
    expect(FILING_CONFIRMATION_FILE_TYPES).not.toContain("identity");
  });

  it("recognises every accepted value as either a category or a legacy value", () => {
    for (const accepted of Object.values(EVIDENCE_SETS)) {
      for (const value of accepted) {
        expect(isKnownEvidenceFileType(value), `${value} is not a known file type`).toBe(true);
      }
    }
  });

  it("treats an unknown file type as unknown", () => {
    expect(isKnownEvidenceFileType("not-a-real-file-type")).toBe(false);
  });

  // The seed script is the only writer of the legacy vocabulary. If it stops
  // using a value, that value should stop being special-cased here.
  it("keeps the legacy list aligned with what the seed script writes", () => {
    const seed = readFileSync(
      new URL("../../../scripts/db-seed-annual-return.ts", import.meta.url),
      "utf8",
    );

    for (const legacy of LEGACY_EVIDENCE_FILE_TYPES) {
      expect(seed, `${legacy} is no longer seeded`).toContain(`"${legacy}"`);
    }
  });
});

describe("annual-return repository evidence predicates", () => {
  const repository = readFileSync(new URL("./repository.ts", import.meta.url), "utf8");

  it("matches evidence against the accepted set rather than one literal", () => {
    expect(repository).not.toMatch(/file_type = \$\{[A-Z_]*FILE_TYPE\}/);
    expect(repository.match(/file_type = any\(\$\{[A-Z_]+\}\)/g) ?? []).toHaveLength(6);
  });
});
