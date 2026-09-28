import { z } from "zod";
import type { ProviderMode } from "@/server/provider-mode";
import type { DocumentAiConfig } from "@/server/runtime-env";
import { makeFinding, type Finding } from "./findings";
import {
  compareContextEvidence,
  parseAdvisoryResponse,
  validateModelEvidence,
  type AnalysisContext,
} from "./analysis-context";

/**
 * Tier 3: a model reads the document.
 *
 * BLOCKED_INTEGRATION: ai-provider. No provider has been chosen, no binding
 * exists, and `getDocumentAiConfig` returns null everywhere, so nothing here
 * runs. It is written and contract-tested against a stub anyway, because a
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

const responseSchema = z.object({
  reference: z.string().min(1).max(200),
  observations: z.array(observationSchema).max(MAX_OBSERVATIONS),
});

export type AiAnalysisInput = {
  documentVersionId: string;
  contentType: string;
  fileName: string;
  body: ArrayBuffer;
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

export function createLiveDocumentAiAnalyzer(options: {
  config: DocumentAiConfig;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): DocumentAiAnalyzer {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? ANALYSIS_TIMEOUT_MS;

  return {
    async analyze(input): Promise<AiAnalysisResult> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(options.config.endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${options.config.apiKey}`,
            "content-type": "application/octet-stream",
            "x-document-content-type": input.contentType,
            // Encoded: a file name can carry non-ASCII, and a raw header value
            // would either throw or be silently mangled.
            "x-document-file-name": encodeURIComponent(input.fileName),
          },
          body: input.body,
          signal: controller.signal,
        });
      } catch (error) {
        // Reported by class, not by message: a vendor error string can carry
        // content we have no business persisting.
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
        // 429 are worth retrying.
        const retryable = response.status >= 500 || response.status === 429;
        return { status: "failed", retryable, errorCode: `http-${response.status}` };
      }

      let parsed: z.infer<typeof responseSchema>;
      try {
        parsed = responseSchema.parse(await response.json());
      } catch {
        // Includes a response that asked for `critical`. Rejecting the whole run
        // is deliberate: a provider that does not honour the contract should not
        // have the rest of its answer silently accepted.
        return { status: "failed", retryable: false, errorCode: "malformed-response" };
      }

      if (parsed.observations.length === 0) {
        return {
          status: "uncertain",
          providerReference: parsed.reference,
          detail: "The model returned no observations about this document.",
        };
      }

      let findings: Finding[];
      try {
        findings = parsed.observations.map((observation) =>
          makeFinding({
            // Namespaced so a provider observation can never be mistaken for a
            // deterministic check in a list, a filter or a log.
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
        );
      } catch {
        // Belt and braces. superRefine above should have caught anything
        // makeFinding would refuse, but the two are separate statements of the
        // same rules and a future edit could let them drift. If they ever do,
        // this adapter still keeps the promise it makes: a provider that does
        // not honour the contract gets `malformed-response`, and never a throw
        // into a caller that has no reason to expect one.
        return { status: "failed", retryable: false, errorCode: "malformed-response" };
      }

      return { status: "analysed", providerReference: parsed.reference, findings };
    },
  };
}

/**
 * Null in every mode until a provider-specific contextual contract is approved.
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
  // A generic endpoint and key are insufficient to activate contextual review.
  // Vendor request/response, provenance and retention terms need approval first.
  // The old byte-only transport is retained for contract tests but cannot be
  // selected by maintenance, even if somebody accidentally adds a binding.
  void providerMode;
  void options;
  return null;
}

/** Strict interpretation for a future approved contextual provider adapter. */
export function interpretContextualResponse(input: {
  context: AnalysisContext;
  pages: readonly { page: number; text: string }[];
  response: unknown;
}):
  | {
      status: "analysed";
      findings: Finding[];
      modelVersion: string;
      promptVersion: string;
      ruleSetVersion: string;
      latencyMs: number;
      costMinor: number;
    }
  | { status: "uncertain"; reasonCode: string } {
  const parsed = parseAdvisoryResponse(input.response, input.context.contextHash);
  if (parsed.status !== "analysed") return parsed;
  const response = parsed.response;
  if (response.ruleSetVersion !== input.context.ruleSetVersion)
    return { status: "uncertain", reasonCode: "RULE_SET_CHANGED" };
  const findings = response.observations.map((observation) => {
    const checked = validateModelEvidence(input.context, observation.evidence, input.pages);
    const supported = checked.outcome === "supported";
    return makeFinding({
      ruleKey: `provider:${observation.ruleKey}`,
      ruleVersion: response.ruleSetVersion,
      tier: "provider",
      outcome: supported ? observation.outcome : "uncertain",
      severity: supported ? observation.severity : "info",
      detail: supported
        ? observation.detail
        : `The model citation could not be verified (${checked.reasonCode}).`,
      citation: {
        kind: "version",
        documentVersionId: input.context.documentVersionId,
        pageFrom: supported ? observation.evidence.page : null,
        pageTo: supported ? observation.evidence.page : null,
      },
      ...(supported ? { evidence: observation.evidence } : {}),
    });
  });
  for (const claim of response.claims ?? []) {
    const checked = validateModelEvidence(input.context, claim.evidence, input.pages);
    if (checked.outcome !== "supported") {
      findings.push(
        makeFinding({
          ruleKey: "provider-context:unverified-claim",
          ruleVersion: response.ruleSetVersion,
          tier: "provider",
          outcome: "uncertain",
          severity: "info",
          detail: `The model's extracted claim could not be verified (${checked.reasonCode}).`,
          citation: {
            kind: "version",
            documentVersionId: input.context.documentVersionId,
            pageFrom: null,
            pageTo: null,
          },
        }),
      );
      continue;
    }
    const value = claim.value;
    const observed =
      claim.kind === "company-name" && typeof value === "string"
        ? { companyName: value }
        : claim.kind === "cr-number" && typeof value === "string"
          ? { crNumber: value }
          : claim.kind === "return-year" && typeof value === "number"
            ? { returnYear: value }
            : claim.kind === "party" && typeof value === "string"
              ? { partyNames: [value] }
              : claim.kind === "requirement" && typeof value === "string"
                ? { requirementLabels: [value] }
                : null;
    if (!observed) continue;
    for (const mismatch of compareContextEvidence(input.context, observed)) {
      findings.push(
        makeFinding({
          ...mismatch,
          citation: {
            kind: "version",
            documentVersionId: input.context.documentVersionId,
            pageFrom: claim.evidence.page,
            pageTo: claim.evidence.page,
          },
          evidence: claim.evidence,
        }),
      );
    }
  }
  return {
    status: "analysed",
    findings,
    modelVersion: response.modelVersion,
    promptVersion: response.promptVersion,
    ruleSetVersion: response.ruleSetVersion,
    latencyMs: response.latencyMs,
    costMinor: response.costMinor,
  };
}
