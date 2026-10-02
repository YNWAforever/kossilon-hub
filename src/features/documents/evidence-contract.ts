import { z } from "zod";
import type { ExtractedEvidence, EvidenceSpan } from "./text-extraction";

const spanSchema = z
  .object({
    page: z.number().int().min(1).max(200),
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
    quote: z.string().max(200_000),
  })
  .strict();
const schema = z
  .object({
    documentVersionId: z.string().uuid(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    method: z.enum(["text-layer", "ocr", "manual"]),
    pageCount: z.number().int().min(0).max(200).nullable(),
    truncated: z.boolean(),
    unknownReason: z.string().min(1).max(200).nullable(),
    pages: z
      .array(
        z
          .object({
            page: z.number().int().min(1).max(200),
            text: z.string().max(200_000),
            spans: z.array(spanSchema).max(1000),
            confidence: z.number().finite().min(0).max(1).nullable(),
            method: z.enum(["text-layer", "ocr", "none"]),
          })
          .strict(),
      )
      .max(200),
    provenance: z
      .object({
        extractorVersion: z.string().min(1).max(100),
        providerReference: z.string().min(1).max(200).nullable(),
        model: z.string().min(1).max(100).nullable(),
        cost: z.number().finite().nonnegative().nullable(),
      })
      .strict(),
  })
  .strict();

export function spanMatchesEvidence(evidence: ExtractedEvidence, span: EvidenceSpan): boolean {
  if (!spanSchema.safeParse(span).success || span.end <= span.start) return false;
  const page = evidence.pages.find((item) => item.page === span.page);
  return Boolean(
    page && span.end <= page.text.length && page.text.slice(span.start, span.end) === span.quote,
  );
}

/** Structural proof of a citation, never a proof that an AI opinion is true. */
export function isBoundEvidence(value: unknown): value is ExtractedEvidence {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return false;
  const evidence = parsed.data;
  return (
    new Set(evidence.pages.map((page) => page.page)).size === evidence.pages.length &&
    evidence.pages.reduce((sum, page) => sum + page.text.length, 0) <= 200_000 &&
    (evidence.method !== "manual" || evidence.unknownReason !== null) &&
    (!evidence.truncated || evidence.unknownReason !== null) &&
    evidence.pages.every(
      (page) =>
        (evidence.pageCount === null || page.page <= evidence.pageCount) &&
        page.spans.every((span) => span.page === page.page && spanMatchesEvidence(evidence, span)),
    )
  );
}
