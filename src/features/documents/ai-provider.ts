import { z } from "zod";
import type { ProviderMode } from "@/server/provider-mode";
import type { DocumentAiConfig } from "@/server/runtime-env";
import { makeFinding, type Finding } from "./findings";

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
const responseSchema = z.object({
  reference: z.string().min(1).max(200),
  observations: z
    .array(
      z.object({
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
      }),
    )
    .max(MAX_OBSERVATIONS),
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

      return {
        status: "analysed",
        providerReference: parsed.reference,
        findings: parsed.observations.map((observation) =>
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
        ),
      };
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
