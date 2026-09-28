import { z } from "zod";
import { makeFinding, type Finding } from "./findings";

const id = z.string().uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().trim().min(1).max(200);

const contextInputSchema = z
  .object({
    caseId: id,
    company: z.object({ id, name: text, crNumber: text }).strict(),
    returnYear: z.number().int().min(1900).max(2200),
    partySnapshot: z.array(z.object({ id, name: text }).strict()).max(500),
    requirementSnapshot: z.array(z.object({ id, label: text }).strict()).max(500),
    documentVersionId: id,
    contentSha256: sha256,
    ruleSetVersion: text,
  })
  .strict();

export type AnalysisContext = z.output<typeof contextInputSchema> & { contextHash: string };
export type AnalysisContextInput = z.input<typeof contextInputSchema>;
export const CONTEXT_RULE_SET_VERSION = "t25-1";
export type AnalysisEvidence = {
  page: number;
  quote: string;
  bbox?: readonly [number, number, number, number] | null;
  extractionMethod: "text-layer" | "ocr";
  sourceVersionId: string;
  confidence: number;
};

const canonical = (input: z.output<typeof contextInputSchema>) => ({
  ...input,
  partySnapshot: [...input.partySnapshot].sort((a, b) => a.id.localeCompare(b.id)),
  requirementSnapshot: [...input.requirementSnapshot].sort((a, b) => a.id.localeCompare(b.id)),
});

/** Only a server-side case read may supply these facts; document text is never a source. */
export async function buildAnalysisContext(
  raw: z.input<typeof contextInputSchema>,
): Promise<AnalysisContext> {
  const input = canonical(contextInputSchema.parse(raw));
  const bytes = new TextEncoder().encode(JSON.stringify(input));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const contextHash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return { ...input, contextHash };
}

export function contextIsCurrent(saved: AnalysisContext, current: AnalysisContext): boolean {
  return (
    saved.contextHash === current.contextHash &&
    saved.documentVersionId === current.documentVersionId &&
    saved.contentSha256 === current.contentSha256
  );
}

function advisory(context: AnalysisContext, ruleKey: string, detail: string): Finding {
  return makeFinding({
    ruleKey: `provider-context:${ruleKey}`,
    ruleVersion: context.ruleSetVersion,
    tier: "provider",
    outcome: "issue",
    severity: "warning",
    detail,
    citation: {
      kind: "version",
      documentVersionId: context.documentVersionId,
      pageFrom: null,
      pageTo: null,
    },
  });
}

/** A mismatch requests human review; extracted/model values cannot become authority. */
export function compareContextEvidence(
  context: AnalysisContext,
  observed: {
    companyName?: string | null;
    crNumber?: string | null;
    returnYear?: number | null;
    partyNames?: readonly string[];
    requirementLabels?: readonly string[];
    pageCount?: number | null;
    expectedPageCount?: number | null;
  },
): Finding[] {
  const findings: Finding[] = [];
  const same = (a: string, b: string) =>
    a.trim().toLocaleLowerCase("en-HK") === b.trim().toLocaleLowerCase("en-HK");
  if (observed.companyName && !same(observed.companyName, context.company.name))
    findings.push(
      advisory(
        context,
        "company-name",
        "The document's company name differs from the authorized case.",
      ),
    );
  if (observed.crNumber && !same(observed.crNumber, context.company.crNumber))
    findings.push(
      advisory(
        context,
        "cr-number",
        "The document's CR number differs from the authorized company.",
      ),
    );
  if (
    observed.returnYear !== undefined &&
    observed.returnYear !== null &&
    observed.returnYear !== context.returnYear
  )
    findings.push(
      advisory(context, "return-year", "The document's return year differs from the case."),
    );
  if (
    observed.partyNames?.some(
      (name) => !context.partySnapshot.some((party) => same(name, party.name)),
    )
  )
    findings.push(
      advisory(
        context,
        "party",
        "At least one named person is outside the current case party snapshot.",
      ),
    );
  if (
    observed.requirementLabels?.some(
      (label) => !context.requirementSnapshot.some((item) => same(label, item.label)),
    )
  )
    findings.push(
      advisory(
        context,
        "requirement",
        "A document requirement differs from the current case snapshot.",
      ),
    );
  if (
    observed.pageCount !== undefined &&
    observed.expectedPageCount !== undefined &&
    observed.pageCount !== null &&
    observed.expectedPageCount !== null &&
    observed.pageCount !== observed.expectedPageCount
  )
    findings.push(
      advisory(
        context,
        "page-count",
        "The reported page count differs from the expected evidence pages.",
      ),
    );
  return findings;
}

export function validateModelEvidence(
  context: AnalysisContext,
  evidence: AnalysisEvidence,
  pages: readonly { page: number; text: string }[],
): {
  outcome: "supported" | "uncertain";
  sourceVersionId: string;
  page: number;
  reasonCode: string | null;
} {
  const uncertain = (reasonCode: string) => ({
    outcome: "uncertain" as const,
    sourceVersionId: evidence.sourceVersionId,
    page: evidence.page,
    reasonCode,
  });
  if (evidence.sourceVersionId !== context.documentVersionId)
    return uncertain("SOURCE_VERSION_CHANGED");
  if (!Number.isInteger(evidence.page) || evidence.page < 1) return uncertain("PAGE_UNVERIFIED");
  if (!Number.isFinite(evidence.confidence) || evidence.confidence < 0.8 || evidence.confidence > 1)
    return uncertain("LOW_CONFIDENCE");
  if (
    evidence.bbox &&
    (evidence.bbox.some((value) => !Number.isFinite(value) || value < 0 || value > 1) ||
      evidence.bbox[0] >= evidence.bbox[2] ||
      evidence.bbox[1] >= evidence.bbox[3])
  )
    return uncertain("INVALID_BBOX");
  const page = pages.find((candidate) => candidate.page === evidence.page);
  if (!page) return uncertain("PAGE_UNVERIFIED");
  const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
  const quote = normalize(evidence.quote);
  if (!quote || quote.length > 500 || !normalize(page.text).includes(quote))
    return uncertain("QUOTE_NOT_FOUND");
  return {
    outcome: "supported",
    sourceVersionId: evidence.sourceVersionId,
    page: evidence.page,
    reasonCode: null,
  };
}

const responseSchema = z
  .object({
    contextHash: sha256,
    modelVersion: text,
    promptVersion: text,
    ruleSetVersion: text,
    latencyMs: z.number().int().nonnegative().max(300_000),
    costMinor: z.number().int().nonnegative().max(1_000_000),
    claims: z
      .array(
        z
          .object({
            kind: z.enum(["company-name", "cr-number", "return-year", "party", "requirement"]),
            value: z.union([
              z.string().trim().min(1).max(200),
              z.number().int().min(1900).max(2200),
            ]),
            evidence: z
              .object({
                sourceVersionId: id,
                page: z.number().int().positive(),
                quote: z.string().trim().min(1).max(500),
                confidence: z.number().min(0).max(1),
                extractionMethod: z.enum(["text-layer", "ocr"]),
                bbox: z
                  .tuple([z.number(), z.number(), z.number(), z.number()])
                  .nullable()
                  .optional(),
              })
              .strict(),
          })
          .strict(),
      )
      .max(50)
      .optional(),
    observations: z
      .array(
        z
          .object({
            ruleKey: z.string().regex(/^[a-z0-9-]{1,80}$/),
            outcome: z.enum(["pass", "issue", "uncertain"]),
            severity: z.enum(["warning", "info"]),
            detail: z.string().trim().min(1).max(2000),
            evidence: z
              .object({
                sourceVersionId: id,
                page: z.number().int().positive(),
                quote: z.string().trim().min(1).max(500),
                confidence: z.number().min(0).max(1),
                extractionMethod: z.enum(["text-layer", "ocr"]),
                bbox: z
                  .tuple([z.number(), z.number(), z.number(), z.number()])
                  .nullable()
                  .optional(),
              })
              .strict(),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();

export type AdvisoryResponse = z.output<typeof responseSchema>;
export function parseAdvisoryResponse(
  raw: unknown,
  expectedContextHash?: string,
):
  | { status: "analysed"; response: AdvisoryResponse }
  | { status: "uncertain"; reasonCode: string } {
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) return { status: "uncertain", reasonCode: "MALFORMED_MODEL_RESPONSE" };
  if (expectedContextHash && parsed.data.contextHash !== expectedContextHash)
    return { status: "uncertain", reasonCode: "CONTEXT_CHANGED" };
  return {
    status: "analysed",
    response: {
      ...parsed.data,
      // Advisory agreement is never authoritative verification.
      observations: parsed.data.observations.map((item) =>
        item.outcome === "pass"
          ? { ...item, outcome: "uncertain" as const, severity: "info" as const }
          : item,
      ),
    },
  };
}
