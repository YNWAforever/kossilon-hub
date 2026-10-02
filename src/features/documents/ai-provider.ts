import { z } from "zod";
import type { ProviderMode } from "@/server/provider-mode";
import type { DocumentAiConfig } from "@/server/runtime-env";
import { makeFinding, type Finding } from "./findings";
import type { ExtractedEvidence } from "./text-extraction";
import { isBoundEvidence } from "./evidence-contract";

/**
 * Tier 3: a model reads the document.
 *
 * Genuine provider acceptance remains gated on approved runtime credentials and
 * the existing binary connector protocol. Local tests use a stub because a
 * capability that is switched off is a different thing from one that was never
 * built -- and because the shape of the contract is the part that has to be
 * right before any vendor is picked.
 *
 * Everything a model returns is untrusted. It read text an uploader controls, so
 * it is treated exactly like the document itself: data, never instructions.
 * Three independent layers enforce that, and each would be sufficient alone:
 *
 * 1. `critical` is not in the response schema, so a provider cannot express the
 *    severity that holds a package back.
 * 2. `makeFinding` clamps a provider-tier finding away from `critical` whatever
 *    it was asked for.
 * 3. `document_findings` has a CHECK constraint refusing the combination, so
 *    even a direct SQL write cannot create one.
 *
 * There is also no field anywhere in this contract for approving, resolving or
 * releasing anything. A model cannot ask; the shape does not exist.
 */

const MAX_OBSERVATIONS = 20;
const MAX_DETAIL_CHARACTERS = 2000;
const ANALYSIS_TIMEOUT_MS = 30_000;

export const AI_RULE_VERSION = "1";

/**
 * Deliberately strict, and deliberately missing things.
 *
 * `critical` is absent from the severity enum rather than filtered afterwards: a
 * response asking for it fails to parse and the whole run is rejected, instead
 * of being quietly downgraded and recorded as though the model had agreed.
 *
 * The bounds are not politeness. A hostile document that induces a model to emit
 * ten thousand observations, or one observation of a megabyte, would otherwise
 * turn a finding list into a denial-of-service against the reviewer's screen and
 * the findings table.
 */
const observationSchema = z
  .object({
    // Constrained so a provider cannot invent a key that collides with a
    // deterministic rule and inherit its meaning in the UI.
    ruleKey: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9-]+$/, "A rule key is lowercase, digits and hyphens."),
    outcome: z.enum(["pass", "issue", "uncertain"]),
    severity: z.enum(["warning", "info"]),
    detail: z.string().min(1).max(MAX_DETAIL_CHARACTERS),
    pageFrom: z.number().int().min(1).nullable().optional(),
    pageTo: z.number().int().min(1).nullable().optional(),
  })
  // Mirrors makeFinding's rules exactly, because the two disagreeing is itself a
  // defect. They did: `{pageTo: 3}` with no pageFrom, a backwards range, and a
  // whitespace-only detail all parsed here and then threw inside makeFinding --
  // out of analyze() entirely, past the promise below to return
  // `malformed-response`, and on into the caller. The first of those needs no
  // hostile intent at all; a benign model citing "page 3" was enough.
  .strict()
  .superRefine((observation, ctx) => {
    if (!observation.detail.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["detail"],
        message: "A finding must say something a human can read.",
      });
    }

    const pageFrom = observation.pageFrom ?? null;
    const pageTo = observation.pageTo ?? null;
    if (pageTo !== null && pageFrom === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pageFrom"],
        message: "A cited page range needs a start.",
      });
    }
    if (pageFrom !== null && pageTo !== null && pageTo < pageFrom) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["pageTo"],
        message: "A cited page range ends at or after it starts.",
      });
    }
  });

const responseSchema = z
  .object({
    reference: z.string().min(1).max(200),
    observations: z.array(observationSchema).max(MAX_OBSERVATIONS),
  })
  .strict();

export type AiAnalysisInput = {
  documentVersionId: string;
  contentType: string;
  fileName: string;
  body: ArrayBuffer;
  evidence: ExtractedEvidence;
};

export type AiAnalysisResult =
  | { status: "analysed"; providerReference: string; findings: Finding[] }
  /**
   * The model ran and could not tell. A first-class outcome rather than an empty
   * finding list, which would read as "checked, nothing wrong".
   */
  | { status: "uncertain"; providerReference: string; detail: string }
  | { status: "failed"; retryable: boolean; errorCode: string };

export type DocumentAiAnalyzer = {
  analyze(input: AiAnalysisInput): Promise<AiAnalysisResult>;
};

/** Full cited page text is the source span; no vendor quote/model API is invented. */
export function groundProviderFindings(
  evidence: ExtractedEvidence,
  candidates: readonly Finding[],
): Finding[] | null {
  if (
    !isBoundEvidence(evidence) ||
    evidence.unknownReason ||
    !evidence.pages.length ||
    !Array.isArray(candidates) ||
    candidates.length > MAX_OBSERVATIONS
  )
    return null;
  const grounded: Finding[] = [];
  for (const candidate of candidates) {
    if (
      !candidate ||
      typeof candidate.ruleKey !== "string" ||
      typeof candidate.ruleVersion !== "string" ||
      !candidate.ruleVersion.trim() ||
      !candidate.citation
    )
      return null;
    const citation = candidate.citation;
    if (
      citation.kind !== "version" ||
      !observationSchema.safeParse({
        ruleKey: candidate.ruleKey.replace(/^provider:/, ""),
        outcome: candidate.outcome,
        severity: candidate.severity,
        detail: candidate.detail,
        pageFrom: citation.pageFrom,
        pageTo: citation.pageTo,
      }).success
    )
      return null;
    if (
      candidate.tier !== "provider" ||
      candidate.severity === "critical" ||
      !candidate.ruleKey.startsWith("provider:") ||
      citation.kind !== "version" ||
      citation.documentVersionId !== evidence.documentVersionId ||
      citation.pageFrom === null ||
      !Number.isInteger(citation.pageFrom) ||
      citation.pageFrom < 1
    )
      return null;
    const last = citation.pageTo ?? citation.pageFrom;
    if (!Number.isInteger(last) || last < citation.pageFrom || last > 200) return null;
    const pages = evidence.pages.filter(
      (page) => page.page >= citation.pageFrom! && page.page <= last,
    );
    if (
      pages.length !== last - citation.pageFrom + 1 ||
      pages.some(
        (page) =>
          !page.text.trim() ||
          (page.method === "ocr" && (page.confidence === null || page.confidence < 0.8)),
      ) ||
      (candidate.evidence && candidate.evidence.sha256 !== evidence.sha256)
    )
      return null;
    grounded.push(
      makeFinding({
        ...candidate,
        evidence: {
          sha256: evidence.sha256,
          field: candidate.ruleKey,
          partyId: null,
          year: null,
          observed: null,
          expected: null,
          unknownReason: null,
          requirementInstanceId: null,
          spans: pages.map((page) => ({
            page: page.page,
            start: 0,
            end: page.text.length,
            quote: page.text,
          })),
        },
      }),
    );
  }
  return grounded;
}

const MAX_AI_RESPONSE_BYTES = 64 * 1024;
async function readBoundedAiResponse(response: Response, signal: AbortSignal): Promise<unknown> {
  if (Number(response.headers.get("content-length")) > MAX_AI_RESPONSE_BYTES || !response.body)
    throw new Error("invalid-response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
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
      size += next.value.byteLength;
      if (size > MAX_AI_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("response-too-large");
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(size);
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

export function createLiveDocumentAiAnalyzer(options: {
  config: DocumentAiConfig;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): DocumentAiAnalyzer {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? ANALYSIS_TIMEOUT_MS;
  return {
    async analyze(input): Promise<AiAnalysisResult> {
      if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
        return { status: "failed", retryable: false, errorCode: "invalid-timeout" };
      if (input.body.byteLength === 0 || input.body.byteLength > 10 * 1024 * 1024)
        return { status: "failed", retryable: false, errorCode: "document-size-invalid" };
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout>;
      const deadline = new Promise<AiAnalysisResult>((resolve) => {
        timer = setTimeout(() => {
          controller.abort();
          resolve({ status: "failed", retryable: true, errorCode: "timeout" });
        }, timeoutMs);
      });
      const perform = async (): Promise<AiAnalysisResult> => {
        const evidence = input.evidence;
        if (
          !isBoundEvidence(evidence) ||
          evidence.documentVersionId !== input.documentVersionId ||
          !/^[a-f0-9]{64}$/.test(evidence.sha256)
        )
          return { status: "failed", retryable: false, errorCode: "evidence-identity-mismatch" };
        if (evidence.unknownReason || !evidence.pages.some((page) => page.text.trim()))
          return { status: "failed", retryable: false, errorCode: "evidence-not-readable" };
        const digest = await crypto.subtle.digest("SHA-256", input.body.slice(0));
        const actual = Array.from(new Uint8Array(digest), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join("");
        controller.signal.throwIfAborted();
        if (actual !== evidence.sha256)
          return { status: "failed", retryable: false, errorCode: "evidence-identity-mismatch" };
        let response: Response;
        try {
          // Existing binary HTTP connector and headers are preserved.
          response = await fetchImpl(options.config.endpoint, {
            method: "POST",
            headers: {
              authorization: `Bearer ${options.config.apiKey}`,
              "content-type": "application/octet-stream",
              "x-document-content-type": input.contentType,
              "x-document-file-name": encodeURIComponent(input.fileName),
            },
            body: input.body,
            signal: controller.signal,
          });
        } catch {
          return {
            status: "failed",
            retryable: true,
            errorCode: controller.signal.aborted ? "timeout" : "transport",
          };
        }
        controller.signal.throwIfAborted();
        if (!response.ok)
          return {
            status: "failed",
            retryable: response.status >= 500 || response.status === 429,
            errorCode: `http-${response.status}`,
          };
        let parsed: z.infer<typeof responseSchema>;
        try {
          parsed = responseSchema.parse(await readBoundedAiResponse(response, controller.signal));
        } catch {
          return {
            status: "failed",
            retryable: controller.signal.aborted,
            errorCode: controller.signal.aborted ? "timeout" : "malformed-response",
          };
        }
        if (!parsed.observations.length)
          return {
            status: "uncertain",
            providerReference: parsed.reference,
            detail: "The model returned no observations about this document.",
          };
        try {
          const findings = groundProviderFindings(
            evidence,
            parsed.observations.map((observation) =>
              makeFinding({
                ruleKey: `provider:${observation.ruleKey}`,
                ruleVersion: AI_RULE_VERSION,
                tier: "provider",
                outcome: observation.outcome,
                severity: observation.severity,
                detail: observation.detail,
                citation: {
                  kind: "version",
                  documentVersionId: input.documentVersionId,
                  pageFrom: observation.pageFrom ?? null,
                  pageTo: observation.pageTo ?? null,
                },
              }),
            ),
          );
          if (!findings)
            return { status: "failed", retryable: false, errorCode: "invalid-citation" };
          return { status: "analysed", providerReference: parsed.reference, findings };
        } catch {
          return { status: "failed", retryable: false, errorCode: "malformed-response" };
        }
      };
      try {
        return await Promise.race([perform(), deadline]);
      } catch {
        return {
          status: "failed",
          retryable: true,
          errorCode: controller.signal.aborted ? "timeout" : "transport",
        };
      } finally {
        clearTimeout(timer!);
      }
    },
  };
}

/**
 * Null when there is no provider, in every mode.
 *
 * Unlike `createDocumentScannerForProviderMode`, this does not throw in live.
 * The asymmetry is the point: a missing scanner must block release, because a
 * file nobody scanned must not be served or approved. A missing model must not
 * block anything -- analysis is advisory, and a firm with no AI vendor still has
 * to be able to file annual returns.
 *
 * There is no fixture analyzer, in any mode. The deterministic tiers are real
 * work that runs everywhere; a stand-in third tier would produce findings that
 * look like a model's and are not, which is the exact confusion Phase C-0 spent
 * its time removing.
 */
export function createDocumentAiAnalyzerForProviderMode(
  providerMode: ProviderMode,
  options: { config?: DocumentAiConfig | null; fetchImpl?: typeof fetch } = {},
): DocumentAiAnalyzer | null {
  if (providerMode !== "live") return null;
  if (!options.config) return null;
  return createLiveDocumentAiAnalyzer({
    config: options.config,
    fetchImpl: options.fetchImpl,
  });
}
